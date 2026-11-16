/**
 * The lesson state machine: `reduce` folds one `LessonEvent` into an immutable `LessonState`.
 * Handlers are split by event family:
 *   machine.ts       lifecycle: start, plan, warm-up, problem overlay, done
 *   machine-flow.ts  player cursor, end-of-segment rules, checkpoints, feedback ladder, "I'm lost"
 *   machine-side.ts  segment content, patches/strikes, interrupts and threads, recap and practice
 * Events that do not apply in the current phase are ignored (the same state is returned).
 */
import type { EventOf, LessonEvent } from './events'
import { emptyLearner } from './learner'
import { advance, answer, ensureMain, goTo, lost, seek, skip, unsure } from './machine-flow'
import { interrupt, patch, recap, segment, strike } from './machine-side'
import type { LessonState } from './types'

export const MAX_PLANNED_SEGMENTS = 5

function start(e: EventOf<'lesson/start'>): LessonState {
  return {
    id: e.id, topic: e.topic, createdAt: e.at, badge: e.badge,
    phase: 'planning', plan: [], segments: {}, order: [], cursor: { seg: 'seg:1', beat: 0 }, visited: [],
    checks: {}, threads: [], overlay: null, playback: { track: 'lesson' }, struck: [], patches: {},
    practice: {}, learner: emptyLearner(),
  }
}

function planRecord(s: LessonState, e: EventOf<'plan/record'>): LessonState {
  if (s.phase !== 'planning') return s
  const r = e.record
  switch (r.t) {
    case 'scope':
      return { ...s, scope: r }
    case 'objective':
      return { ...s, objective: r.text }
    case 'warmup':
      return s.warmup ? s : { ...s, warmup: { record: r } }
    case 'segment': {
      if (s.plan.length >= MAX_PLANNED_SEGMENTS) return s
      // Numbered by arrival so a model's gap or duplicate cannot desync seg:n from plan[n-1].
      const n = s.plan.length + 1
      const t = { ...s, plan: [...s.plan, { ...r, n }] }
      return n === 1 ? ensureMain(t, 1) : t
    }
  }
}

function planDone(s: LessonState): LessonState {
  if (s.phase !== 'planning' || s.scope?.verdict === 'declined' || s.plan.length === 0) return s
  return goTo({ ...s, phase: s.warmup ? 'warmup' : 'teaching' }, { seg: 'seg:1', beat: 0 })
}

function warmup(s: LessonState, e: EventOf<'warmup/answer'> | EventOf<'warmup/skip'>): LessonState {
  if (s.phase !== 'warmup' || !s.warmup) return s
  const w = e.type === 'warmup/answer' ? { ...s.warmup, answer: e.optionId } : { ...s.warmup, skipped: true }
  return { ...s, warmup: w, phase: 'teaching' }
}

function problem(s: LessonState, e: EventOf<'error'> | EventOf<'error/clear'>): LessonState {
  if (e.type === 'error/clear') {
    if (s.overlay?.kind !== 'problem') return s
    return { ...s, overlay: s.overlay.prev ?? null }
  }
  const prev = s.overlay?.kind === 'interrupt' ? s.overlay : s.overlay?.prev
  return { ...s, overlay: { kind: 'problem', error: e.error, retry: e.retry, ...(prev ? { prev } : {}) } }
}

export function reduce(state: LessonState | null, e: LessonEvent): LessonState {
  if (e.type === 'lesson/start') return start(e)
  if (!state) throw new Error(`lesson: '${e.type}' before 'lesson/start'`)
  const s = state
  switch (e.type) {
    case 'plan/record': return planRecord(s, e)
    case 'plan/done': return planDone(s)
    case 'warmup/answer':
    case 'warmup/skip': return warmup(s, e)
    case 'seg/stream':
    case 'seg/beat':
    case 'seg/check':
    case 'seg/ask':
    case 'seg/done':
    case 'seg/regenerate':
    case 'seg/failed': return segment(s, e)
    case 'beat/patch': return patch(s, e)
    case 'element/strike': return strike(s, e)
    case 'player/advance': return advance(s)
    case 'player/seek': return seek(s, e)
    case 'check/answer': return answer(s, e)
    case 'check/unsure': return unsure(s, e)
    case 'check/skip': return skip(s, e)
    case 'lost/request': return lost(s)
    case 'interrupt/open':
    case 'interrupt/ask':
    case 'interrupt/close':
    case 'thread/stream':
    case 'thread/beat':
    case 'thread/done':
    case 'thread/failed': return interrupt(s, e)
    case 'recap/stream':
    case 'recap/record':
    case 'recap/done':
    case 'recap/failed':
    case 'practice/start':
    case 'practice/answer':
    case 'practice/skip': return recap(s, e)
    case 'error':
    case 'error/clear': return problem(s, e)
    case 'lesson/done': return s.phase === 'done' ? s : { ...s, phase: 'done' }
  }
}

export function replay(events: readonly LessonEvent[]): LessonState {
  const s = events.reduce<LessonState | null>((acc, e) => reduce(acc, e), null)
  if (!s) throw new Error('lesson: cannot replay an empty log')
  return s
}
