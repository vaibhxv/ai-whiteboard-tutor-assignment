/**
 * Content and side-channel handlers: segment generation events, board patches, interrupts and
 * answer threads, recap and practice. Pure; each returns a new state (or the same one for a no-op).
 */
import type { CheckAction } from '../actions'
import type { Checked } from '../maths/verify'
import type { EventOf, LessonEvent } from './events'
import { recordQuestion } from './learner'
import { putSeg } from './machine-flow'
import type { AnswerThread, GenStatus, LessonState, Overlay, SegKey, SegmentState } from './types'

type SegEvent = Extract<LessonEvent, { type: `seg/${string}` }>

function withSeg(s: LessonState, key: SegKey, f: (g: SegmentState) => SegmentState): LessonState {
  const g = s.segments[key]
  if (!g) return s
  const next = f(g)
  return next === g ? s : putSeg(s, next)
}

const live = (g: { status: GenStatus }): boolean => g.status === 'pending' || g.status === 'streaming'

/** Empties a segment's generated content; `regenerated` is left to the caller. */
const cleared = ({ check: _drop, ...g }: SegmentState, status: GenStatus): SegmentState => ({ ...g, status, beats: [], asks: [] })

/**
 * After a segment's content is thrown away, a cursor on it restarts at beat 0; if it was waiting at that
 * segment's checkpoint, it goes back to teaching (the new content brings its own check).
 */
function restartCursorOn(s: LessonState, key: SegKey): LessonState {
  if (s.cursor.seg !== key) return s
  const { currentCheck: _drop, ...rest } = s
  if (s.phase === 'checkpoint') return { ...rest, phase: 'teaching', cursor: { seg: key, beat: 0 } }
  return s.cursor.beat === 0 ? s : { ...s, cursor: { seg: key, beat: 0 } }
}

/** `seg/beat|check|ask|done` are accepted only while the segment is pending or streaming (late events from an aborted stream are dropped). */
export function segment(s: LessonState, e: SegEvent): LessonState {
  switch (e.type) {
    case 'seg/stream': {
      const g = s.segments[e.key]
      if (g?.status === 'pending') return putSeg(s, { ...g, status: 'streaming' })
      if (g?.status === 'failed') return restartCursorOn(putSeg(s, cleared(g, 'streaming')), e.key) // retry
      return s
    }
    case 'seg/beat':
      return withSeg(s, e.key, (g) => (live(g) ? { ...g, status: 'streaming', beats: [...g.beats, e.beat] } : g))
    case 'seg/check':
      return withSeg(s, e.key, (g) => (live(g) ? { ...g, check: e.check } : g))
    case 'seg/ask':
      return withSeg(s, e.key, (g) => (live(g) ? { ...g, asks: [...g.asks, e.ask] } : g))
    case 'seg/done':
      return withSeg(s, e.key, (g) => (live(g) ? { ...g, status: 'complete' } : g))
    case 'seg/failed':
      return withSeg(s, e.key, (g) => (g.status === 'failed' ? g : { ...g, status: 'failed' }))
    case 'seg/regenerate':
      return restartCursorOn(withSeg(s, e.key, (g) => ({ ...cleared(g, 'pending'), regenerated: true })), e.key)
  }
}

export const patch = (s: LessonState, e: EventOf<'beat/patch'>): LessonState => ({
  ...s, patches: { ...s.patches, [e.actionId]: e.action },
})

export const strike = (s: LessonState, e: EventOf<'element/strike'>): LessonState =>
  s.struck.includes(e.id) ? s : { ...s, struck: [...s.struck, e.id] }

function withThread(s: LessonState, id: string, f: (t: AnswerThread) => AnswerThread): LessonState {
  const i = s.threads.findIndex((t) => t.id === id)
  const t = s.threads[i]
  if (!t) return s
  const threads = [...s.threads]
  threads[i] = f(t)
  return { ...s, threads }
}

type InterruptEvent = Extract<LessonEvent, { type: `interrupt/${string}` | `thread/${string}` }>

