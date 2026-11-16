/**
 * Content and side-channel handlers: segment generation events, board patches, interrupts and
 * answer threads, recap and practice. Pure; each returns a new state (or the same one for a no-op).
 */
import type { CheckAction } from '../actions'
import type { Checked } from '../maths/verify'
import type { EventOf, LessonEvent } from './events'
import { recordQuestion } from './learner'
import { putSeg } from './machine-flow'
import type { AnswerThread, LessonState, SegKey, SegmentState } from './types'

type SegEvent = Extract<LessonEvent, { type: `seg/${string}` }>

function withSeg(s: LessonState, key: SegKey, f: (g: SegmentState) => SegmentState): LessonState {
  const g = s.segments[key]
  if (!g) return s
  const next = f(g)
  return next === g ? s : putSeg(s, next)
}

export function segment(s: LessonState, e: SegEvent): LessonState {
  switch (e.type) {
    case 'seg/stream':
      return withSeg(s, e.key, (g) => (g.status === 'pending' ? { ...g, status: 'streaming' } : g))
    case 'seg/beat':
      return withSeg(s, e.key, (g) => ({ ...g, status: g.status === 'pending' ? 'streaming' : g.status, beats: [...g.beats, e.beat] }))
    case 'seg/check':
      return withSeg(s, e.key, (g) => ({ ...g, check: e.check }))
    case 'seg/ask':
      return withSeg(s, e.key, (g) => ({ ...g, asks: [...g.asks, e.ask] }))
    case 'seg/done':
      return withSeg(s, e.key, (g) => ({ ...g, status: 'complete' }))
    case 'seg/failed':
      return withSeg(s, e.key, (g) => ({ ...g, status: 'failed' }))
    case 'seg/regenerate': {
      const t = withSeg(s, e.key, ({ check: _drop, ...g }) => ({ ...g, status: 'pending', regenerated: true, beats: [], asks: [] }))
      return t.cursor.seg === e.key && t.cursor.beat !== 0 ? { ...t, cursor: { seg: e.key, beat: 0 } } : t
    }
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
    case 'thread/stream':
      return withThread(s, e.threadId, (t) => (t.status === 'pending' ? { ...t, status: 'streaming' } : t))
    case 'thread/beat':
      return withThread(s, e.threadId, (t) => ({ ...t, status: t.status === 'pending' ? 'streaming' : t.status, beats: [...t.beats, e.beat] }))
    case 'thread/done':
      return withThread(s, e.threadId, (t) => ({ ...t, status: 'complete' }))
    case 'thread/failed':
      return withThread(s, e.threadId, (t) => ({ ...t, status: 'failed' }))
    case 'interrupt/close': {
      const id = s.overlay?.kind === 'interrupt' ? s.overlay.threadId : undefined
      if (e.outcome === 'cancel') {
        // A question that never started is abandoned, so the controller stops seeing it in needs().
        const t = id ? withThread(s, id, (x) => (x.status === 'pending' ? { ...x, status: 'failed' } : x)) : s
        return { ...t, overlay: null, playback: { track: 'lesson' } }
      }
      const outcome = e.outcome
      const t = id ? withThread(s, id, (x) => ({ ...x, outcome })) : s
      if (outcome !== 'clear') return t // overlay stays open for the follow-up ask
      return { ...t, overlay: null, playback: { track: 'lesson' } }
    }
  }
}

type RecapEvent = Extract<LessonEvent, { type: `recap/${string}` | `practice/${string}` }>

const finishPractice = (s: LessonState): LessonState =>
  s.phase === 'practice' && (s.recap?.practice ?? []).every((c) => s.practice[c.id]) ? { ...s, phase: 'done' } : s

export function recap(s: LessonState, e: RecapEvent): LessonState {
  const r = s.recap
  switch (e.type) {
    case 'recap/stream':
      return r && r.status === 'pending' ? { ...s, recap: { ...r, status: 'streaming' } } : s
    case 'recap/record': {
      if (!r) return s
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
      return r ? { ...s, recap: { ...r, status: 'complete' } } : s
    case 'recap/failed':
      return r ? { ...s, recap: { ...r, status: 'failed' } } : s
    case 'practice/start':
      return s.phase === 'recap' ? finishPractice({ ...s, phase: 'practice' }) : s
    case 'practice/answer':
      if (s.phase !== 'practice') return s
      return finishPractice({ ...s, practice: { ...s.practice, [e.checkId]: { result: e.grade.result } } })
    case 'practice/skip':
      if (s.phase !== 'practice') return s
      return finishPractice({ ...s, practice: { ...s.practice, [e.checkId]: { result: 'skipped' } } })
  }
}
