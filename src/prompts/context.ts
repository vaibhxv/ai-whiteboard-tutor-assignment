/**
 * Per-call user messages (blueprint §7.1): `<plan>`, `<learner>`, `<board>`, optional `<learner_text>`, then
 * `<task>`. Each call is stateless and reproducible from the lesson state. Every dynamic string is
 * neutralised (`<` → `‹`, `>` → `›`) so nothing can close or open a block; learner-typed text is capped and
 * wrapped in `<learner_text>`, which the system prompt declares to be data.
 */
import type { Action, CheckAction, SegmentPlan } from '../actions'
import type { LessonState, SegKey, SegmentState } from '../lesson/types'
import type { Checked, Verification } from '../maths/verify'
import type { Role } from '../sources/types'
import {
  answerTask, lostTask, planTask, recapTask, repairTask, reteachTask, reviewTask, segmentTask, solutionTask,
} from './roles'
import type { CheckSummary } from './roles'

export const TOPIC_MAX = 300
export const QUESTION_MAX = 500
const CONTENT_MAX = 60
const PAST_QUESTION_MAX = 120

export type RoleContextMap = {
  plan: { topic: string }
  segment: { state: LessonState; n: number }
  reteach: { state: LessonState; checkId: string; branch: string; misconception?: string }
  solution: { state: LessonState; checkId: string }
  lost: { state: LessonState; n: number; style: string }
  answer: { state: LessonState; question: string; targets: string[]; followUp?: 'not-quite' | 'differently' }
  recap: { state: LessonState }
  review: { state: LessonState; elementId: string; localVerification: Verification }
  /** `state` is optional: when given, the lines the action refers to are included. */
  repair: { action: Action; evidence: string; state?: LessonState }
}
export type RoleContext<R extends Role = Role> = RoleContextMap[R]

// ---------------------------------------------------------------------------------------------- text

/** Neutralise angle brackets so text can never open or close a prompt block. */
export const neutralise = (s: string): string => s.replace(/</g, '‹').replace(/>/g, '›')

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Cut to `max` code points (never splits a surrogate pair). */
function cap(s: string, max: number, ellipsis = false): string {
  const cps = Array.from(s)
  if (cps.length <= max) return s
  return ellipsis ? cps.slice(0, max - 1).join('') + '…' : cps.slice(0, max).join('')
}

const clean = (s: string, max?: number): string => {
  const t = neutralise(oneLine(s))
  return max === undefined ? t : cap(t, max, true)
}

/** Learner-typed text: neutralised, trimmed and hard-capped. */
export const learnerText = (s: string, max: number): string => cap(neutralise(s.trim()), max)

const block = (tag: string, body: string) => `<${tag}>\n${body}\n</${tag}>`

/** JSON of an action without the pipeline's `verify` field, neutralised. */
function actionJson(a: Action): string {
  const { verify: _v, ...rest } = a as Checked
  return neutralise(JSON.stringify(rest))
}

// ------------------------------------------------------------------------------------- state digging

function segmentsInOrder(s: LessonState): SegmentState[] {
  return s.order.flatMap((k) => s.segments[k] ?? [])
}

/** Beat actions with any `beat/patch` replacements applied. */
function patchedActions(s: LessonState, beats: SegmentState['beats']): Action[] {
  return beats.flatMap((b) => b.actions.map((a): Action => ('id' in a && typeof a.id === 'string' ? s.patches[a.id] ?? a : a)))
}

/** Every element of a segment in emission order: beat actions (patched), asks, then the check. */
function elementsOf(s: LessonState, g: SegmentState): Action[] {
  return [...patchedActions(s, g.beats), ...g.asks, ...(g.check ? [g.check] : [])]
}

/**
 * What the learner has seen of a segment, as board elements (no asks: they are chips, not board items).
 * The cursor's own segment shows its beats up to the current one, and its check only at the checkpoint.
 */
function shownOf(s: LessonState, g: SegmentState): Action[] {
  const isCursor = g.key === s.cursor.seg && s.phase !== 'checkpoint'
  const beats = isCursor ? g.beats.slice(0, s.cursor.beat + 1) : g.beats
  const acts = patchedActions(s, beats)
  const showCheck = g.check && (!isCursor || s.cursor.beat >= g.beats.length)
  return showCheck && g.check ? [...acts, g.check] : acts
}

function threadActions(s: LessonState): Action[] {
  return s.threads.flatMap((t) => t.beats.flatMap((b) => b.actions))
}

