/**
 * Lesson flow: cursor movement, end-of-segment rules, checkpoints and the feedback ladder,
 * and "I'm lost". Every function is pure and returns a new state (or the same one for a no-op).
 */
import { templateFor } from '../layout/engine'
import type { EventOf } from './events'
import { recordAnswer, recordLost, recordUnsure } from './learner'
import type { Cursor, LessonState, SegKey, SegmentKind, SegmentState } from './types'

export const mainKey = (n: number): SegKey => `seg:${n}`

export const putSeg = (s: LessonState, seg: SegmentState): LessonState => ({
  ...s, segments: { ...s.segments, [seg.key]: seg },
})

export const isCursor = (r: SegmentState['returnTo']): r is Cursor => !!r && 'seg' in r

/** A main segment `seg:n` becomes pending (appended to `order`) if planned and not already there. */
export function ensureMain(s: LessonState, n: number): LessonState {
  const key = mainKey(n)
  const plan = s.plan[n - 1]
  if (!plan || s.segments[key]) return s
  const seg: SegmentState = {
    key, kind: 'main', n, status: 'pending', beats: [], asks: [], template: templateFor(plan.representation), regenerated: false,
  }
  return { ...putSeg(s, seg), order: [...s.order, key] }
}

/** Inserts a pending reteach/solution/lost segment right after the cursor's segment and moves the cursor to it. */
function insertAndGo(
  s: LessonState, key: SegKey, kind: Exclude<SegmentKind, 'main'>, n: number, returnTo?: SegmentState['returnTo'],
): LessonState {
  if (s.segments[key]) return s
  const template = s.segments[mainKey(n)]?.template ?? 'notes'
  const seg: SegmentState = {
    key, kind, n, status: 'pending', beats: [], asks: [], template, regenerated: false, ...(returnTo ? { returnTo } : {}),
  }
  const at = s.order.indexOf(s.cursor.seg)
  const order = at < 0 ? [...s.order, key] : [...s.order.slice(0, at + 1), key, ...s.order.slice(at + 1)]
  const { currentCheck: _drop, ...rest } = putSeg(s, seg)
  return { ...rest, order, cursor: { seg: key, beat: 0 }, phase: 'teaching' }
}

/** The main segment n whose check has this id. */
const checkOwner = (s: LessonState, checkId: string): number | undefined =>
  Object.values(s.segments).find((g) => g.kind === 'main' && g.check?.id === checkId)?.n

function reachCheckpoint(s: LessonState, checkId: string): LessonState {
  const checks = s.checks[checkId] ? s.checks : { ...s.checks, [checkId]: { id: checkId, attempts: 0, branches: [], unsure: 0 } }
  const n = checkOwner(s, checkId)
  const next = { ...s, phase: 'checkpoint' as const, currentCheck: checkId, checks }
  return n === undefined ? next : ensureMain(next, n + 1)
}

/** After main segment n is resolved: go to seg:n+1 (making it pending if needed), or to the recap. */
function moveOn(s: LessonState, n: number): LessonState {
  const { currentCheck: _drop, ...rest } = s
  if (s.plan[n]) {
    const t = ensureMain(rest, n + 1)
    return { ...t, phase: 'teaching', cursor: { seg: mainKey(n + 1), beat: 0 } }
  }
  return { ...rest, phase: 'recap', recap: s.recap ?? { ideas: [], practice: [], status: 'pending' } }
}

function endOfSegment(s: LessonState, seg: SegmentState): LessonState {
  const atEnd = { ...s, cursor: { seg: seg.key, beat: seg.beats.length } }
  switch (seg.kind) {
    case 'main':
      return seg.check ? reachCheckpoint(atEnd, seg.check.id) : moveOn(atEnd, seg.n)
    case 'reteach':
      return seg.returnTo && !isCursor(seg.returnTo) ? reachCheckpoint(atEnd, seg.returnTo.checkpoint) : moveOn(atEnd, seg.n)
    case 'solution':
      return moveOn(atEnd, seg.n)
    case 'lost':
      if (isCursor(seg.returnTo)) return { ...s, phase: 'teaching', cursor: seg.returnTo }
      return seg.returnTo ? reachCheckpoint(atEnd, seg.returnTo.checkpoint) : moveOn(atEnd, seg.n)
  }
}

