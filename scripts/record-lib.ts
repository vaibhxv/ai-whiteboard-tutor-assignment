/**
 * The recorder (Task 20): generates every response a learner can reach in one lesson and returns a
 * `Recording`. Pure TypeScript (no React, no DOM): `generate` is injected, so tests use a fake and
 * `scripts/record.ts` uses the owner's Claude Code through the bridge's runner.
 *
 * Contexts are built exactly as the live controller builds them: a real `LessonState` is driven through
 * the reducer (the all-correct main track), and each request comes from the controller's own
 * `segmentRequest` / `request` helpers, so a recorded response answers the prompt the app would send.
 * The text of each response is the model's output byte for byte; the only freedom is choosing among
 * runs (a response that fails validation is asked again), and `meta.selection` discloses the attempts.
 */
import type { Action, CheckAction, PlanRecord, RecapRecord } from '../src/actions'
import type { CheckGrade, LessonEvent } from '../src/lesson/events'
import { intents } from '../src/lesson/intents'
import { reduce } from '../src/lesson/machine'
import { request, segmentRequest, elementsByOwner, idOf } from '../src/lesson/controller-support'
import type { LessonState, SegKey } from '../src/lesson/types'
import { verifyAction } from '../src/maths/verify'
import type { Checked } from '../src/maths/verify'
import type { Beat } from '../src/pipeline/beats'
import { createBoardPipeline } from '../src/pipeline/board-pipeline'
import type { StopReason } from '../src/pipeline/lines'
import { createRecordStream } from '../src/pipeline/record-stream'
import type { Recording } from '../src/sources/recording'
import type { GenRequest, Role } from '../src/sources/types'

/** What a generation returns. A bare string means a normal end of stream with an unknown model. */
export type GenResult = string | { text: string; stop?: StopReason; model?: string }

export type RecordedEntry = { text: string; question?: string; attempts: number }

export type RecordOpts = {
  topic: string
  title: string
  generate: (role: Role, intent: string, user: string) => Promise<GenResult>
  maxAttempts?: number
  /** At most this many generations at once (the CLI allows 2). */
  concurrency?: number
  /** `meta.model` when `generate` does not report one. */
  model?: string
  /** `meta.capturedAt`; defaults to today (ISO date). */
  capturedAt?: string
  /** Responses from an earlier, interrupted run: used for an intent if they still validate, so no new call is spent. */
  seed?: Record<string, RecordedEntry>
  /** Failed attempts already spent on an intent in an earlier run: they count toward `maxAttempts` and the disclosed attempt number. */
  failures?: Record<string, number>
  /** Called after each failed attempt with the running total for that intent. */
  onFailed?: (intent: string, total: number) => void
  /** Called for every accepted response (record.ts keeps a partial file so a usage limit loses nothing). */
  onAccepted?: (intent: string, entry: RecordedEntry) => void
  /** Called with one line per call: intent, attempt, outcome. */
  log?: (line: string) => void
}

export type RecordStats = { calls: number; reused: number; attempts: Record<string, number> }
export type RecordResult = { recording: Recording; stats: RecordStats }

/** Thrown when an intent still fails validation after `maxAttempts`; the message names the intent. */
export class RecordError extends Error {
  constructor(readonly intent: string, message: string) {
    super(message)
    this.name = 'RecordError'
  }
}

const BADGE = { mode: 'live', text: 'recorder', model: 'recorder', billedTo: 'subscription' } as const
const today = () => new Date().toISOString().slice(0, 10)

// ------------------------------------------------------------------------------------- validation

type Parsed = {
  ok: boolean
  reasons: string[]
  beats: Beat[]
  check?: Checked<CheckAction>
  asks: Extract<Action, { t: 'ask' }>[]
  planRecords: PlanRecord[]
  summary?: { accepted: number; rejected: number; failed: number; truncated: boolean }
}

const norm = (r: GenResult) => (typeof r === 'string' ? { text: r, stop: 'end' as StopReason, model: undefined } : { text: r.text, stop: r.stop ?? 'end', model: r.model })

/** The ids of everything on the board except what `ownerKey` itself produced (the controller's shared index). */
function indexFor(state: LessonState, ownerKey: string): Map<string, Action> {
  const index = new Map<string, Action>()
  for (const [owner, acts] of elementsByOwner(state)) {
    if (owner === ownerKey) continue
    for (const a of acts) {
      const id = idOf(a)
      if (id) index.set(id, a)
    }
  }
  return index
}

