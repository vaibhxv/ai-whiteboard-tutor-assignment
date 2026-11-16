/** Pure view helpers for the lesson screen: element index, progress rail, titles, practice verdicts. */
import type { Action, CheckAction, IdeaRecord } from '../actions'
import { elementsByOwner, idOf } from '../lesson/controller-support'
import type { LessonState, SegKey, SegmentState } from '../lesson/types'

/** Every element in the lesson by id (patched, without verification), for the Board and descriptions. */
export function buildIndex(s: LessonState): Map<string, Action> {
  const m = new Map<string, Action>()
  for (const acts of elementsByOwner(s).values()) {
    for (const a of acts) {
      const id = idOf(a)
      if (id) m.set(id, a)
    }
  }
  return m
}

const EXTRA: Record<Exclude<SegmentState['kind'], 'main'>, string> = {
  reteach: 'Another look',
  solution: 'Worked solution',
  lost: 'Said more simply',
}

export function segmentTitle(s: LessonState, key: SegKey): string {
  const g = s.segments[key]
  if (!g) return key
  if (g.kind === 'main') return s.plan[g.n - 1]?.title ?? `Part ${g.n}`
  return `${EXTRA[g.kind]} (extra)`
}

export type RailStatus = 'done' | 'current' | 'future'
export type RailItem = { key: SegKey | 'recap'; label: string; status: RailStatus; extra: boolean }

const AFTER_LESSON = new Set(['recap', 'practice', 'done'])

/** Main segments in plan order, each followed by the segments inserted for it; then the recap. */
export function railItems(s: LessonState): RailItem[] {
  const after = AFTER_LESSON.has(s.phase)
  const status = (key: SegKey): RailStatus => {
    if (!after && key === s.cursor.seg) return 'current'
    return s.visited.includes(key) && s.segments[key]?.status === 'complete' ? 'done' : 'future'
  }
  const items: RailItem[] = []
  s.plan.forEach((p, i) => {
    const n = i + 1
    const main: SegKey = `seg:${n}`
    items.push({ key: main, label: p.title, status: status(main), extra: false })
    for (const k of s.order) {
      const g = s.segments[k]
      if (g && g.kind !== 'main' && g.n === n) items.push({ key: k, label: segmentTitle(s, k), status: status(k), extra: true })
    }
  })
  if (s.plan.length > 0) items.push({ key: 'recap', label: 'Recap', status: after ? 'current' : 'future', extra: false })
  return items
}

/** Tap checkpoints: the selection counts when it is the figure, one of its functions, or something plotted on it. */
export function selectedInFigure(check: CheckAction, selected: string | undefined, index: ReadonlyMap<string, Action>): string | undefined {
  if (check.kind !== 'tap' || !selected) return undefined
  if (selected === check.figure) return selected
  const fig = index.get(check.figure)
  if (fig?.t === 'plot' && fig.fns.some((f) => f.id === selected)) return selected
  const a = index.get(selected)
  return a && 'plot' in a && a.plot === check.figure ? selected : undefined
}

export type IdeaVerdict = { idea: IdeaRecord; solid: boolean }

/**
 * Solid when every practice question on the idea was right; with no practice question on it, when its
 * segment's checkpoint was passed (first try or after the re-teach). Anything else is shaky.
 */
export function ideaVerdicts(s: LessonState): IdeaVerdict[] {
  const r = s.recap
  if (!r) return []
  return r.ideas.map((idea) => {
    const qs = r.practice.filter((c) => c.idea === idea.id)
    if (qs.length > 0) return { idea, solid: qs.every((c) => s.practice[c.id]?.result === 'correct') }
    const check = s.segments[`seg:${idea.seg}`]?.check
    const outcome = check ? s.checks[check.id]?.outcome : undefined
    return { idea, solid: outcome === 'first-try' || outcome === 'after-reteach' }
  })
}

const noStop = (t: string) => t.replace(/[.!?]+$/, '')

/** The recap's warm-up revisit lines, or null when there was no warm-up. */
export function warmupRevisit(s: LessonState): { guess: string; answer?: string } | null {
  const w = s.warmup
  if (!w) return null
  const opt = (id?: string) => w.record.options.find((o) => o.id === id)?.text
  const correct = w.record.options.find((o) => o.correct)?.text
  const guess = w.answer && opt(w.answer) ? `Earlier you guessed: ${noStop(opt(w.answer)!)}.` : 'You skipped the warm-up guess.'
  return { guess, ...(correct ? { answer: `The answer: ${correct}` } : {}) }
}