export function interrupt(s: LessonState, e: InterruptEvent): LessonState {
  switch (e.type) {
    case 'interrupt/open':
      return s.overlay?.kind === 'interrupt' ? s : { ...s, overlay: { kind: 'interrupt' } }
    case 'interrupt/ask': {
      if (s.threads.some((t) => t.id === e.threadId)) return s
      const thread: AnswerThread = {
        id: e.threadId, question: e.question, targets: e.targets, ...(e.askId ? { askId: e.askId } : {}), status: 'pending', beats: [],
      }
      return {
        ...s,
        threads: [...s.threads, thread],
        overlay: { kind: 'interrupt', threadId: e.threadId },
        playback: { track: 'answer', threadId: e.threadId, beat: 0 },
        learner: recordQuestion(s.learner, e.question),
      }
    }
    case 'thread/stream': {
      const x = s.threads.find((t) => t.id === e.threadId)
      if (x?.status === 'pending') return withThread(s, x.id, (t) => ({ ...t, status: 'streaming' }))
      if (x?.status !== 'failed') return s
      // Retry: drop the partial answer; if it is on screen, replay it from its first beat.
      const t = withThread(s, x.id, (y) => ({ ...y, status: 'streaming', beats: [] }))
      const pb = t.playback
      return pb.track === 'answer' && pb.threadId === x.id ? { ...t, playback: { ...pb, beat: 0 } } : t
    }
    case 'thread/beat':
      return withThread(s, e.threadId, (t) => (live(t) ? { ...t, status: 'streaming', beats: [...t.beats, e.beat] } : t))
    case 'thread/done':
      return withThread(s, e.threadId, (t) => (live(t) ? { ...t, status: 'complete' } : t))
    case 'thread/failed':
      return withThread(s, e.threadId, (t) => ({ ...t, status: 'failed' }))
    case 'interrupt/close': {
      const ov = s.overlay
      const interruptOv = ov?.kind === 'interrupt' ? ov : ov?.prev
      const id = interruptOv?.threadId
      // Closing the interrupt never hides a problem overlay; it only forgets the interrupt underneath it.
      const closed = (t: LessonState): LessonState => {
        let overlay: Overlay = null
        if (ov?.kind === 'problem') {
          const { prev: _drop, ...problem } = ov
          overlay = problem
        }
        return { ...t, overlay, playback: { track: 'lesson' } }
      }
      if (e.outcome === 'cancel') {
        // A question that never started is abandoned, so the controller stops seeing it in needs().
        const t = id ? withThread(s, id, (x) => (x.status === 'pending' ? { ...x, status: 'failed' } : x)) : s
        return closed(t)
      }
      const outcome = e.outcome
      const t = id ? withThread(s, id, (x) => ({ ...x, outcome })) : s
      if (outcome !== 'clear') return t // overlay stays open for the follow-up ask
      return closed(t)
    }
  }
}

type RecapEvent = Extract<LessonEvent, { type: `recap/${string}` | `practice/${string}` }>

const finishPractice = (s: LessonState): LessonState =>
  s.phase === 'practice' && s.recap?.status === 'complete' && s.recap.practice.every((c) => s.practice[c.id]) ? { ...s, phase: 'done' } : s

export function recap(s: LessonState, e: RecapEvent): LessonState {
  const r = s.recap
  switch (e.type) {
    case 'recap/stream':
      if (r?.status === 'pending') return { ...s, recap: { ...r, status: 'streaming' } }
      if (r?.status === 'failed') {
        const { say: _drop, ...rest } = r
        return { ...s, recap: { ...rest, status: 'streaming', ideas: [], practice: [] } } // retry
      }
      return s
    case 'recap/record': {
      if (!r || !live(r)) return s
      const rec = e.record
      const status = r.status === 'pending' ? 'streaming' : r.status
      if (rec.t === 'idea') return { ...s, recap: { ...r, status, ideas: [...r.ideas, rec] } }
      if (rec.t === 'say') return { ...s, recap: { ...r, status, say: r.say ? `${r.say} ${rec.text}` : rec.text } }
      if (rec.t === 'check') {
        const c = ('verify' in rec ? rec : { ...rec, verify: { status: 'unchecked' } }) as Checked<CheckAction>
        return { ...s, recap: { ...r, status, practice: [...r.practice, c] } }
      }
      return s
    }
    case 'recap/done':
      return r && live(r) ? { ...s, recap: { ...r, status: 'complete' } } : s
    case 'recap/failed':
      return r ? { ...s, recap: { ...r, status: 'failed' } } : s
    case 'practice/start':
      return s.phase === 'recap' && r?.status === 'complete' ? finishPractice({ ...s, phase: 'practice' }) : s
    case 'practice/answer':
      if (s.phase !== 'practice') return s
      return finishPractice({ ...s, practice: { ...s.practice, [e.checkId]: { result: e.grade.result } } })
    case 'practice/skip':
      if (s.phase !== 'practice') return s
      return finishPractice({ ...s, practice: { ...s.practice, [e.checkId]: { result: 'skipped' } } })
  }
}