type BoardKind = 'main' | 'side' | 'answer'

/** Runs text through the real board pipeline. `main` requires a check; `side` (reteach, solution, lost) forbids check and ask. */
function validateBoard(text: string, stop: StopReason, segKey: string, kind: BoardKind, index: Map<string, Action>): Parsed {
  const beats: Beat[] = []
  const asks: Parsed['asks'] = []
  const reasons: string[] = []
  let check: Checked<CheckAction> | undefined
  const pipe = createBoardPipeline({
    segKey, mode: kind === 'answer' ? 'answer' : 'board', ink: kind === 'answer' ? 'answer' : 'lesson', index,
    onBeat: (b) => beats.push(b),
    onCheck: (c) => { check = c },
    onAsk: (a) => asks.push(a),
    onReject: (line, reason) => reasons.push(`rejected line (${reason}): ${line.slice(0, 80)}`),
  })
  pipe.push(text)
  const sum = pipe.end(stop)
  if (stop === 'length') reasons.push('stopped at the length limit')
  if (sum.truncated) reasons.push('output was truncated')
  if (sum.accepted === 0) reasons.push('no usable lines')
  for (const f of sum.failed) reasons.push(`failed verification: ${f.t} ${'id' in f ? String(f.id) : ''} ${f.verify.evidence ?? ''}`.trim())
  if (kind === 'main' && !check) reasons.push('main segment has no check')
  if (kind === 'main' && check && check.verify.status === 'fail') reasons.push('the check failed verification')
  if (kind !== 'main' && check) reasons.push('unexpected check')
  if (kind !== 'main' && asks.length > 0) reasons.push('unexpected ask')
  if (kind === 'answer' && beats.length === 0) reasons.push('empty answer')
  return {
    ok: reasons.length === 0, reasons, beats, asks, planRecords: [], ...(check ? { check } : {}),
    summary: { accepted: sum.accepted, rejected: sum.rejected, failed: sum.failed.length, truncated: sum.truncated },
  }
}

function validatePlan(text: string, stop: StopReason): Parsed {
  const reasons: string[] = []
  const planRecords: PlanRecord[] = []
  const rs = createRecordStream({
    mode: 'plan',
    onRecord: (r) => planRecords.push(r as PlanRecord),
    onReject: (line, reason) => reasons.push(`rejected line (${reason}): ${line.slice(0, 80)}`),
  })
  rs.push(text)
  const counts = rs.end(stop)
  if (stop === 'length') reasons.push('stopped at the length limit')
  const scope = planRecords.find((r) => r.t === 'scope')
  if (scope?.t === 'scope' && scope.verdict === 'declined') reasons.push('scope declined')
  const segs = planRecords.filter((r) => r.t === 'segment')
  if (segs.length < 1) reasons.push('no segments planned')
  if (segs.length > 5) reasons.push('more than 5 segments')
  if (!planRecords.some((r) => r.t === 'warmup')) reasons.push('no warm-up')
  return {
    ok: reasons.length === 0, reasons, beats: [], asks: [], planRecords,
    summary: { accepted: counts.accepted, rejected: counts.rejected, failed: 0, truncated: stop === 'length' },
  }
}

function validateRecap(text: string, stop: StopReason): Parsed {
  const reasons: string[] = []
  const recs: RecapRecord[] = []
  const practice = new Map<string, Action>()
  let failed = 0
  const rs = createRecordStream({
    mode: 'recap',
    onRecord: (r) => {
      const rec = r as RecapRecord
      recs.push(rec)
      if (rec.t === 'check') {
        const v = verifyAction(rec, { index: practice })
        practice.set(rec.id, rec)
        if (v.status === 'fail') {
          failed++
          reasons.push(`failed verification: check ${rec.id} ${v.evidence ?? ''}`.trim())
        }
      }
    },
    onReject: (line, reason) => reasons.push(`rejected line (${reason}): ${line.slice(0, 80)}`),
  })
  rs.push(text)
  const counts = rs.end(stop)
  if (stop === 'length') reasons.push('stopped at the length limit')
  if (recs.filter((r) => r.t === 'idea').length < 1) reasons.push('no idea lines')
  if (recs.filter((r) => r.t === 'check').length !== 3) reasons.push('the recap needs exactly 3 practice checks')
  return {
    ok: reasons.length === 0, reasons, beats: [], asks: [], planRecords: [],
    summary: { accepted: counts.accepted, rejected: counts.rejected, failed, truncated: stop === 'length' },
  }
}