function allActions(s: LessonState): Action[] {
  return [...segmentsInOrder(s).flatMap((g) => elementsOf(s, g)), ...threadActions(s)]
}

const idOf = (a: Action): string | undefined => ('id' in a && typeof a.id === 'string' ? a.id : undefined)

/** Every id taken in the lesson (elements and plot curves), in order, deduplicated. */
function usedIds(s: LessonState): string[] {
  const out = new Set<string>()
  for (const a of allActions(s)) {
    const id = idOf(a)
    if (id) out.add(id)
    if (a.t === 'plot') for (const f of a.fns) out.add(f.id)
  }
  return [...out]
}

function findAction(s: LessonState, id: string): Action | undefined {
  for (const a of allActions(s)) {
    if (idOf(a) === id) return a
    if (a.t === 'plot' && a.fns.some((f) => f.id === id)) return a
  }
  return undefined
}

/** The main segment whose check has this id. */
function checkOwner(s: LessonState, checkId: string): SegmentState | undefined {
  return Object.values(s.segments).find((g) => g.kind === 'main' && g.check?.id === checkId)
}

const planOf = (s: LessonState, n: number): SegmentPlan | undefined => s.plan.find((p) => p.n === n) ?? s.plan[n - 1]

const cursorN = (s: LessonState): number => s.segments[s.cursor.seg]?.n ?? 1

/** Human-readable answer for a check branch: option text, anticipated value, or "something else". */
function branchText(c: CheckAction | undefined, branch: string): string {
  if (!c) return branch
  if (c.kind === 'choice') {
    const o = c.options.find((x) => x.id === branch)
    return o ? `"${o.text}"` : branch
  }
  if ((c.kind === 'number' || c.kind === 'expr') && /^a\d+$/.test(branch)) {
    const an = c.anticipated?.[Number(branch.slice(1))]
    if (an) return `${an.value}`
  }
  if (branch === 'other') return 'an answer we did not anticipate'
  return branch
}

function correctText(s: LessonState, c: CheckAction | undefined): string {
  if (!c) return 'unknown'
  switch (c.kind) {
    case 'choice': {
      const o = c.options.find((x) => x.correct)
      return o ? `"${o.text}"` : 'unknown'
    }
    case 'number': return c.tolerance ? `${c.answer} (±${c.tolerance})` : c.answer
    case 'expr': return `${c.answer} (in ${c.variable})`
    case 'tap': {
      const el = findAction(s, c.answer)
      return `tap ${c.answer} on ${c.figure}${el && el.t !== 'plot' ? ` (${el.t} ${contentOf(el, [])})` : ''}`
    }
    case 'set': return `${c.param} between ${c.target[0]} and ${c.target[1]}`
  }
}

function checkSummary(s: LessonState, checkId: string, extraBranch?: string): CheckSummary {
  const c = checkOwner(s, checkId)?.check
  const branches = [...(s.checks[checkId]?.branches ?? [])]
  if (extraBranch !== undefined && branches[branches.length - 1] !== extraBranch) branches.push(extraBranch)
  return {
    prompt: clean(c?.prompt ?? checkId),
    correct: clean(correctText(s, c)),
    chosen: branches.map((b) => clean(branchText(c, b))),
  }
}

// ------------------------------------------------------------------------------------------- <board>

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6)))
}
const pt = (p: readonly [number, number]) => `(${fmt(p[0])}, ${fmt(p[1])})`

function partsOf(plotId: string, pool: Action[]): string[] {
  return pool.flatMap((a) => ((a.t === 'point' || a.t === 'line' || a.t === 'guide') && a.plot === plotId ? [a.id] : []))
}

