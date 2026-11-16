import type { Action, CheckAction, SegmentPlan, WarmupRecord } from '../../../src/actions'
import type { Checked } from '../../../src/maths/verify'
import type { Beat } from '../../../src/pipeline/beats'
import type { PipelineSummary } from '../../../src/pipeline/board-pipeline'
import type { LessonEvent } from '../../../src/lesson/events'
import { reduce } from '../../../src/lesson/machine'
import type { LessonState, SegKey } from '../../../src/lesson/types'
import type { Badge } from '../../../src/sources/types'

export const badge: Badge = { mode: 'recorded', text: 'RECORDED · m · captured 1 Nov 2026', model: 'm', billedTo: 'recording' }

export const segPlan = (n: number, representation: SegmentPlan['representation'] = 'worked'): SegmentPlan => ({
  t: 'segment', n, title: `Segment ${n}`, goal: 'g', representation, misconception: 'm', check: 'choice',
})

export const warmupRec: WarmupRecord = {
  t: 'warmup', id: 'w1', prompt: 'Guess?',
  options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }],
}

export const chk = (a: Action): Checked => ({ ...a, verify: { status: 'pass' } }) as Checked

export const beat = (key: string, i: number): Beat => ({
  id: `${key}#${i}`, say: `beat ${i}`, ink: 'lesson', actions: [chk({ t: 'write', id: `w${key.replace(/\W/g, '')}${i}`, text: 'x' })],
})

export const check = (id: string): Checked<CheckAction> =>
  ({
    t: 'check', id, kind: 'choice', prompt: 'p', explain: 'e', hint: 'h',
    options: [
      { id: 'a', text: 'A', correct: true },
      { id: 'b', text: 'B', correct: false, misconception: 'thinks B' },
    ],
    verify: { status: 'pass' },
  }) as Checked<CheckAction>

export const summary: PipelineSummary = { accepted: 3, rejected: 0, failed: [], hasCheck: true, truncated: false }

export const start: LessonEvent = { type: 'lesson/start', id: 'L1', topic: 'vertex form', badge, at: '2026-11-16T10:00:00.000Z' }

export const run = (events: LessonEvent[], from: LessonState | null = null): LessonState =>
  events.reduce<LessonState | null>((s, e) => reduce(s, e), from) as LessonState

/** Stream a full segment: stream, `nBeats` beats, optional check, done. */
export const fill = (key: SegKey, nBeats: number, checkId?: string): LessonEvent[] => [
  { type: 'seg/stream', key },
  ...Array.from({ length: nBeats }, (_, i): LessonEvent => ({ type: 'seg/beat', key, beat: beat(key, i) })),
  ...(checkId ? [{ type: 'seg/check', key, check: check(checkId) } as LessonEvent] : []),
  { type: 'seg/done', key, summary },
]

export const advance = (times: number): LessonEvent[] => Array.from({ length: times }, () => ({ type: 'player/advance' }) as LessonEvent)

/** Planned (2 segments by default), no warm-up, teaching seg:1 which is complete with 2 beats and check c1. */
export const teaching = (planned = 2): LessonState =>
  run([
    start,
    ...Array.from({ length: planned }, (_, i): LessonEvent => ({ type: 'plan/record', record: segPlan(i + 1, i === 0 ? 'graph' : 'worked') })),
    { type: 'plan/done' },
    ...fill('seg:1', 2, 'c1'),
  ])

/** At the checkpoint of seg:1 (check c1). */
export const atCheckpoint = (planned = 2): LessonState => run(advance(2), teaching(planned))

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}