export function advance(s: LessonState): LessonState {
  const pb = s.playback
  if (pb.track === 'answer') {
    const t = s.threads.find((x) => x.id === pb.threadId)
    if (!t || pb.beat >= t.beats.length) return s
    return { ...s, playback: { ...pb, beat: pb.beat + 1 } }
  }
  if (s.phase !== 'teaching') return s
  const seg = s.segments[s.cursor.seg]
  if (!seg) return s
  const nextBeat = s.cursor.beat + 1
  if (seg.status === 'complete' && nextBeat >= seg.beats.length) return endOfSegment(s, seg)
  if (s.cursor.beat >= seg.beats.length) return s // waiting for the next beat ("thinking")
  return { ...s, cursor: { seg: seg.key, beat: nextBeat } }
}

/**
 * Seek within the cursor's segment only (step back/forward, replay this segment). From a checkpoint,
 * seeking replays the segment; reaching its end again returns to the same checkpoint (attempts kept).
 */
export function seek(s: LessonState, e: EventOf<'player/seek'>): LessonState {
  if (s.phase !== 'teaching' && s.phase !== 'checkpoint') return s
  const seg = s.segments[e.cursor.seg]
  if (!seg || seg.key !== s.cursor.seg) return s
  const beat = Math.max(0, Math.min(Math.floor(e.cursor.beat), seg.beats.length))
  const { currentCheck: _drop, ...rest } = s
  return { ...rest, phase: 'teaching', cursor: { seg: seg.key, beat } }
}

const atCheck = (s: LessonState, checkId: string): boolean => s.phase === 'checkpoint' && s.currentCheck === checkId

export function answer(s: LessonState, e: EventOf<'check/answer'>): LessonState {
  const rec = s.checks[e.checkId]
  if (!atCheck(s, e.checkId) || !rec) return s
  const n = checkOwner(s, e.checkId) ?? s.segments[s.cursor.seg]?.n ?? 1
  const attempts = rec.attempts + 1
  const correct = e.grade.result === 'correct'
  const outcome = correct ? (attempts === 1 ? 'first-try' : 'after-reteach') : attempts >= 2 ? 'solution' : undefined
  const t: LessonState = {
    ...s,
    learner: recordAnswer(s.learner, e.checkId, e.grade),
    checks: { ...s.checks, [e.checkId]: { ...rec, attempts, branches: [...rec.branches, e.grade.branch], ...(outcome ? { outcome } : {}) } },
  }
  if (correct) return moveOn(t, n)
  if (attempts === 1) return insertAndGo(t, `reteach:${e.checkId}:${attempts}`, 'reteach', n, { checkpoint: e.checkId })
  return insertAndGo(t, `solution:${e.checkId}`, 'solution', n)
}

export function skip(s: LessonState, e: EventOf<'check/skip'>): LessonState {
  const rec = s.checks[e.checkId]
  if (!atCheck(s, e.checkId) || !rec) return s
  const n = checkOwner(s, e.checkId) ?? s.segments[s.cursor.seg]?.n ?? 1
  return moveOn({ ...s, checks: { ...s.checks, [e.checkId]: { ...rec, outcome: 'skipped' } } }, n)
}

export function unsure(s: LessonState, e: EventOf<'check/unsure'>): LessonState {
  const rec = s.checks[e.checkId]
  if (!atCheck(s, e.checkId) || !rec) return s
  return { ...s, learner: recordUnsure(s.learner), checks: { ...s.checks, [e.checkId]: { ...rec, unsure: rec.unsure + 1 } } }
}

export function lost(s: LessonState): LessonState {
  if (s.phase !== 'teaching' && s.phase !== 'checkpoint') return s
  const cur = s.segments[s.cursor.seg]
  if (!cur) return s
  const n = cur.n
  const k = Object.values(s.segments).filter((g) => g.kind === 'lost' && g.n === n).length + 1
  const returnTo = s.phase === 'checkpoint' && s.currentCheck ? { checkpoint: s.currentCheck } : s.cursor
  const t = { ...s, learner: recordLost(s.learner, n, k) }
  return insertAndGo(t, `lost:${n}:${k}`, 'lost', n, returnTo)
}