function contentOf(a: Action, pool: Action[]): string {
  switch (a.t) {
    case 'say': return a.text
    case 'page': return a.title ?? ''
    case 'write': return a.text
    case 'math': return a.expr ?? a.latex
    case 'step': return `${a.expr}${a.from ? ` ← ${a.from}` : ''}`
    case 'solutions': return `${a.var} = ${a.values.map(fmt).join(', ')} (of ${a.of})`
    case 'plot': {
      const parts = partsOf(a.id, pool)
      return `fns ${a.fns.map((f) => f.id).join(' ')}${parts.length ? `; has ${parts.join(' ')}` : ''}`
    }
    case 'point': return `${pt(a.at)} on ${a.plot}${a.on ? `/${a.on}` : ''}${a.label ? ` "${a.label}"` : ''}`
    case 'line': return `${pt(a.from)}→${pt(a.to)} on ${a.plot}${a.label ? ` "${a.label}"` : ''}`
    case 'guide': return `${a.x !== undefined ? `x = ${fmt(a.x)}` : `y = ${fmt(a.y ?? 0)}`} on ${a.plot}`
    case 'numberline': return `${fmt(a.range[0])}..${fmt(a.range[1])} marks ${a.marks.map((m) => fmt(m.at)).join(', ')}`
    case 'table': return `${a.head.join(' | ')}; ${a.rows.length} rows${a.fn ? `; fn ${a.fn}` : ''}`
    case 'mark': return `${a.kind} → ${a.target}${a.note ? ` "${a.note}"` : ''}`
    case 'explore': return `${a.expr}; ${a.params.map((p) => `${p.name} ${fmt(p.min)}..${fmt(p.max)}`).join(', ')}`
    case 'check': return `${a.kind}: ${a.prompt}`
    case 'ask': return a.text
  }
}

function boardLines(s: LessonState, a: Action, pool: Action[]): string[] {
  if (a.t === 'say') return []
  const id = idOf(a) ?? '-'
  const struck = id !== '-' && s.struck.includes(id) ? '(struck) ' : ''
  const line = `${neutralise(id)} ${a.t} ${clean(struck + contentOf(a, pool), CONTENT_MAX)}`
  if (a.t !== 'plot') return [line]
  return [line, ...a.fns.map((f) => `${neutralise(f.id)} fn ${clean(`${f.expr} (on ${a.id})`, CONTENT_MAX)}`)]
}

/**
 * The board as the model sees it: one line per element of `segKey`'s beats (`<id> <t> <content ≤ 60>`),
 * plus the figures (plots, explores and their points/lines/guides) of segments earlier in play order,
 * so answers can point at them. Plots list their curve ids and the ids of their parts. Only what the
 * learner has already seen is listed (see `shownOf`).
 */
export function listBoard(state: LessonState, segKey: SegKey): string {
  const segs = segmentsInOrder(state)
  const pos = segs.findIndex((g) => g.key === segKey)
  const earlier = pos >= 0 ? segs.slice(0, pos) : segs.filter((g) => g.key !== segKey)
  const cur = state.segments[segKey]
  const shown = new Map(segs.map((g) => [g.key, shownOf(state, g)]))
  const pool = [...[...earlier, ...(cur ? [cur] : [])].flatMap((g) => shown.get(g.key) ?? []), ...threadActions(state)]
  const lines: string[] = []
  for (const g of earlier) {
    const els = shown.get(g.key) ?? []
    const figs = new Set(els.flatMap((a) => (a.t === 'plot' || a.t === 'explore' ? [a.id] : [])))
    for (const a of els) {
      const keep = a.t === 'plot' || a.t === 'explore' || ((a.t === 'point' || a.t === 'line' || a.t === 'guide') && figs.has(a.plot))
      if (keep) lines.push(...boardLines(state, a, pool))
    }
  }
  if (cur) for (const a of shown.get(cur.key) ?? shownOf(state, cur)) lines.push(...boardLines(state, a, pool))
  return lines.join('\n')
}

// ------------------------------------------------------------------------------------ <plan>, <learner>

function outcomeOf(s: LessonState, n: number): string {
  const c = s.segments[`seg:${n}`]?.check
  const rec = c ? s.checks[c.id] : undefined
  if (rec?.outcome) return rec.outcome
  if (rec && rec.attempts > 0) return `wrong ${rec.attempts}×, not yet right`
  return ''
}

function warmupLine(s: LessonState): string {
  const w = s.warmup
  if (!w) return ''
  const right = w.record.options.find((o) => o.correct)
  const guess = w.answer !== undefined ? w.record.options.find((o) => o.id === w.answer) : undefined
  const said = w.skipped ? 'they skipped it' : guess ? `they guessed "${clean(guess.text)}"` : 'not answered yet'
  return `Warm-up: "${clean(w.record.prompt)}" Answer: "${clean(right?.text ?? '?')}"; ${said}.`
}

function planBlock(s: LessonState, now: number | null): string {
  const lines = [`Objective: ${clean(s.objective ?? s.topic)}`]
  const w = warmupLine(s)
  if (w) lines.push(w)
  for (const p of s.plan) {
    const o = outcomeOf(s, p.n)
    lines.push(`${p.n}. ${clean(p.title)}: ${clean(p.goal)} (${p.representation}; ${p.check} check)${o ? ` [${o}]` : ''}${p.n === now ? ' ← now' : ''}`)
  }
  return lines.join('\n')
}