// ----------------------------------------------------------------------------------------- the run

const apply = (s: LessonState, events: LessonEvent[]): LessonState => events.reduce(reduce, s)

/** Streams parsed output into a pending segment, as the controller does. */
function fillSegment(state: LessonState, key: SegKey, p: Parsed): LessonState {
  const events: LessonEvent[] = [{ type: 'seg/stream', key }]
  for (const beat of p.beats) events.push({ type: 'seg/beat', key, beat })
  for (const ask of p.asks) events.push({ type: 'seg/ask', key, ask })
  if (p.check) events.push({ type: 'seg/check', key, check: p.check })
  events.push({ type: 'seg/done', key, summary: { accepted: 0, rejected: 0, failed: [], hasCheck: !!p.check, truncated: false } })
  return apply(state, events)
}

function advanceUntil(s: LessonState, done: (t: LessonState) => boolean): LessonState {
  let t = s
  for (let i = 0; i < 80 && !done(t); i++) t = reduce(t, { type: 'player/advance' })
  if (!done(t)) throw new Error('recorder: the player never reached the expected state')
  return t
}

type Gradeable = { branch: string; misconception?: string }

/** The wrong answers a learner can give at a check, as `CheckGrade` branches (what `gradeCheck` would return). */
function wrongBranches(c: CheckAction): Gradeable[] {
  switch (c.kind) {
    case 'choice':
      return c.options.filter((o) => !o.correct).map((o) => ({ branch: o.id, ...(o.misconception ? { misconception: o.misconception } : {}) }))
    case 'number':
    case 'expr':
      return [
        ...(c.anticipated ?? []).map((a, i) => ({ branch: `a${i}`, misconception: a.misconception })),
        { branch: 'other' },
      ]
    case 'tap':
    case 'set':
      return [{ branch: 'other' }]
  }
}

const correctGrade = (c: CheckAction): { result: 'correct'; branch: string } =>
  ({ result: 'correct', branch: c.kind === 'choice' ? (c.options.find((o) => o.correct)?.id ?? 'correct') : 'correct' })

const wrongGrade = (g: Gradeable): CheckGrade =>
  ({ result: 'wrong', branch: g.branch, ...(g.misconception ? { misconception: g.misconception } : {}) })

type Snap = { n: number; atEnd: LessonState; atCheck: LessonState; check: Checked<CheckAction> }

type Job = { intent: string; role: Role; run: () => GenRequest; validate: (text: string, stop: StopReason) => Parsed; question?: string }

