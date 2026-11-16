/**
 * Helpers for the lesson controller: the concurrency limiter, request building per need, the shared
 * id index (tracking and rebuilding), element lookup and stream draining. Pure TypeScript, no React.
 */
import type { Action, CheckAction } from '../actions'
import { markId } from '../layout/engine'
import type { Checked } from '../maths/verify'
import type { PipelineSummary } from '../pipeline/board-pipeline'
import type { StopReason } from '../pipeline/lines'
import { buildUserMessage } from '../prompts/context'
import type { RoleContextMap } from '../prompts/context'
import { ROLE_CAPS } from '../prompts/roles'
import { SYSTEM_PROMPT } from '../prompts/system'
import { SourceError } from '../sources/errors'
import { throwOnErrorEvents } from '../sources/types'
import type { AiSource, GenRequest, Role } from '../sources/types'
import { intents } from './intents'
import { nextLostStyle } from './learner'
import type { LessonEvent } from './events'
import type { LessonState, RetryTarget, SegKey, SourceErrorData } from './types'

export const MAX_CONCURRENT = 2

// ------------------------------------------------------------------------------------------ limiter

/** At most `max` holders at once. `tryAcquire` never jumps the queue of waiting `acquire` calls. */
export class Limiter {
  private active = 0
  private waiters: { grant: () => void; reject: (e: unknown) => void }[] = []
  constructor(private readonly max: number, private readonly onFree: () => void) {}

  tryAcquire(): boolean {
    if (this.active >= this.max || this.waiters.length > 0) return false
    this.active++
    return true
  }

  acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new SourceError('aborted'))
    if (this.tryAcquire()) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const w = {
        grant: () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        },
        reject,
      }
      const onAbort = () => {
        this.waiters = this.waiters.filter((x) => x !== w)
        reject(new SourceError('aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(w)
    })
  }

  release(): void {
    const next = this.waiters.shift()
    if (next) {
      next.grant() // the slot passes straight to the waiter
      return
    }
    this.active = Math.max(0, this.active - 1)
    this.onFree()
  }
}

// ----------------------------------------------------------------------------------------- requests

export function request<R extends Role>(role: R, intent: string, ctx: RoleContextMap[R]): GenRequest {
  return { role, intent, system: SYSTEM_PROMPT, user: buildUserMessage(role, ctx), maxOutputTokens: ROLE_CAPS[role] }
}

const checkOf = (s: LessonState, checkId: string): CheckAction | undefined =>
  Object.values(s.segments).find((g) => g.kind === 'main' && g.check?.id === checkId)?.check

/** The misconception behind a wrong branch: the learner model's (from the CheckGrade), else the check's own. */
export function misconceptionFor(s: LessonState, checkId: string, branch: string): string | undefined {
  const fromLearner = s.learner.misconceptions.filter((m) => m.checkId === checkId && !m.resolved).at(-1)?.text
  if (fromLearner) return fromLearner
  const c = checkOf(s, checkId)
  if (c?.kind === 'choice') return c.options.find((o) => o.id === branch)?.misconception || undefined
  if ((c?.kind === 'number' || c?.kind === 'expr') && /^a\d+$/.test(branch)) return c.anticipated?.[Number(branch.slice(1))]?.misconception
  return undefined
}

/** Role, intent and context for a pending segment. */
export function segmentRequest(s: LessonState, key: SegKey): GenRequest {
  const parts = key.split(':')
  const kind = parts[0]
  if (kind === 'reteach') {
    // reteach:<checkId>:<attempt>; the intent names the branch the learner chose on that attempt.
    const checkId = parts.slice(1, -1).join(':')
    const attempt = Number(parts[parts.length - 1])
    const branches = s.checks[checkId]?.branches ?? []
    const branch = branches[attempt - 1] ?? branches.at(-1) ?? 'other'
    const misconception = misconceptionFor(s, checkId, branch)
    return request('reteach', intents.reteach(checkId, branch), { state: s, checkId, branch, ...(misconception ? { misconception } : {}) })
  }
  if (kind === 'solution') {
    const checkId = parts.slice(1).join(':')
    return request('solution', intents.solution(checkId), { state: s, checkId })
  }
  if (kind === 'lost') {
    const n = Number(parts[1])
    const k = Number(parts[2])
    return request('lost', intents.lost(n, k), { state: s, n, style: nextLostStyle(k - 1) })
  }
  const n = Number(parts[1])
  return request('segment', intents.segment(n), { state: s, n })
}

// ------------------------------------------------------------------------------------- shared index

export const idOf = (a: Action): string | undefined => ('id' in a && typeof a.id === 'string' ? a.id : undefined)

/**
 * A view of the shared index that records every id the pipeline adds, so a generation's ids can be
 * removed again when it is regenerated, retried or superseded.
 */