function learnerBlock(s: LessonState, n: number | null): string {
  const l = s.learner
  const answers = Object.values(s.checks)
    .filter((r) => r.attempts > 0 || r.outcome)
    .map((r) => {
      const owner = checkOwner(s, r.id)
      const mis = l.misconceptions.filter((m) => m.checkId === r.id).map((m) => clean(m.text))
      return {
        check: r.id,
        seg: owner?.n,
        tries: r.branches.map((b) => clean(branchText(owner?.check, b))),
        ...(r.outcome ? { outcome: r.outcome } : {}),
        ...(mis.length ? { misconceptions: mis } : {}),
        ...(r.unsure ? { unsure: r.unsure } : {}),
      }
    })
  const lost = n === null ? { lost: l.lostCount } : { lostThisSegment: l.lostCount[n] ?? 0 }
  return JSON.stringify({
    answers,
    misconceptions: l.misconceptions.map((m) => ({ text: clean(m.text), resolved: m.resolved })),
    unsure: l.unsure,
    ...lost,
    questions: l.questions.slice(-5).map((q) => clean(q, PAST_QUESTION_MAX)),
  })
}

function lessonBlocks(s: LessonState, now: number | null, boardKey: SegKey | null): string[] {
  const out = [block('plan', planBlock(s, now)), block('learner', learnerBlock(s, now))]
  if (boardKey) out.push(block('board', listBoard(s, boardKey) || '(empty)'))
  return out
}

/** Things referenced by an action (step from, solutions of, point/line/guide plot), as JSON lines. */
function relatedJson(s: LessonState | undefined, a: Action): string[] {
  if (!s) return []
  const ids = a.t === 'step' && a.from ? [a.from]
    : a.t === 'solutions' ? [a.of]
      : a.t === 'point' || a.t === 'line' || a.t === 'guide' ? [a.plot]
        : a.t === 'mark' ? [a.target]
          : []
  return ids.flatMap((id) => {
    const r = findAction(s, id)
    return r ? [actionJson(r)] : []
  })
}

function verificationText(v: Verification): string {
  if (v.status === 'pass') return 'passed'
  if (v.status === 'fail') return `failed: ${clean(v.evidence ?? 'no detail')}`
  return 'could not check this (not machine-checkable)'
}

// ------------------------------------------------------------------------------------- the message

function answerPrefix(s: LessonState, question: string): string {
  let i = -1
  s.threads.forEach((t, k) => {
    if (t.question === question) i = k
  })
  return `a${(i >= 0 ? i : s.threads.length) + 1}`
}

/** The says of the most recent earlier answer to the same question, for follow-ups. */
function previousAnswer(s: LessonState, question: string): string | undefined {
  const done = s.threads.filter((t) => t.question === question && t.beats.length > 0)
  const last = done[done.length - 1]
  if (!last) return undefined
  return clean(last.beats.map((b) => b.say).filter(Boolean).join(' '), 300)
}

function segHistory(s: LessonState, n: number): 'first' | 'trouble' | 'fine' {
  if (n === 1) return 'first'
  const l = s.learner
  const trouble = l.answers.some((a) => !a.correct) || l.misconceptions.some((m) => !m.resolved) || l.unsure > 0 ||
    Object.values(l.lostCount).some((k) => k > 0)
  return trouble ? 'trouble' : 'fine'
}

export function buildUserMessage<R extends Role>(role: R, ctx: RoleContextMap[R]): string {
  const parts = buildParts(role, ctx as RoleContext)
  return parts.join('\n\n')
}

