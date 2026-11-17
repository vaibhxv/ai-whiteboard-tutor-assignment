import { describe, expect, test } from 'vitest'
import type { LessonEvent } from '../../../src/lesson/events'
import { reduce, replay } from '../../../src/lesson/machine'
import { activeCheck, currentSegment, needs, pagesInput, stalledAtEnd, visibleBeatIds } from '../../../src/lesson/selectors'
import { createLessonStore } from '../../../src/lesson/store'
import type { LessonState } from '../../../src/lesson/types'
import {
  advance, atCheckpoint, beat, check, chk, deepFreeze, fill, run, segPlan, start, summary, teaching, warmupRec,
} from './helpers'

const wrong = (checkId = 'c1', misconception?: string): LessonEvent => ({
  type: 'check/answer', checkId, grade: { result: 'wrong', branch: 'b', ...(misconception ? { misconception } : {}) },
})
const right = (checkId = 'c1'): LessonEvent => ({ type: 'check/answer', checkId, grade: { result: 'correct', branch: 'a' } })

describe('transition table', () => {
  test('plan/record segment: appends to plan; seg:1 becomes pending on the first segment record', () => {
    let s = run([start])
    expect(s.phase).toBe('planning')
    expect(needs(s)).toEqual([])
    s = run([{ type: 'plan/record', record: { t: 'objective', text: 'See the vertex' } }], s)
    expect(s.objective).toBe('See the vertex')
    expect(s.segments['seg:1']).toBeUndefined()
    s = run([{ type: 'plan/record', record: segPlan(1, 'graph') }], s)
    expect(s.plan).toHaveLength(1)
    expect(s.segments['seg:1']).toMatchObject({ key: 'seg:1', kind: 'main', n: 1, status: 'pending', template: 'split', beats: [], asks: [], regenerated: false })
    expect(s.order).toEqual(['seg:1'])
    s = run([{ type: 'plan/record', record: segPlan(2) }], s)
    expect(s.plan).toHaveLength(2)
    expect(s.segments['seg:2']).toBeUndefined()
    expect(s.order).toEqual(['seg:1'])
  })

  test('plan/record scope declined: phase stays planning, scope kept for the UI', () => {
    const s = run([
      start,
      { type: 'plan/record', record: { t: 'scope', verdict: 'declined', reason: 'Not maths', suggest: ['slope'] } },
      { type: 'plan/done' },
    ])
    expect(s.phase).toBe('planning')
    expect(s.scope).toMatchObject({ verdict: 'declined', reason: 'Not maths' })
  })

  test('plan/done: warmup when a warm-up exists, otherwise teaching', () => {
    const withWarmup = run([start, { type: 'plan/record', record: warmupRec }, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/done' }])
    expect(withWarmup.phase).toBe('warmup')
    expect(withWarmup.warmup?.record.id).toBe('w1')
    const without = run([start, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/done' }])
    expect(without.phase).toBe('teaching')
    expect(without.cursor).toEqual({ seg: 'seg:1', beat: 0 })
  })

  test('warmup/answer and warmup/skip: phase becomes teaching (answer stored, not graded)', () => {
    const base = run([start, { type: 'plan/record', record: warmupRec }, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/done' }])
    const answered = reduce(base, { type: 'warmup/answer', optionId: 'b' })
    expect(answered.phase).toBe('teaching')
    expect(answered.warmup).toEqual({ record: warmupRec, answer: 'b' })
    const skipped = reduce(base, { type: 'warmup/skip' })
    expect(skipped.phase).toBe('teaching')
    expect(skipped.warmup?.skipped).toBe(true)
  })

  describe('player/advance', () => {
    test('moves to the next beat', () => {
      const s = run(advance(1), teaching())
      expect(s.cursor).toEqual({ seg: 'seg:1', beat: 1 })
      expect(s.phase).toBe('teaching')
    })

    test('end of a complete main segment with a check → checkpoint', () => {
      const s = atCheckpoint()
      expect(s.phase).toBe('checkpoint')
      expect(s.currentCheck).toBe('c1')
      expect(s.cursor).toEqual({ seg: 'seg:1', beat: 2 })
      expect(s.checks.c1).toEqual({ id: 'c1', attempts: 0, branches: [], unsure: 0 })
      expect(activeCheck(s)?.id).toBe('c1')
    })

    test('end of a reteach → checkpoint on returnTo.checkpoint', () => {
      let s = run([wrong(), ...fill('reteach:c1:1', 2)], atCheckpoint())
      expect(s.phase).toBe('teaching')
      s = run(advance(2), s)
      expect(s.phase).toBe('checkpoint')
      expect(s.currentCheck).toBe('c1')
      expect(s.cursor).toEqual({ seg: 'reteach:c1:1', beat: 2 })
    })

    test('end of a solution → next main segment, or recap after the last', () => {
      let s = run([wrong(), ...fill('reteach:c1:1', 1), ...advance(1), wrong(), ...fill('solution:c1', 2), ...advance(2)], atCheckpoint())
      expect(s.phase).toBe('teaching')
      expect(s.cursor).toEqual({ seg: 'seg:2', beat: 0 })
      s = run([wrong(), ...fill('reteach:c1:1', 1), ...advance(1), wrong(), ...fill('solution:c1', 1), ...advance(1)], atCheckpoint(1))
      expect(s.phase).toBe('recap')
      expect(s.recap?.status).toBe('pending')
    })

    test('end of a lost segment → cursor = returnTo, or checkpoint', () => {
      let s = run([...advance(1), { type: 'lost/request' }, ...fill('lost:1:1', 2), ...advance(2)], teaching())
      expect(s.phase).toBe('teaching')
      expect(s.cursor).toEqual({ seg: 'seg:1', beat: 1 })
      s = run([{ type: 'lost/request' }, ...fill('lost:1:1', 1), ...advance(1)], atCheckpoint())
      expect(s.phase).toBe('checkpoint')
      expect(s.currentCheck).toBe('c1')
    })

    test('segment not complete: the cursor waits at the end (no-op) until it completes', () => {
      let s = run([start, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/done' }, { type: 'seg/stream', key: 'seg:1' }, { type: 'seg/beat', key: 'seg:1', beat: beat('seg:1', 0) }])
      s = run(advance(1), s)
      expect(s.cursor).toEqual({ seg: 'seg:1', beat: 1 })
      const waited = run(advance(3), s)
      expect(waited).toBe(s)
      s = run([{ type: 'seg/check', key: 'seg:1', check: check('c1') }, { type: 'seg/done', key: 'seg:1', summary }, ...advance(1)], s)
      expect(s.phase).toBe('checkpoint')
    })
  })

  test('main segment check reached → seg:n+1 becomes pending (pre-generation), only if planned', () => {
    const s = atCheckpoint(2)
    expect(s.segments['seg:2']).toMatchObject({ status: 'pending', kind: 'main', n: 2, template: 'notes' })
    expect(s.order).toEqual(['seg:1', 'seg:2'])
    const last = atCheckpoint(1)
    expect(last.segments['seg:2']).toBeUndefined()
  })

  test('check/answer correct: records first-try and moves to the next main; after the last → recap pending', () => {
    const s = run([right()], atCheckpoint(2))
    expect(s.checks.c1).toMatchObject({ attempts: 1, outcome: 'first-try', branches: ['a'] })
    expect(s.phase).toBe('teaching')
    expect(s.cursor).toEqual({ seg: 'seg:2', beat: 0 })
    expect(s.currentCheck).toBeUndefined()
    const end = run([right()], atCheckpoint(1))
    expect(end.phase).toBe('recap')
    expect(end.recap).toEqual({ ideas: [], practice: [], status: 'pending' })
    expect(needs(end)).toEqual([{ kind: 'recap' }])
  })

  test('check/answer wrong, first time: inserts reteach:<id>:1 after the current position and moves there', () => {
    const s = run([wrong('c1', 'thinks B')], atCheckpoint(2))
    expect(s.phase).toBe('teaching')
    expect(s.order).toEqual(['seg:1', 'reteach:c1:1', 'seg:2'])
    expect(s.segments['reteach:c1:1']).toMatchObject({ kind: 'reteach', n: 1, status: 'pending', template: 'split', returnTo: { checkpoint: 'c1' } })
    expect(s.cursor).toEqual({ seg: 'reteach:c1:1', beat: 0 })
    expect(s.checks.c1).toMatchObject({ attempts: 1, branches: ['b'] })
    expect(s.checks.c1?.outcome).toBeUndefined()
    expect(needs(s)).toEqual([{ kind: 'segment', key: 'reteach:c1:1' }, { kind: 'segment', key: 'seg:2' }])
    expect(s.learner.misconceptions).toEqual([{ text: 'thinks B', resolved: false, checkId: 'c1' }])
  })

  test('correct after a reteach: outcome after-reteach and the misconception is resolved', () => {
    const s = run([wrong('c1', 'thinks B'), ...fill('reteach:c1:1', 1), ...advance(1), right()], atCheckpoint(2))
    expect(s.checks.c1).toMatchObject({ attempts: 2, outcome: 'after-reteach' })
    expect(s.learner.misconceptions).toEqual([{ text: 'thinks B', resolved: true, checkId: 'c1' }])
    expect(s.cursor).toEqual({ seg: 'seg:2', beat: 0 })
  })

  test('check/answer wrong, second time: inserts solution:<id>, outcome solution, then moves on', () => {
    const s = run([wrong(), ...fill('reteach:c1:1', 1), ...advance(1), wrong()], atCheckpoint(2))
    expect(s.checks.c1).toMatchObject({ attempts: 2, outcome: 'solution', branches: ['b', 'b'] })
    expect(s.order).toEqual(['seg:1', 'reteach:c1:1', 'solution:c1', 'seg:2'])
    expect(s.segments['solution:c1']).toMatchObject({ kind: 'solution', n: 1, status: 'pending', template: 'split' })
    expect(s.cursor).toEqual({ seg: 'solution:c1', beat: 0 })
    expect(s.phase).toBe('teaching')
  })

  test('check/skip: outcome skipped, moves on', () => {
    const s = run([{ type: 'check/skip', checkId: 'c1' }], atCheckpoint(2))
    expect(s.checks.c1?.outcome).toBe('skipped')
    expect(s.cursor).toEqual({ seg: 'seg:2', beat: 0 })
    expect(s.phase).toBe('teaching')
  })

  test('check/unsure: unsure + 1, phase unchanged', () => {
    const s = run([{ type: 'check/unsure', checkId: 'c1' }, { type: 'check/unsure', checkId: 'c1' }], atCheckpoint())
    expect(s.checks.c1?.unsure).toBe(2)
    expect(s.learner.unsure).toBe(2)
    expect(s.phase).toBe('checkpoint')
  })

  test('lost/request: inserts lost:<n>:<k> with returnTo = cursor (or checkpoint) and moves there', () => {
    const t = run([...advance(1), { type: 'lost/request' }], teaching())
    expect(t.segments['lost:1:1']).toMatchObject({ kind: 'lost', n: 1, status: 'pending', template: 'split', returnTo: { seg: 'seg:1', beat: 1 } })
    expect(t.cursor).toEqual({ seg: 'lost:1:1', beat: 0 })
    expect(t.order).toEqual(['seg:1', 'lost:1:1'])
    expect(t.learner.lostCount).toEqual({ 1: 1 })
    const c = run([{ type: 'lost/request' }], atCheckpoint())
    expect(c.segments['lost:1:1']?.returnTo).toEqual({ checkpoint: 'c1' })
    expect(c.phase).toBe('teaching')
    expect(c.order).toEqual(['seg:1', 'lost:1:1', 'seg:2'])
  })

  test('interrupt/open: sets the overlay; playback unchanged', () => {
    const s = run([{ type: 'interrupt/open' }], teaching())
    expect(s.overlay).toEqual({ kind: 'interrupt' })
    expect(s.playback).toEqual({ track: 'lesson' })
    expect(s.cursor).toEqual(teaching().cursor)
  })

  test('interrupt/ask: creates a pending thread and moves playback to the answer track', () => {
    const s = run([...advance(1), { type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't1', question: 'why?', targets: ['wseg1#0'], askId: 'q1' }], teaching())
    expect(s.threads).toEqual([{ id: 't1', question: 'why?', targets: ['wseg1#0'], askId: 'q1', status: 'pending', beats: [] }])
    expect(s.playback).toEqual({ track: 'answer', threadId: 't1', beat: 0 })
    expect(s.overlay).toEqual({ kind: 'interrupt', threadId: 't1' })
    expect(needs(s)).toContainEqual({ kind: 'thread', id: 't1' })
    expect(s.learner.questions).toEqual(['why?'])
    // answer-track advance moves the answer beat only
    const a = run([{ type: 'thread/beat', threadId: 't1', beat: { ...beat('ans', 0), ink: 'answer' } }, ...advance(1)], s)
    expect(a.threads[0]?.status).toBe('streaming')
    expect(a.playback).toEqual({ track: 'answer', threadId: 't1', beat: 1 })
    expect(a.cursor).toEqual({ seg: 'seg:1', beat: 1 })
  })

  test('interrupt/close: restores the lesson track; cursor.beat unchanged so the beat replays', () => {
    const base = run([...advance(1), { type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't1', question: 'why?', targets: [] }, { type: 'thread/beat', threadId: 't1', beat: beat('ans', 0) }, { type: 'thread/done', threadId: 't1' }, ...advance(1)], teaching())
    const s = reduce(base, { type: 'interrupt/close', outcome: 'clear' })
    expect(s.playback).toEqual({ track: 'lesson' })
    expect(s.overlay).toBeNull()
    expect(s.cursor).toEqual({ seg: 'seg:1', beat: 1 })
    expect(s.threads[0]?.outcome).toBe('clear')
    const nq = reduce(base, { type: 'interrupt/close', outcome: 'not-quite' })
    expect(nq.overlay).toEqual({ kind: 'interrupt', threadId: 't1' })
    expect(nq.threads[0]?.outcome).toBe('not-quite')
    const cancel = run([{ type: 'interrupt/open' }, { type: 'interrupt/close', outcome: 'cancel' }], teaching())
    expect(cancel.overlay).toBeNull()
    expect(cancel.threads).toEqual([])
  })
})

describe('selectors, replay, purity', () => {
  test('needs(): after plan segment 1 → [{segment seg:1}]; at checkpoint of seg:1 → includes seg:2', () => {
    const s = run([start, { type: 'plan/record', record: segPlan(1) }])
    expect(needs(s)).toEqual([{ kind: 'segment', key: 'seg:1' }])
    expect(needs(run([{ type: 'seg/stream', key: 'seg:1' }], s))).toEqual([])
    expect(needs(atCheckpoint(2))).toContainEqual({ kind: 'segment', key: 'seg:2' })
  })

  test('replay(log) deep-equals the incrementally reduced state', () => {
    const log: LessonEvent[] = [
      start, { type: 'plan/record', record: warmupRec }, { type: 'plan/record', record: segPlan(1, 'graph') }, { type: 'plan/record', record: segPlan(2) },
      { type: 'plan/done' }, { type: 'warmup/answer', optionId: 'a' }, ...fill('seg:1', 3, 'c1'), ...advance(1),
      { type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't1', question: 'q', targets: [] }, { type: 'thread/done', threadId: 't1' },
      { type: 'interrupt/close', outcome: 'clear' }, ...advance(2), wrong('c1', 'm1'), ...fill('reteach:c1:1', 1), ...advance(1),
      right(), { type: 'lost/request' }, { type: 'element/strike', id: 'x' },
      { type: 'error', error: { kind: 'offline', message: 'no net' }, retry: { kind: 'segment', key: 'seg:2' } }, { type: 'error/clear' },
    ]
    const store = createLessonStore()
    for (const e of log) store.getState().dispatch(e)
    const incremental = store.getState().state
    expect(replay(log)).toEqual(incremental)
    expect(store.getState().log).toEqual(log)
    // JSON-serialisable
    expect(JSON.parse(JSON.stringify(incremental))).toEqual(incremental)
    const other = createLessonStore()
    other.getState().load(log)
    expect(other.getState().state).toEqual(incremental)
    other.getState().reset()
    expect(other.getState()).toMatchObject({ state: null, log: [] })
  })

  test('reducer never mutates its input (Object.freeze deep on input)', () => {
    let s: LessonState | null = null
    const log: LessonEvent[] = [
      start, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/record', record: segPlan(2) }, { type: 'plan/done' },
      ...fill('seg:1', 2, 'c1'), { type: 'seg/ask', key: 'seg:1', ask: { t: 'ask', id: 'q1', text: 'why?' } },
      { type: 'beat/patch', actionId: 'wseg10', action: chk({ t: 'write', id: 'wseg10', text: 'fixed' }) },
      ...advance(1), { type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't', question: 'q', targets: [] },
      { type: 'thread/beat', threadId: 't', beat: beat('ans', 0) }, ...advance(1), { type: 'interrupt/close', outcome: 'clear' },
      ...advance(1), { type: 'check/unsure', checkId: 'c1' }, wrong('c1', 'm'), { type: 'lost/request' }, ...fill('lost:1:1', 1), ...advance(1),
      ...fill('reteach:c1:1', 1), ...advance(1), wrong(), ...fill('solution:c1', 1), ...advance(1),
      { type: 'seg/regenerate', key: 'seg:2' }, { type: 'element/strike', id: 'a' },
    ]
    for (const e of log) s = reduce(deepFreeze(s), deepFreeze(e))
    expect(s?.cursor).toEqual({ seg: 'seg:2', beat: 0 })
  })

  test('a lesson cannot exceed 5 planned segments: 6th segment record ignored', () => {
    const s = run([start, ...[1, 2, 3, 4, 5, 6].map((n): LessonEvent => ({ type: 'plan/record', record: segPlan(n) }))])
    expect(s.plan.map((p) => p.n)).toEqual([1, 2, 3, 4, 5])
  })

  test('pagesInput covers order up to the cursor segment with patches applied; visibleBeatIds', () => {
    let s = run([{ type: 'beat/patch', actionId: 'wseg10', action: chk({ t: 'write', id: 'wseg10', text: 'fixed' }) }], teaching())
    const pages = pagesInput(s)
    expect(pages.map((p) => p.segKey)).toEqual(['seg:1'])
    expect(pages[0]?.template).toBe('split')
    expect(pages[0]?.beats[0]?.actions[0]).toMatchObject({ text: 'fixed' })
    expect(s.segments['seg:1']?.beats[0]?.actions[0]).toMatchObject({ text: 'x' })
    s = run(advance(1), s)
    expect(visibleBeatIds(s)).toEqual(['seg:1#0'])
    expect(visibleBeatIds(s, { includeCurrent: true })).toEqual(['seg:1#0', 'seg:1#1'])
    s = run([right(), ...fill('seg:2', 2)], run(advance(1), s))
    expect(pagesInput(s).map((p) => p.segKey)).toEqual(['seg:1', 'seg:2'])
    expect(visibleBeatIds(s)).toEqual(['seg:1#0', 'seg:1#1'])
    expect(currentSegment(s)?.key).toBe('seg:2')
  })

  test('player/seek replays within the cursor segment; from a checkpoint it returns to the same check', () => {
    let s = reduce(atCheckpoint(), { type: 'player/seek', cursor: { seg: 'seg:1', beat: 0 } })
    expect(s.phase).toBe('teaching')
    expect(s.cursor).toEqual({ seg: 'seg:1', beat: 0 })
    s = run([wrong()], run(advance(2), s))
    expect(s.cursor.seg).toBe('reteach:c1:1')
    expect(reduce(s, { type: 'player/seek', cursor: { seg: 'seg:1', beat: 0 } })).toBe(s)
  })

  test('lost mid-segment: after return the lost beats stay visible and order is chronological', () => {
    let s = run([...advance(1), { type: 'lost/request' }, ...fill('lost:1:1', 2), ...advance(2)], teaching())
    expect(s.cursor).toEqual({ seg: 'seg:1', beat: 1 })
    expect(pagesInput(s).map((p) => p.segKey)).toEqual(['seg:1', 'lost:1:1'])
    expect(visibleBeatIds(s)).toEqual(['seg:1#0', 'lost:1:1#0', 'lost:1:1#1'])
    s = run([{ type: 'lost/request' }, ...fill('lost:1:2', 1), ...advance(1)], s)
    expect(s.cursor).toEqual({ seg: 'seg:1', beat: 1 })
    expect(s.order).toEqual(['seg:1', 'lost:1:1', 'lost:1:2'])
    s = run([...advance(1), wrong()], s)
    expect(s.order).toEqual(['seg:1', 'lost:1:1', 'lost:1:2', 'reteach:c1:1', 'seg:2'])
    expect(s.visited).toEqual(['seg:1', 'lost:1:1', 'lost:1:2', 'reteach:c1:1'])
    expect(pagesInput(s).map((p) => p.segKey)).toEqual(['seg:1', 'lost:1:1', 'lost:1:2', 'reteach:c1:1'])
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  test('retry from failed: seg/stream, thread/stream and recap/stream reset partial content without duplicates', () => {
    const base = run([start, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/done' }, { type: 'seg/stream', key: 'seg:1' },
      { type: 'seg/beat', key: 'seg:1', beat: beat('seg:1', 0) }, { type: 'seg/ask', key: 'seg:1', ask: { t: 'ask', id: 'q1', text: 'q' } },
      ...advance(1), { type: 'seg/failed', key: 'seg:1', error: { kind: 'offline', message: 'x' } }])
    let s = run([{ type: 'seg/stream', key: 'seg:1' }], base)
    expect(s.segments['seg:1']).toMatchObject({ status: 'streaming', beats: [], asks: [], regenerated: false })
    expect(s.cursor).toEqual({ seg: 'seg:1', beat: 0 })
    s = run([{ type: 'seg/beat', key: 'seg:1', beat: beat('seg:1', 0) }], s)
    expect(s.segments['seg:1']?.beats.map((b) => b.id)).toEqual(['seg:1#0'])

    let t = run([{ type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't1', question: 'q', targets: [] },
      { type: 'thread/beat', threadId: 't1', beat: beat('ans', 0) }, ...advance(1), { type: 'thread/failed', threadId: 't1', error: { kind: 'offline', message: 'x' } },
      { type: 'thread/stream', threadId: 't1' }], teaching())
    expect(t.threads[0]).toMatchObject({ status: 'streaming', beats: [] })
    expect(t.playback).toEqual({ track: 'answer', threadId: 't1', beat: 0 })
    t = run([{ type: 'thread/beat', threadId: 't1', beat: beat('ans', 0) }], t)
    expect(t.threads[0]?.beats).toHaveLength(1)

    let r = run([right(), { type: 'recap/record', record: { t: 'idea', id: 'i1', text: 'idea', seg: 1 } }, { type: 'recap/record', record: check('p1') },
      { type: 'recap/failed', error: { kind: 'offline', message: 'x' } }, { type: 'recap/stream' }], atCheckpoint(1))
    expect(r.recap).toEqual({ ideas: [], practice: [], status: 'streaming' })
    r = run([{ type: 'recap/record', record: { t: 'idea', id: 'i1', text: 'idea', seg: 1 } }], r)
    expect(r.recap?.ideas).toHaveLength(1)
  })

  test('seg/regenerate at the checkpoint: back to teaching, refill reaches the new checkpoint', () => {
    let s = reduce(atCheckpoint(), { type: 'seg/regenerate', key: 'seg:1' })
    expect(s.phase).toBe('teaching')
    expect(s.currentCheck).toBeUndefined()
    expect(s.cursor).toEqual({ seg: 'seg:1', beat: 0 })
    s = run([...fill('seg:1', 1, 'c9'), ...advance(1)], s)
    expect(s.phase).toBe('checkpoint')
    expect(s.currentCheck).toBe('c9')
  })

  test('stalledAtEnd: true only while parked at the end of a segment that has completed', () => {
    let s = run([start, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/done' }, { type: 'seg/stream', key: 'seg:1' },
      { type: 'seg/beat', key: 'seg:1', beat: beat('seg:1', 0) }, { type: 'seg/check', key: 'seg:1', check: check('c1') }, ...advance(1)])
    expect(stalledAtEnd(s)).toBe(false)
    s = reduce(s, { type: 'seg/done', key: 'seg:1', summary })
    expect(stalledAtEnd(s)).toBe(true)
    expect(stalledAtEnd(run([{ type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't', question: 'q', targets: [] }], s))).toBe(false)
    s = run(advance(1), s)
    expect(s.phase).toBe('checkpoint')
    expect(stalledAtEnd(s)).toBe(false)
  })

  test('practice/start is ignored until the recap is complete', () => {
    let s = run([right(), { type: 'recap/record', record: check('p1') }, { type: 'practice/start' }], atCheckpoint(1))
    expect(s.phase).toBe('recap')
    s = run([{ type: 'recap/record', record: check('p2') }, { type: 'recap/done' }, { type: 'practice/start' },
      { type: 'practice/answer', checkId: 'p1', grade: { result: 'correct', branch: 'a' } }], s)
    expect(s.phase).toBe('practice')
    expect(run([{ type: 'practice/skip', checkId: 'p2' }], s).phase).toBe('done')
  })

  test('lost/request and player/seek are ignored on the answer track', () => {
    const s = run([...advance(1), { type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't', question: 'q', targets: [] }], teaching())
    expect(reduce(s, { type: 'lost/request' })).toBe(s)
    expect(reduce(s, { type: 'player/seek', cursor: { seg: 'seg:1', beat: 0 } })).toBe(s)
  })

  test('interrupt/close under a problem overlay keeps the problem, restores playback, records the outcome', () => {
    let s = run([{ type: 'interrupt/open' }, { type: 'interrupt/ask', threadId: 't1', question: 'q', targets: [] },
      { type: 'error', error: { kind: 'offline', message: 'x' }, retry: { kind: 'thread', id: 't1' } }], teaching())
    expect(s.overlay).toMatchObject({ kind: 'problem', prev: { kind: 'interrupt', threadId: 't1' } })
    s = reduce(s, { type: 'interrupt/close', outcome: 'clear' })
    expect(s.overlay).toEqual({ kind: 'problem', error: { kind: 'offline', message: 'x' }, retry: { kind: 'thread', id: 't1' } })
    expect(s.playback).toEqual({ track: 'lesson' })
    expect(s.threads[0]?.outcome).toBe('clear')
    expect(reduce(s, { type: 'error/clear' }).overlay).toBeNull()
  })

  test('late seg/beat, seg/check, seg/done on a complete or failed segment are ignored', () => {
    const s = teaching()
    expect(reduce(s, { type: 'seg/beat', key: 'seg:1', beat: beat('seg:1', 9) })).toBe(s)
    expect(reduce(s, { type: 'seg/check', key: 'seg:1', check: check('zz') })).toBe(s)
    const f = reduce(s, { type: 'seg/failed', key: 'seg:1', error: { kind: 'aborted', message: 'x' } })
    expect(reduce(f, { type: 'seg/done', key: 'seg:1', summary })).toBe(f)
    expect(reduce(f, { type: 'seg/beat', key: 'seg:1', beat: beat('seg:1', 9) })).toBe(f)
  })

  test('seg/regenerate resets a segment to pending, regenerated, cleared', () => {
    const s = run([{ type: 'seg/regenerate', key: 'seg:1' }], teaching())
    expect(s.segments['seg:1']).toMatchObject({ status: 'pending', regenerated: true, beats: [], asks: [] })
    expect(s.segments['seg:1']?.check).toBeUndefined()
    expect(needs(s)).toEqual([{ kind: 'segment', key: 'seg:1' }])
  })

  test('recap, practice and done', () => {
    let s = run([right(), { type: 'recap/stream' }], atCheckpoint(1))
    expect(needs(s)).toEqual([])
    s = run([
      { type: 'recap/record', record: { t: 'idea', id: 'i1', text: 'idea', seg: 1 } },
      { type: 'recap/record', record: { t: 'say', text: 'Well done' } },
      { type: 'recap/record', record: check('p1') },
      { type: 'recap/record', record: check('p2') },
      { type: 'recap/done' },
    ], s)
    expect(s.recap).toMatchObject({ status: 'complete', say: 'Well done', ideas: [{ id: 'i1' }] })
    expect(s.recap?.practice.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.phase).toBe('recap')
    s = run([{ type: 'practice/start' }, { type: 'practice/answer', checkId: 'p1', grade: { result: 'wrong', branch: 'b' } }], s)
    expect(s.phase).toBe('practice')
    s = reduce(s, { type: 'practice/skip', checkId: 'p2' })
    expect(s.practice).toEqual({ p1: { result: 'wrong' }, p2: { result: 'skipped' } })
    expect(s.phase).toBe('done')
  })

  test('errors set and clear the problem overlay; lesson/done ends', () => {
    let s = reduce(teaching(), { type: 'error', error: { kind: 'rate-limit', message: 'slow down' }, retry: { kind: 'plan' } })
    expect(s.overlay).toEqual({ kind: 'problem', error: { kind: 'rate-limit', message: 'slow down' }, retry: { kind: 'plan' } })
    s = reduce(s, { type: 'error/clear' })
    expect(s.overlay).toBeNull()
    expect(reduce(s, { type: 'lesson/done' }).phase).toBe('done')
  })

  test('reduce(null, non-start) throws; replay([]) throws', () => {
    expect(() => reduce(null, { type: 'plan/done' })).toThrow()
    expect(() => replay([])).toThrow()
  })
})

describe('lesson/resumed', () => {
  test('streaming segments go pending (content dropped), threads fail, recap pending, overlay cleared, cursor kept', () => {
    let s = run([
      start, { type: 'plan/record', record: segPlan(1) }, { type: 'plan/record', record: segPlan(2) }, { type: 'plan/done' },
      ...fill('seg:1', 2, 'c1'), ...advance(2), { type: 'check/skip', checkId: 'c1' },
      { type: 'seg/stream', key: 'seg:2' }, { type: 'seg/beat', key: 'seg:2', beat: beat('seg:2', 0) },
      { type: 'interrupt/ask', threadId: 't1', question: 'q', targets: [] }, { type: 'thread/stream', threadId: 't1' },
    ])
    const cursor = s.cursor
    s = run([{ type: 'lesson/resumed' }], s)
    expect(s.segments['seg:1']?.status).toBe('complete')
    expect(s.segments['seg:2']).toMatchObject({ status: 'pending', beats: [] })
    expect(s.threads[0]?.status).toBe('failed')
    expect(s.overlay).toBeNull()
    expect(s.playback).toEqual({ track: 'lesson' })
    expect(s.cursor).toEqual(cursor)
    expect(needs(s)).toEqual([{ kind: 'segment', key: 'seg:2' }])
  })

  test('a streaming recap goes pending', () => {
    let s = atCheckpoint(1)
    s = run([{ type: 'check/skip', checkId: 'c1' }], s)
    expect(s.phase).toBe('recap')
    s = run([{ type: 'recap/stream' }, { type: 'recap/record', record: { t: 'say', text: 'hi' } as never }, { type: 'lesson/resumed' }], s)
    expect(s.recap).toMatchObject({ status: 'pending', ideas: [], practice: [] })
    expect(s.recap?.say).toBeUndefined()
  })
})