export function trackingIndex(shared: Map<string, Action>, added: Set<string>): Map<string, Action> {
  const view: Map<string, Action> = new Proxy(shared, {
    get(target, prop) {
      if (prop === 'set') {
        return (k: string, v: Action) => {
          added.add(k)
          target.set(k, v)
          return view
        }
      }
      const v: unknown = Reflect.get(target, prop, target)
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
  return view
}

export const segOwner = (key: SegKey): string => key
export const threadOwner = (id: string): string => `thread:${id}`

/**
 * Every accepted element in the lesson, grouped by the generation that produced it (segment key or
 * `thread:<id>`), with `beat/patch` replacements applied. Used to rebuild the index on resume.
 */
export function elementsByOwner(s: LessonState): Map<string, Action[]> {
  const out = new Map<string, Action[]>()
  const strip = (a: Checked): Action => {
    const id = idOf(a)
    const p = id ? s.patches[id] : undefined
    const { verify: _v, ...rest } = (p ?? a) as Checked
    return rest as Action
  }
  for (const key of s.order) {
    const g = s.segments[key]
    if (!g) continue
    const acts = g.beats.flatMap((b) => b.actions.map(strip))
    out.set(segOwner(key), [...acts, ...g.asks, ...(g.check ? [strip(g.check)] : [])])
  }
  for (const t of s.threads) out.set(threadOwner(t.id), t.beats.flatMap((b) => b.actions.map(strip)))
  return out
}

/** Finds a board element by id (patched), or a mark by its layout id `<beatId>~m<i>`. */
export function findElement(s: LessonState, id: string): Checked | undefined {
  const beats = [...s.order.flatMap((k) => s.segments[k]?.beats ?? []), ...s.threads.flatMap((t) => t.beats)]
  for (const b of beats) {
    for (const [i, a] of b.actions.entries()) {
      const aid = idOf(a)
      if (aid === id) return s.patches[id] ?? a
      if (!aid && markId(b.id, i) === id) return a
    }
  }
  for (const k of s.order) {
    const c = s.segments[k]?.check
    if (c?.id === id) return c
  }
  return undefined
}

/** The id of the last math/step line with an expression before `id` in its segment (for step checks). */
export function lastMathBefore(s: LessonState, id: string): string | undefined {
  for (const k of s.order) {
    let last: string | undefined
    for (const b of s.segments[k]?.beats ?? []) {
      for (const a of b.actions) {
        if (idOf(a) === id) return last
        if ((a.t === 'math' || a.t === 'step') && a.expr !== undefined) last = a.id
      }
    }
  }
  return undefined
}

// ------------------------------------------------------------------------------------------ streams

/** Drains a generation into `onText`; returns the stop reason. Throws `SourceError` (normalised). */
export async function streamText(
  source: AiSource, req: GenRequest, signal: AbortSignal, onText: (t: string) => void,
): Promise<StopReason> {
  let stop: StopReason = 'end'
  try {
    for await (const e of throwOnErrorEvents(source.generate(req, signal))) {
      if (signal.aborted) return 'aborted'
      if (e.type === 'text') onText(e.text)
      else if (e.type === 'done') {
        stop = e.stop
        break
      }
    }
  } catch (e) {
    if (signal.aborted) return 'aborted'
    throw e instanceof SourceError ? e : new SourceError('unknown', e instanceof Error ? e.message : String(e))
  }
  return signal.aborted ? 'aborted' : stop
}

export const errorData = (e: unknown): SourceErrorData =>
  e instanceof SourceError ? { kind: e.kind, message: e.message } : { kind: 'unknown', message: e instanceof Error ? e.message : String(e) }

export const isAbort = (e: unknown): boolean => e instanceof SourceError && e.kind === 'aborted'

/** First `max` words (say lines are capped at 22 words by the schema). */
export function capWords(text: string, max = 22): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}…`
}


// ------------------------------------------------------------------------------- jobs and runtime

/** Everything the controller generates: the needs, plus the plan and report-a-mistake reviews. */
export type Job =
  | { kind: 'plan' }
  | { kind: 'segment'; key: SegKey }
  | { kind: 'thread'; id: string }
  | { kind: 'recap' }
  | { kind: 'review'; threadId: string; elementId: string }
/**
 * One in-flight job; a newer flight for the same key supersedes (and aborts) it. `settled` means the
 * item itself is complete and only background work (step repairs) remains.
 */
export type Flight = { key: string; job: Job; ctrl: AbortController; settled?: boolean }

export const jobKey = (j: Job): string =>
  j.kind === 'segment' ? segOwner(j.key) : j.kind === 'thread' ? threadOwner(j.id) : j.kind === 'review' ? threadOwner(j.threadId) : j.kind

export function retryTarget(j: Job): RetryTarget {
  switch (j.kind) {
    case 'review': return { kind: 'thread', id: j.threadId }
    case 'thread': return { kind: 'thread', id: j.id }
    case 'segment': return { kind: 'segment', key: j.key }
    default: return { kind: j.kind }
  }
}

/** What the controller's helper modules (repair, review) may use. */
export interface Runtime {
  readonly source: AiSource
  readonly index: Map<string, Action>
  readonly limiter: Limiter
  state(): LessonState | null
  dispatch(e: LessonEvent): void
  /** True while `f` is the current, un-aborted flight for its key and the controller is live. */
  alive(f: Flight): boolean
  fail(f: Flight, error: SourceErrorData): void
  /** Forgets an owner's ids in the index and returns a view that tracks the ids added next. */
  claim(owner: string): Map<string, Action>
  begin(job: Job): Flight
  end(f: Flight): void
  /** Runs `body` holding a limiter slot; errors become `fail`, and the flight ends afterwards. */
  withSlot(f: Flight, body: (free: () => void) => Promise<void>): Promise<void>
}

// ---------------------------------------------------------------------------------- output policy

/** Above this share of unusable lines a segment is regenerated. */
export const MAX_REJECT_RATIO = 0.25

/** Why a segment's output is unusable, or null. A check is required of main segments only. */
export function badOutput(sum: PipelineSummary, main: boolean): string | null {
  const total = sum.accepted + sum.rejected
  if (sum.truncated) return 'The answer was cut off before the end.'
  if (sum.accepted === 0) return 'Nothing usable came back.'
  if (sum.rejected / total > MAX_REJECT_RATIO) return `${sum.rejected} of ${total} lines could not be used.`
  if (main && !sum.hasCheck) return 'The segment ended without its checkpoint.'
  return null
}

export const capChars = (s: string, max: number): string => Array.from(s.trim()).slice(0, max).join('')