function buildParts(role: Role, ctx: RoleContext): string[] {
  switch (role) {
    case 'plan': {
      const c = ctx as RoleContextMap['plan']
      return [block('learner_text', learnerText(c.topic, TOPIC_MAX)), block('task', planTask())]
    }
    case 'segment': {
      const c = ctx as RoleContextMap['segment']
      const p = planOf(c.state, c.n)
      const plan: SegmentPlan = p ?? {
        t: 'segment', n: c.n, title: `Segment ${c.n}`, goal: c.state.objective ?? c.state.topic,
        representation: 'worked', misconception: 'none named', check: 'choice',
      }
      const safe: SegmentPlan = { ...plan, title: clean(plan.title), goal: clean(plan.goal), misconception: clean(plan.misconception) }
      return [
        ...lessonBlocks(c.state, c.n, `seg:${c.n}`),
        block('task', segmentTask({ plan: safe, prefix: `s${c.n}`, used: usedIds(c.state), history: segHistory(c.state, c.n) })),
      ]
    }
    case 'reteach': {
      const c = ctx as RoleContextMap['reteach']
      const owner = checkOwner(c.state, c.checkId)
      const n = owner?.n ?? cursorN(c.state)
      const rep = planOf(c.state, n)?.representation ?? 'worked'
      return [
        ...lessonBlocks(c.state, n, `seg:${n}`),
        block('task', reteachTask({
          n, representation: rep, check: checkSummary(c.state, c.checkId, c.branch), misconception: clean(c.misconception ?? ''),
          prefix: `r${n}`, used: usedIds(c.state),
        })),
      ]
    }
    case 'solution': {
      const c = ctx as RoleContextMap['solution']
      const n = checkOwner(c.state, c.checkId)?.n ?? cursorN(c.state)
      const mis = c.state.learner.misconceptions.filter((m) => m.checkId === c.checkId).map((m) => clean(m.text))
      return [
        ...lessonBlocks(c.state, n, `seg:${n}`),
        block('task', solutionTask({ n, check: checkSummary(c.state, c.checkId), misconceptions: mis, prefix: `sol${n}`, used: usedIds(c.state) })),
      ]
    }
    case 'lost': {
      const c = ctx as RoleContextMap['lost']
      const k = c.state.learner.lostCount[c.n] ?? 1
      const p = planOf(c.state, c.n)
      const plan = p ? { ...p, title: clean(p.title), goal: clean(p.goal) } : undefined
      return [
        ...lessonBlocks(c.state, c.n, `seg:${c.n}`),
        block('task', lostTask({ plan, n: c.n, style: clean(c.style), prefix: `l${c.n}k${k}`, used: usedIds(c.state) })),
      ]
    }
    case 'answer': {
      const c = ctx as RoleContextMap['answer']
      const n = cursorN(c.state)
      const targets = c.targets.map((id) => {
        const a = findAction(c.state, id)
        return a ? `${neutralise(id)} (${a.t}: ${clean(contentOf(a, allActions(c.state)), CONTENT_MAX)})` : neutralise(id)
      })
      return [
        ...lessonBlocks(c.state, n, c.state.cursor.seg),
        block('learner_text', learnerText(c.question, QUESTION_MAX)),
        block('task', answerTask({
          n, targets, ...(c.followUp ? { followUp: c.followUp } : {}),
          ...(c.followUp ? { previous: previousAnswer(c.state, c.question) } : {}),
          prefix: answerPrefix(c.state, c.question), used: usedIds(c.state),
        })),
      ]
    }
    case 'recap': {
      const c = ctx as RoleContextMap['recap']
      const s = c.state
      const weak: string[] = []
      const outcomes = s.plan.map((p) => {
        const o = outcomeOf(s, p.n) || 'not reached'
        if (o !== 'first-try') weak.push(`seg ${p.n}`)
        const chk = s.segments[`seg:${p.n}`]?.check
        const mis = chk ? s.learner.misconceptions.filter((m) => m.checkId === chk.id).map((m) => clean(m.text)) : []
        return `seg ${p.n} "${clean(p.title)}": ${o}${mis.length ? ` (misconception: ${mis.join('; ')})` : ''}`
      })
      const warm = warmupLine(s).replace(/^Warm-up: /, '') || 'none'
      return [...lessonBlocks(s, null, null), block('task', recapTask({ outcomes, warmup: warm, weak }))]
    }
    case 'review': {
      const c = ctx as RoleContextMap['review']
      const a = findAction(c.state, c.elementId)
      const home = segmentsInOrder(c.state).find((g) => elementsOf(c.state, g).some((x) => idOf(x) === c.elementId))
      const key = home?.key ?? c.state.cursor.seg
      return [
        ...lessonBlocks(c.state, home?.n ?? cursorN(c.state), key),
        block('task', reviewTask({
          element: a ? actionJson(a) : `(element ${neutralise(c.elementId)} not found)`,
          related: a ? relatedJson(c.state, a) : [],
          verification: verificationText(c.localVerification),
        })),
      ]
    }
    case 'repair': {
      const c = ctx as RoleContextMap['repair']
      return [block('task', repairTask({ line: actionJson(c.action), evidence: clean(c.evidence), related: relatedJson(c.state, c.action) }))]
    }
  }
}