export async function recordLesson(opts: RecordOpts): Promise<RecordResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3)
  const log = opts.log ?? (() => {})
  const responses: Recording['responses'] = {}
  const attempts: Record<string, number> = {}
  const stats: RecordStats = { calls: 0, reused: 0, attempts }
  let model = opts.model ?? ''
  let halted = false

  /** Produces one validated response: seed first, then up to maxAttempts generations. */
  async function produce(job: Job): Promise<Parsed> {
    const { intent } = job
    const seed = opts.seed?.[intent]
    if (seed) {
      const parsed = job.validate(seed.text, 'end')
      if (parsed.ok) {
        stats.reused++
        attempts[intent] = seed.attempts
        responses[intent] = { text: seed.text, ...(job.question ? { question: job.question } : {}) }
        log(`${intent}: reused from an earlier run`)
        return parsed
      }
    }
    const req = job.run()
    const reasons: string[] = []
    const prior = opts.failures?.[intent] ?? 0
    for (let attempt = prior + 1; attempt <= maxAttempts; attempt++) {
      if (halted) throw new RecordError(intent, `stopped before "${intent}" (another intent failed)`)
      stats.calls++
      let r: ReturnType<typeof norm>
      try {
        r = norm(await opts.generate(job.role, intent, req.user))
      } catch (e) {
        const kind = (e as { kind?: string }).kind
        if (kind === 'usage-limit' || kind === 'cli-signed-out' || kind === 'cli-missing') {
          halted = true
          throw e
        }
        reasons.push(`call failed: ${e instanceof Error ? e.message : String(e)}`)
        log(`${intent}: attempt ${attempt} call failed (${reasons.at(-1)})`)
        opts.onFailed?.(intent, attempt)
        continue
      }
      if (r.model && !model) model = r.model
      const parsed = job.validate(r.text, r.stop)
      if (parsed.ok) {
        attempts[intent] = attempt
        responses[intent] = { text: r.text, ...(job.question ? { question: job.question } : {}) }
        opts.onAccepted?.(intent, { text: r.text, ...(job.question ? { question: job.question } : {}), attempts: attempt })
        log(`${intent}: ok (attempt ${attempt})`)
        return parsed
      }
      reasons.push(...parsed.reasons)
      log(`${intent}: attempt ${attempt} rejected: ${parsed.reasons.slice(0, 2).join(' | ')}`)
      opts.onFailed?.(intent, attempt)
    }
    halted = true
    throw new RecordError(intent, `could not record "${intent}" after ${maxAttempts} attempts: ${reasons.slice(-3).join(' | ')}`)
  }

  /** Runs jobs with at most `concurrency` in flight; the first failure stops new work and is rethrown. */
  async function pool<T>(items: (() => Promise<T>)[]): Promise<T[]> {
    const out: T[] = new Array(items.length)
    let next = 0
    let firstError: unknown
    const worker = async () => {
      while (next < items.length && firstError === undefined) {
        const i = next++
        try {
          out[i] = await (items[i] as () => Promise<T>)()
        } catch (e) {
          firstError ??= e
          halted = true
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker))
    if (firstError !== undefined) throw firstError
    return out
  }

  // 1. plan ---------------------------------------------------------------------------------------
  const planReq = request('plan', intents.plan, { topic: opts.topic })
  const planParsed = await produce({
    intent: intents.plan, role: 'plan', run: () => planReq, validate: validatePlan,
  })
  let state = reduce(null, {
    type: 'lesson/start', id: 'recorder', topic: opts.topic, at: new Date(0).toISOString(), badge: BADGE,
  })
  state = apply(state, planParsed.planRecords.map((record): LessonEvent => ({ type: 'plan/record', record })))
  state = reduce(state, { type: 'plan/done' })
  const right = state.warmup?.record.options.find((o) => o.correct)
  if (state.warmup && right) state = reduce(state, { type: 'warmup/answer', optionId: right.id })
  const nSegs = state.plan.length

  // 2. the main track: every earlier check answered right first time ------------------------------------
  const snaps: Snap[] = []
  for (let n = 1; n <= nSegs; n++) {
    const key: SegKey = `seg:${n}`
    const s0 = state
    const parsed = await produce({
      intent: intents.segment(n), role: 'segment', run: () => segmentRequest(s0, key),
      validate: (text, stop) => validateBoard(text, stop, key, 'main', indexFor(s0, key)),
    })
    state = fillSegment(state, key, parsed)
    const atEnd = state
    const check = parsed.check as Checked<CheckAction>
    state = advanceUntil(state, (t) => t.phase === 'checkpoint')
    const atCheck = state
    snaps.push({ n, atEnd, atCheck, check })
    state = reduce(state, { type: 'check/answer', checkId: check.id, grade: correctGrade(check) })
  }
  const finalState = state

  // 3. everything off the main track, two at a time -----------------------------------------------------
  const reteachBranches = new Map<string, Gradeable[]>() // check id -> branches in recording order
  const reteachParsed = new Map<string, Parsed>() // `<checkId>:<branch>`
  const jobs: (() => Promise<void>)[] = []

  const sideJob = (intent: string, role: Role, key: SegKey, state0: LessonState, kind: BoardKind, after?: (p: Parsed) => void) =>
    async () => {
      const p = await produce({
        intent, role, run: () => segmentRequest(state0, key),
        validate: (text, stop) => validateBoard(text, stop, key, kind, indexFor(state0, key)),
      })
      after?.(p)
    }

  for (const snap of snaps) {
    const { check } = snap
    const wrong = wrongBranches(check)
    reteachBranches.set(check.id, wrong)
    for (const w of wrong) {
      const s1 = reduce(snap.atCheck, { type: 'check/answer', checkId: check.id, grade: wrongGrade(w) })
      jobs.push(sideJob(intents.reteach(check.id, w.branch), 'reteach', `reteach:${check.id}:1`, s1, 'side',
        (p) => reteachParsed.set(`${check.id}:${w.branch}`, p)))
    }
    // lost:<n>:1 — pressed "I'm lost" on the last beat of segment n
    const mid = advanceUntil(snap.atEnd, (t) => t.cursor.beat >= (t.segments[`seg:${snap.n}`]?.beats.length ?? 1) - 1)
    const lostState = reduce(mid, { type: 'lost/request' })
    jobs.push(sideJob(intents.lost(snap.n, 1), 'lost', `lost:${snap.n}:1`, lostState, 'side'))
  }

  // answers: one per ask, asked in lesson order (earlier questions are on record, as they would be live)
  const askList = snaps.flatMap((snap) => (snap.atEnd.segments[`seg:${snap.n}`]?.asks ?? []).map((ask) => ({ snap, ask })))
  askList.forEach(({ snap, ask }, k) => {
    let s = advanceUntil(snap.atEnd, (t) => t.cursor.beat >= (t.segments[`seg:${snap.n}`]?.beats.length ?? 1) - 1)
    for (let j = 0; j < k; j++) {
      const prev = (askList[j] as (typeof askList)[number]).ask
      s = apply(s, [
        { type: 'interrupt/ask', threadId: `t${j + 1}`, question: prev.text, targets: [], askId: prev.id },
        { type: 'thread/done', threadId: `t${j + 1}` },
        { type: 'interrupt/close', outcome: 'clear' },
      ])
    }
    const threadId = `t${k + 1}`
    s = reduce(s, { type: 'interrupt/ask', threadId, question: ask.text, targets: [], askId: ask.id })
    const s2 = s
    jobs.push(async () => {
      await produce({
        intent: intents.answer(ask.id), role: 'answer', question: ask.text,
        run: () => request('answer', intents.answer(ask.id), { state: s2, question: ask.text, targets: [] }),
        validate: (text, stop) => validateBoard(text, stop, threadId, 'answer', indexFor(s2, `thread:${threadId}`)),
      })
    })
  })

  // the recap, after the all-correct main track
  const recapState = finalState
  jobs.push(async () => {
    await produce({
      intent: intents.recap, role: 'recap', run: () => request('recap', intents.recap, { state: recapState }), validate: validateRecap,
    })
  })

  await pool(jobs)

  // 4. solutions: wrong, reteach (the first branch's recorded reteach), wrong again --------------------------
  const solutionJobs: (() => Promise<void>)[] = []
  for (const snap of snaps) {
    const { check } = snap
    const wrong = reteachBranches.get(check.id) ?? []
    const first = wrong[0]
    if (!first) continue
    const second = wrong[1] ?? { branch: 'other' }
    const rp = reteachParsed.get(`${check.id}:${first.branch}`) as Parsed
    const rkey: SegKey = `reteach:${check.id}:1`
    let s = reduce(snap.atCheck, { type: 'check/answer', checkId: check.id, grade: wrongGrade(first) })
    s = fillSegment(s, rkey, rp)
    s = advanceUntil(s, (t) => t.phase === 'checkpoint')
    s = reduce(s, { type: 'check/answer', checkId: check.id, grade: wrongGrade(second) })
    solutionJobs.push(sideJob(intents.solution(check.id), 'solution', `solution:${check.id}`, s, 'side'))
  }
  await pool(solutionJobs)

  // assemble in the order of the brief ---------------------------------------------------------------------
  const order: string[] = [intents.plan]
  for (const snap of snaps) order.push(intents.segment(snap.n))
  for (const snap of snaps) for (const w of reteachBranches.get(snap.check.id) ?? []) order.push(intents.reteach(snap.check.id, w.branch))
  for (const snap of snaps) order.push(intents.solution(snap.check.id))
  for (const snap of snaps) order.push(intents.lost(snap.n, 1))
  for (const { ask } of askList) order.push(intents.answer(ask.id))
  order.push(intents.recap)
  const ordered: Recording['responses'] = {}
  for (const k of order) ordered[k] = responses[k] as Recording['responses'][string]

  const note = order.map((k) => `${k}=${attempts[k] ?? 1}`).join(', ')
  const recording: Recording = {
    meta: {
      title: opts.title,
      model: model || 'unknown',
      via: 'claude-code',
      capturedAt: opts.capturedAt ?? today(),
      actionsVersion: 1,
      selection: `best of up to ${maxAttempts} runs per response; text unedited; attempts: ${note}`,
    },
    responses: ordered,
  }
  return { recording, stats }
}
