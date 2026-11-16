import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import { createController } from '../../../src/lesson/controller'
import type { LessonController } from '../../../src/lesson/controller'
import type { LessonEvent } from '../../../src/lesson/events'
import { currentSegment } from '../../../src/lesson/selectors'
import { createLessonStore } from '../../../src/lesson/store'
import type { LessonState, SegKey } from '../../../src/lesson/types'
import { SourceError } from '../../../src/sources/errors'
import { RecordingSchema } from '../../../src/sources/recording'
import { createReplaySource } from '../../../src/sources/replay'
import type { AiSource } from '../../../src/sources/types'
import { FakeSource, jsonl } from '../../fixtures/fake-source'
import type { FakeEntry, FakeOpts } from '../../fixtures/fake-source'

// ------------------------------------------------------------------------------------------ fixtures

const say = (text: string) => ({ t: 'say', text })
const write = (id: string, text = 'note') => ({ t: 'write', id, text })
const goodMath = (id: string) => ({ t: 'math', id, latex: '2(x+1) = 2x+2', expr: '2*(x+1)=2*x+2' })
const badMath = (id: string, expr = '2+2=5') => ({ t: 'math', id, latex: expr, expr })

const choice = (id: string, correct: string[] = ['a']) => ({
  t: 'check', id, kind: 'choice', prompt: 'Which one?', explain: 'Because.', hint: 'Think.',
  options: ['a', 'b', 'c'].map((o) => ({
    id: o, text: o.toUpperCase(), correct: correct.includes(o), ...(correct.includes(o) ? {} : { misconception: `thinks ${o.toUpperCase()}` }),
  })),
})

const planRecs = (segments = 2, warmup = true) => [
  { t: 'scope', verdict: 'in', reason: 'Algebra.' },
  ...(warmup
    ? [{
        t: 'warmup', id: 'w1', prompt: 'Guess?',
        options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }, { id: 'c', text: 'C', correct: false }],
      }]
    : []),
  { t: 'objective', text: 'Understand the idea.' },
  ...Array.from({ length: segments }, (_, i) => ({
    t: 'segment', n: i + 1, title: `Part ${i + 1}`, goal: 'Learn it.', representation: 'worked', misconception: 'a mix-up', check: 'choice',
  })),
]
const PLAN = jsonl(...planRecs())

/** A good main segment: 3 beats, a verified math line, a write, then check c<n>. */
const SEG = (n: number, extra: object[] = []) =>
  jsonl(say(`Segment ${n} begins.`), goodMath(`s${n}m`), say('Next idea.'), write(`s${n}w`), ...extra, say('Ready?'), choice(`c${n}`))
const NOCHECK = (n: number) => jsonl(say(`Segment ${n} begins.`), goodMath(`s${n}m`), say('No check here.'), write(`s${n}w`))
const SHORT = (prefix: string) => jsonl(say('Look at it another way.'), write(`${prefix}w`), say('Try again now.'))

// ------------------------------------------------------------------------------------------- harness

const live: LessonController[] = []
afterEach(() => {
  for (const c of live.splice(0)) c.dispose()
})

const tick = (ms = 1) => new Promise<void>((r) => setTimeout(r, ms))

async function waitFor(pred: () => boolean, what = 'condition', ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await tick()
  }
}

function setup(map: Record<string, FakeEntry>, opts: FakeOpts = {}, source?: AiSource) {
  const store = createLessonStore()
  const fake = FakeSource(map, opts)
  const ctl = createController({ store, source: source ?? fake, now: () => Date.parse('2026-11-17T10:00:00Z') })
  live.push(ctl)
  const S = (): LessonState => {
    const s = store.getState().state
    if (!s) throw new Error('no lesson')
    return s
  }
  const dispatch = (e: LessonEvent) => store.getState().dispatch(e)
  const segDone = (key: SegKey) => waitFor(() => store.getState().state?.segments[key]?.status === 'complete', `${key} complete`)
  /** Plays the lesson track (advancing as beats arrive) until `pred` holds. */
  const playUntil = async (pred: (s: LessonState) => boolean, what = 'playback') => {
    const t0 = Date.now()
    while (!pred(S())) {
      if (Date.now() - t0 > 3000) throw new Error(`timed out playing until ${what} (cursor ${S().cursor.seg}#${S().cursor.beat}, phase ${S().phase})`)
      const s = S()
      const g = currentSegment(s)
      if (g && g.status !== 'complete' && s.cursor.beat >= g.beats.length - 1) await tick()
      else dispatch({ type: 'player/advance' })
    }
  }
  const idle = () => waitFor(() => fake.active === 0, 'no generate calls running')
  return { store, fake, ctl, S, dispatch, segDone, playUntil, idle }
}

const count = (xs: string[], x: string) => xs.filter((y) => y === x).length
const ids = (s: LessonState, key: SegKey) => (s.segments[key]?.beats ?? []).flatMap((b) => b.actions.map((a) => ('id' in a ? a.id : a.t)))
const wrong = (checkId: string, branch: string, misconception?: string): LessonEvent => ({
  type: 'check/answer', checkId, grade: { result: 'wrong', branch, ...(misconception ? { misconception } : {}) },
})
const right = (checkId: string): LessonEvent => ({ type: 'check/answer', checkId, grade: { result: 'correct', branch: 'a' } })

// -------------------------------------------------------------------------------------------- tests

describe('lesson controller: flow', () => {
  test('start → plan records → warmup phase; seg:1 generated before the warm-up is answered', async () => {
    const { store, fake, ctl, S, segDone } = setup({ plan: PLAN, 'segment:1': SEG(1) }, { chunk: 40 })
    let phaseWhenWarmupShown: string | undefined
    store.subscribe((st) => {
      if (st.state?.warmup && phaseWhenWarmupShown === undefined) phaseWhenWarmupShown = st.state.phase
    })
    await ctl.start({ topic: 'the vertex of a parabola' })
    expect(phaseWhenWarmupShown).toBe('planning') // shown as soon as its record arrived, before plan/done
    expect(S().badge).toEqual(fake.badge())
    expect(S().topic).toBe('the vertex of a parabola')
    expect(S().phase).toBe('warmup')
    await segDone('seg:1')
    expect(S().phase).toBe('warmup')
    expect(S().warmup?.answer).toBeUndefined()
    expect(fake.intents()).toEqual(['plan', 'segment:1'])
    expect(fake.requests[1]).toMatchObject({ role: 'segment', maxOutputTokens: 1800 })
    expect(fake.requests[1]?.user).toContain('start every id you create with "s1"')
    expect(S().segments['seg:1']?.check?.id).toBe('c1')
    expect(S().segments['seg:1']?.beats).toHaveLength(3)
  })

  test('reaching seg:1 checkpoint triggers generation of segment:2 (pre-generation)', async () => {
    const { fake, ctl, S, dispatch, segDone, playUntil } = setup({ plan: PLAN, 'segment:1': SEG(1), 'segment:2': SEG(2) })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    dispatch({ type: 'warmup/skip' })
    await playUntil((s) => s.cursor.beat === 2, 'last beat of seg:1')
    await tick(5)
    expect(fake.intents()).not.toContain('segment:2')
    await playUntil((s) => s.phase === 'checkpoint', 'checkpoint')
    await segDone('seg:2')
    expect(S().phase).toBe('checkpoint') // generated while the learner is still at the checkpoint
    expect(fake.intents()).toEqual(['plan', 'segment:1', 'segment:2'])
  })

  test('first wrong answer generates reteach:<check>:<branch> and returns to the checkpoint after it plays', async () => {
    const { fake, ctl, S, dispatch, segDone, playUntil } = setup({
      plan: PLAN, 'segment:1': SEG(1), 'segment:2': SEG(2), 'reteach:c1:b': SHORT('r1'),
    })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    dispatch({ type: 'warmup/skip' })
    await playUntil((s) => s.phase === 'checkpoint', 'checkpoint')
    dispatch(wrong('c1', 'b', 'thinks B is right'))
    expect(S().cursor.seg).toBe('reteach:c1:1')
    await segDone('reteach:c1:1')
    const req = fake.requests.find((r) => r.intent === 'reteach:c1:b')
    expect(req?.role).toBe('reteach')
    expect(req?.user).toContain('Misconception to fix: thinks B is right')
    expect(req?.user).toContain('start every id you create with "r1"')
    await playUntil((s) => s.phase === 'checkpoint', 'back at the checkpoint')
    expect(S().currentCheck).toBe('c1')
  })

  test('second wrong answer generates solution:<check>, then moves to seg:2', async () => {
    const { fake, ctl, S, dispatch, segDone, playUntil } = setup({
      plan: PLAN, 'segment:1': SEG(1), 'segment:2': SEG(2), 'reteach:c1:b': SHORT('r1'), 'solution:c1': SHORT('sol1'),
    })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    dispatch({ type: 'warmup/skip' })
    await playUntil((s) => s.phase === 'checkpoint')
    dispatch(wrong('c1', 'b'))
    await playUntil((s) => s.phase === 'checkpoint' && s.cursor.seg === 'reteach:c1:1')
    dispatch(wrong('c1', 'c'))
    expect(S().cursor.seg).toBe('solution:c1')
    await segDone('solution:c1')
    expect(fake.intents()).toContain('solution:c1')
    await playUntil((s) => s.cursor.seg === 'seg:2', 'seg:2')
    expect(S().phase).toBe('teaching')
    expect(count(fake.intents(), 'segment:2')).toBe(1)
  })

  test('a declined plan dispatches its records and plan/done, and generates no segments', async () => {
    const plan = jsonl({ t: 'scope', verdict: 'declined', reason: 'Not maths.', suggest: ['fractions'] }, planRecs(1, false)[2] as object)
    const { fake, ctl, S, store } = setup({ plan })
    await ctl.start({ topic: 'how to pick a lock' })
    await tick(10)
    expect(S().scope?.verdict).toBe('declined')
    expect(store.getState().log.map((e) => e.type)).toContain('plan/done')
    expect(fake.intents()).toEqual(['plan'])
  })
})

describe('lesson controller: regenerate, repair, replay', () => {
  test('segment with no check is regenerated once; second bad output → error bad-output with retry', async () => {
    const { fake, ctl, S, segDone } = setup({ plan: PLAN, 'segment:1': NOCHECK(1) })
    await ctl.start({ topic: 't' })
    await waitFor(() => S().segments['seg:1']?.status === 'failed', 'seg:1 failed')
    expect(count(fake.intents(), 'segment:1')).toBe(2)
    expect(S().segments['seg:1']?.regenerated).toBe(true)
    expect(S().overlay).toMatchObject({ kind: 'problem', error: { kind: 'bad-output' }, retry: { kind: 'segment', key: 'seg:1' } })
    // Retry re-issues the segment.
    fake.map['segment:1'] = SEG(1)
    ctl.retry()
    await segDone('seg:1')
    expect(count(fake.intents(), 'segment:1')).toBe(3)
    expect(S().overlay).toBeNull()
  })

  test('truncated segment (done stop "length") counts as a failure', async () => {
    const { fake, ctl, S, segDone, store } = setup({
      plan: PLAN, 'segment:1': (_r, call) => (call === 0 ? { text: SEG(1), stop: 'length' } : SEG(1)),
    })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    expect(count(fake.intents(), 'segment:1')).toBe(2)
    expect(store.getState().log.some((e) => e.type === 'seg/regenerate' && e.key === 'seg:1')).toBe(true)
    // The regenerated stream reuses the same ids: they were removed from the index, so nothing is a duplicate.
    expect(ids(S(), 'seg:1')).toEqual(['s1m', 's1w'])
    expect(S().segments['seg:1']?.check?.id).toBe('c1')
    const done = store.getState().log.filter((e) => e.type === 'seg/done')
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ summary: { rejected: 0, truncated: false } })
  })

  test('failed step gets one repair; good repair patches it; bad repair leaves it flagged', async () => {
    const { fake, ctl, S, segDone, idle } = setup({
      plan: PLAN,
      'segment:1': SEG(1, [badMath('s1bad'), badMath('s1bad2', '3+3=7')]),
      'repair:s1bad': jsonl({ t: 'math', id: 's1bad', latex: '2+2=4', expr: '2+2=4' }),
      'repair:s1bad2': jsonl({ t: 'math', id: 's1bad2', latex: '3+3=8', expr: '3+3=8' }),
    })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    await waitFor(() => count(fake.intents(), 'repair:s1bad2') === 1)
    await idle()
    await tick(5)
    expect(count(fake.intents(), 'repair:s1bad')).toBe(1)
    expect(count(fake.intents(), 'repair:s1bad2')).toBe(1)
    const req = fake.requests.find((r) => r.intent === 'repair:s1bad')
    expect(req?.role).toBe('repair')
    expect(req?.user).toContain('"expr":"2+2=5"')
    expect(S().patches['s1bad']).toMatchObject({ t: 'math', id: 's1bad', expr: '2+2=4', verify: { status: 'pass' } })
    expect(S().patches['s1bad2']).toBeUndefined()
    const flagged = S().segments['seg:1']?.beats.flatMap((b) => b.actions).find((a) => 'id' in a && a.id === 's1bad2')
    expect(flagged?.verify.status).toBe('fail')
  })

  test('check with two correct options → repaired once → else replaced by SELF_RATING', async () => {
    const twoRight = jsonl(say('Segment 1.'), goodMath('s1m'), say('Ready?'), choice('c1', ['a', 'b']))
    // Repair fails (still two correct) → self-rating.
    const a = setup({ plan: PLAN, 'segment:1': twoRight, 'repair:c1': jsonl(choice('c1', ['a', 'b'])) })
    await a.ctl.start({ topic: 't' })
    await a.segDone('seg:1')
    expect(count(a.fake.intents(), 'repair:c1')).toBe(1)
    expect(a.S().segments['seg:1']?.check).toMatchObject({ id: 'c1-rate', kind: 'choice', prompt: 'Did that make sense?' })
    // Repair succeeds → the repaired check is used.
    const b = setup({ plan: PLAN, 'segment:1': twoRight, 'repair:c1': jsonl(choice('c1', ['b'])) })
    await b.ctl.start({ topic: 't' })
    await b.segDone('seg:1')
    expect(count(b.fake.intents(), 'repair:c1')).toBe(1)
    const c = b.S().segments['seg:1']?.check
    expect(c).toMatchObject({ id: 'c1', verify: { status: 'pass' } })
    expect(c?.kind === 'choice' && c.options.filter((o) => o.correct).map((o) => o.id)).toEqual(['b'])
    // The check is dispatched only after the repair resolved, then seg/done.
    const types = b.store.getState().log.map((e) => e.type)
    expect(types.lastIndexOf('seg/check')).toBe(types.indexOf('seg/done') - 1)
  })

  test('replay source: no repair or regenerate calls made', async () => {
    const seg = jsonl(say('One.'), badMath('s1bad'), say('Two.'), write('s1w'))
    const { fake, ctl, S, segDone, store } = setup({ plan: PLAN, 'segment:1': seg }, { id: 'replay' })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    await tick(10)
    expect(fake.intents()).toEqual(['plan', 'segment:1'])
    expect(S().segments['seg:1']?.regenerated).toBe(false)
    expect(store.getState().log.some((e) => e.type === 'seg/regenerate' || e.type === 'beat/patch')).toBe(false)
  })

  test('regenerate aborts the old stream and its late events are ignored', async () => {
    const OLD = jsonl(say('Old one.'), write('old1'), say('Old two.'), write('old2'), say('Old three.'), write('old3'), say('Old?'), choice('c1'))
    const { fake, ctl, S, dispatch, segDone, store, idle } = setup(
      { plan: PLAN, 'segment:1': (_r, call) => (call === 0 ? OLD : SEG(1)) },
      { delayMs: 3, chunk: 30, ignoreAbort: true },
    )
    await ctl.start({ topic: 't' })
    await waitFor(() => (S().segments['seg:1']?.beats.length ?? 0) >= 1, 'first old beat')
    const at = store.getState().log.length
    dispatch({ type: 'seg/regenerate', key: 'seg:1' })
    const first = fake.requests.find((r) => r.intent === 'segment:1')
    await waitFor(() => first?.signal.aborted === true, 'old stream aborted')
    await segDone('seg:1')
    await idle() // the old (abort-ignoring) stream has run to its end too
    await tick(10)
    expect(count(fake.intents(), 'segment:1')).toBe(2)
    expect(ids(S(), 'seg:1')).toEqual(['s1m', 's1w'])
    const late = store.getState().log.slice(at).filter((e) => JSON.stringify(e).includes('old'))
    expect(late).toEqual([])
    expect(store.getState().log.filter((e) => e.type === 'seg/done')).toHaveLength(1)
  })

  test('index rebuilt on a controller created over an existing state', async () => {
    const graph = jsonl(
      say('A curve.'), { t: 'plot', id: 's1p', x: [-3, 3], y: [-1, 9], fns: [{ id: 's1f', expr: 'x^2' }] },
      say('A note.'), write('s1w'), say('Ready?'), choice('c1'),
    )
    const lost = jsonl(
      say('Smaller steps.'), { t: 'point', id: 'l1pt', plot: 's1p', at: [1, 1], on: 's1f' }, write('l1a'),
      say('And again.'), write('l1b'), write('s1w', 'duplicate'),
    )
    const first = setup({ plan: PLAN, 'segment:1': graph })
    await first.ctl.start({ topic: 't' })
    await first.segDone('seg:1')
    first.ctl.dispose()
    // A new controller over the same store (as after a refresh), with its own source.
    const fake = FakeSource({ 'lost:1:1': lost })
    const ctl = createController({ store: first.store, source: fake, now: () => 0 })
    live.push(ctl)
    first.dispatch({ type: 'warmup/skip' })
    first.dispatch({ type: 'lost/request' })
    await first.segDone('lost:1:1')
    expect(fake.requests[0]?.user).toContain('a concrete numeric example') // nextLostStyle(0)
    // The point on the old plot resolves (plot found in the rebuilt index); the reused id s1w is a duplicate.
    expect(ids(first.S(), 'lost:1:1')).toEqual(['l1pt', 'l1a', 'l1b'])
  })
})

describe('lesson controller: errors, answers, review, recap', () => {
  test('invalid-key error surfaces as error event; retry re-issues the same intent', async () => {
    const { fake, ctl, S, segDone, store } = setup({
      plan: PLAN, 'segment:1': (_r, call) => (call === 0 ? new SourceError('invalid-key', 'The key was rejected') : SEG(1)),
    })
    await ctl.start({ topic: 't' })
    await waitFor(() => S().overlay?.kind === 'problem', 'problem overlay')
    expect(S().overlay).toMatchObject({ kind: 'problem', error: { kind: 'invalid-key', message: 'The key was rejected' }, retry: { kind: 'segment', key: 'seg:1' } })
    expect(S().segments['seg:1']?.status).toBe('failed')
    await tick(10)
    expect(count(fake.intents(), 'segment:1')).toBe(1)
    ctl.retry()
    await segDone('seg:1')
    expect(count(fake.intents(), 'segment:1')).toBe(2)
    expect(S().overlay).toBeNull()
    const types = store.getState().log.map((e) => e.type)
    expect(types.indexOf('error/clear')).toBeGreaterThan(types.indexOf('error'))
  })

  test('a failed plan is retried from a fresh lesson/start', async () => {
    const { fake, ctl, S, segDone } = setup({
      plan: (_r, call) => (call === 0 ? new SourceError('offline') : PLAN), 'segment:1': SEG(1),
    })
    await ctl.start({ topic: 't' })
    expect(S().overlay).toMatchObject({ kind: 'problem', error: { kind: 'offline' }, retry: { kind: 'plan' } })
    ctl.retry()
    await segDone('seg:1')
    expect(fake.intents()).toEqual(['plan', 'plan', 'segment:1'])
    expect(S().plan).toHaveLength(2)
  })

  test('cancel aborts what is running and shows "aborted"; retry carries on', async () => {
    const { fake, ctl, S, segDone } = setup({ plan: PLAN, 'segment:1': SEG(1) }, { delayMs: 3, chunk: 20 })
    await ctl.start({ topic: 't' })
    await waitFor(() => S().segments['seg:1']?.status === 'streaming')
    ctl.cancel()
    expect(fake.requests[1]?.signal.aborted).toBe(true)
    expect(S().segments['seg:1']?.status).toBe('failed')
    expect(S().overlay).toMatchObject({ kind: 'problem', error: { kind: 'aborted' }, retry: { kind: 'segment', key: 'seg:1' } })
    ctl.retry()
    await segDone('seg:1')
    expect(ids(S(), 'seg:1')).toEqual(['s1m', 's1w'])
  })

  test('cancel while only background repairs run stops them but keeps the segment complete', async () => {
    const { fake, ctl, S, segDone } = setup(
      { plan: PLAN, 'segment:1': SEG(1, [badMath('s1bad')]), 'repair:s1bad': jsonl(goodMath('s1bad')) },
      { delayMs: 5 },
    )
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    await waitFor(() => fake.intents().includes('repair:s1bad'), 'repair started')
    ctl.cancel()
    expect(fake.requests.at(-1)?.signal.aborted).toBe(true)
    await waitFor(() => fake.active === 0)
    await tick(10)
    expect(S().segments['seg:1']?.status).toBe('complete')
    expect(S().overlay).toBeNull()
    expect(S().patches['s1bad']).toBeUndefined()
  })

  test('ask generates the answer role into thread events; follow-up asks again with followUp', async () => {
    const answer = jsonl(say('Because of symmetry.'), write('a1w', 'mirror'), say('Does that help?'))
    const { fake, ctl, S, segDone } = setup({
      plan: PLAN, 'segment:1': SEG(1), 'answer:free:1': answer, 'answer:free:1:not-quite': jsonl(say('Simpler: 2 + 2 = 4.')),
      'answer:q7': jsonl(say('Good question.')),
    })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    ctl.ask({ question: 'Why halfway?', targets: ['s1m'] })
    const t1 = S().threads[0]
    expect(t1).toMatchObject({ question: 'Why halfway?', targets: ['s1m'] })
    await waitFor(() => S().threads[0]?.status === 'complete', 'answer complete')
    const req = fake.requests.find((r) => r.intent === 'answer:free:1')
    expect(req?.role).toBe('answer')
    expect(S().threads[0]?.beats.map((b) => b.say)).toEqual(['Because of symmetry.', 'Does that help?'])
    expect(S().threads[0]?.beats[0]?.ink).toBe('answer')
    ctl.followUp(t1!.id, 'not-quite')
    expect(S().threads[0]?.outcome).toBe('not-quite')
    expect(S().overlay).toMatchObject({ kind: 'interrupt', threadId: S().threads[1]?.id })
    await waitFor(() => S().threads[1]?.status === 'complete', 'follow-up complete')
    expect(fake.requests.find((r) => r.intent === 'answer:free:1:not-quite')?.user).toContain('did not quite clear it up')
    ctl.ask({ question: 'And this?', targets: [], askId: 'q7' })
    await waitFor(() => S().threads[2]?.status === 'complete', 'ask chip answer')
    expect(fake.intents()).toContain('answer:q7')
  })

  test('report on a passing step in replay mode creates a thread saying "Checked by code"', async () => {
    const seg = jsonl(
      say('Expand it.'), { t: 'math', id: 's1e', latex: '2(x+1)', expr: '2*(x+1)' },
      { t: 'step', id: 's1st', latex: '2x+2', expr: '2*x+2', why: 'expand', from: 's1e' }, write('s1w'), say('Ready?'), choice('c1'),
    )
    const { fake, ctl, S, segDone } = setup({ plan: PLAN, 'segment:1': seg }, { id: 'replay' })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    ctl.report('s1st')
    const t = S().threads.at(-1)
    expect(t?.status).toBe('complete')
    expect(t?.beats).toHaveLength(1)
    expect(t?.beats[0]?.say).toBe('Checked by code: this step checks out')
    expect(t?.beats[0]?.actions[0]).toMatchObject({ t: 'mark', target: 's1st', verify: { status: 'pass' } })
    ctl.report('s1w')
    expect(S().threads.at(-1)?.beats[0]?.say).toBe("I can't recheck this live in a recorded lesson.")
    await tick(10)
    expect(fake.intents().some((i) => i.startsWith('review') || i.startsWith('answer'))).toBe(false)
  })

  test('live report: verdict ok:false strikes the element and shows the say and the fix', async () => {
    const { fake, ctl, S, segDone } = setup({
      plan: PLAN, 'segment:1': SEG(1),
      'review:s1m': jsonl({ t: 'verdict', ok: false, say: 'You are right, that line was wrong.', fix: { t: 'math', id: 's1m', latex: '2(x+1) = 2x+2', expr: '2*(x+1)=2*x+2' } }),
    })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    ctl.report('s1m')
    await waitFor(() => S().threads.at(-1)?.status === 'complete', 'review thread')
    expect(fake.requests.find((r) => r.intent === 'review:s1m')?.role).toBe('review')
    expect(S().struck).toContain('s1m')
    const b = S().threads.at(-1)?.beats[0]
    expect(b?.say).toBe('You are right, that line was wrong.')
    expect(b?.actions[0]).toMatchObject({ t: 'math', id: 's1m-fix', verify: { status: 'pass' } })
  })

  test('recap: practice checks verified; a failing one is replaced by self-rating', async () => {
    const recap = jsonl(
      { t: 'idea', id: 'i1', text: 'The idea.', seg: 1 }, say('What do you think now?'),
      { ...choice('rp1', ['a', 'b']), idea: 'i1' },
      { t: 'check', id: 'rp2', kind: 'number', prompt: '2+2?', answer: '4', explain: 'e', hint: 'h', idea: 'i1' },
    )
    const { fake, ctl, S, dispatch, segDone, playUntil } = setup({ plan: jsonl(...planRecs(1)), 'segment:1': SEG(1), recap })
    await ctl.start({ topic: 't' })
    await segDone('seg:1')
    dispatch({ type: 'warmup/skip' })
    await playUntil((s) => s.phase === 'checkpoint')
    dispatch(right('c1'))
    expect(S().phase).toBe('recap')
    await waitFor(() => S().recap?.status === 'complete', 'recap complete')
    expect(fake.requests.find((r) => r.intent === 'recap')?.role).toBe('recap')
    expect(S().recap?.ideas.map((i) => i.id)).toEqual(['i1'])
    expect(S().recap?.say).toBe('What do you think now?')
    expect(S().recap?.practice.map((c) => [c.id, c.verify.status])).toEqual([['rp1-rate', 'unchecked'], ['rp2', 'pass']])
  })

  test('never more than 2 concurrent generate calls', async () => {
    const seg = SEG(1, [badMath('s1x'), badMath('s1y'), badMath('s1z')])
    const map: Record<string, FakeEntry> = {
      plan: PLAN, 'segment:1': seg,
      'repair:s1x': jsonl(badMath('s1x')), 'repair:s1y': jsonl(badMath('s1y')), 'repair:s1z': jsonl(badMath('s1z')),
      'answer:free:1': jsonl(say('One.')), 'answer:free:2': jsonl(say('Two.')), 'answer:free:3': jsonl(say('Three.')),
    }
    const { fake, ctl, S, segDone, idle } = setup(map, { delayMs: 2, chunk: 25 })
    const started = ctl.start({ topic: 't' })
    ctl.ask({ question: 'q1', targets: [] })
    ctl.ask({ question: 'q2', targets: [] })
    ctl.ask({ question: 'q3', targets: [] })
    await started
    await segDone('seg:1')
    await waitFor(() => S().threads.every((t) => t.status === 'complete'), 'threads complete')
    await waitFor(() => count(fake.intents(), 'repair:s1z') === 1)
    await idle()
    expect(fake.peak).toBe(2)
    expect(fake.requests).toHaveLength(1 + 1 + 3 + 3)
  })

  test('dispose aborts and stops dispatching', async () => {
    const { fake, ctl, S, store } = setup({ plan: PLAN, 'segment:1': SEG(1) }, { delayMs: 3, chunk: 10, ignoreAbort: true })
    await ctl.start({ topic: 't' })
    await waitFor(() => S().segments['seg:1']?.status === 'streaming')
    ctl.dispose()
    const n = store.getState().log.length
    await waitFor(() => fake.active === 0)
    await tick(10)
    expect(fake.requests[1]?.signal.aborted).toBe(true)
    expect(store.getState().log.length).toBe(n)
  })
})

describe('lesson controller: end-to-end replay of vertex.fixture.json', () => {
  test('plan → seg 1 → wrong (b) → reteach → correct → seg 2 (with an ask) → recap', async () => {
    const rec = RecordingSchema.parse(JSON.parse(readFileSync('tests/fixtures/lessons/vertex.fixture.json', 'utf8')))
    const replay = createReplaySource(rec, { chunkChars: 97, intervalMs: 0 })
    const requests: string[] = []
    const source: AiSource = {
      ...replay,
      id: 'replay',
      generate: (req, signal) => {
        requests.push(req.intent)
        return replay.generate(req, signal)
      },
    }
    const { ctl, S, dispatch, segDone, playUntil, store } = setup({}, {}, source)
    await ctl.start({ topic: 'vertex of a parabola' })
    expect(S().badge.mode).toBe('recorded')
    expect(S().phase).toBe('warmup')
    expect(S().plan).toHaveLength(2)
    dispatch({ type: 'warmup/answer', optionId: 'a' })
    await segDone('seg:1')
    expect(S().segments['seg:1']?.check?.id).toBe('c1')
    await playUntil((s) => s.phase === 'checkpoint', 'c1')
    const c1 = S().segments['seg:1']?.check
    const mis = c1?.kind === 'choice' ? c1.options.find((o) => o.id === 'b')?.misconception : undefined
    dispatch(wrong('c1', 'b', mis))
    await segDone('reteach:c1:1')
    await playUntil((s) => s.phase === 'checkpoint' && s.cursor.seg === 'reteach:c1:1', 'back at c1')
    dispatch(right('c1'))
    expect(S().cursor.seg).toBe('seg:2')
    await segDone('seg:2')
    expect(S().segments['seg:2']?.asks.map((a) => a.id)).toEqual(['q2'])
    ctl.ask({ question: 'Why is the vertex the lowest point?', targets: [], askId: 'q2' })
    await waitFor(() => S().threads[0]?.status === 'complete', 'answer:q2')
    dispatch({ type: 'interrupt/close', outcome: 'clear' })
    await playUntil((s) => s.phase === 'checkpoint', 'c2')
    expect(S().currentCheck).toBe('c2')
    dispatch(right('c2'))
    expect(S().phase).toBe('recap')
    await waitFor(() => S().recap?.status === 'complete', 'recap')
    expect(S().recap?.ideas).toHaveLength(2)
    expect(S().recap?.practice.map((c) => [c.id, c.verify.status])).toEqual([['rp1', 'pass'], ['rp2', 'pass'], ['rp3', 'pass']])
    expect(requests).toEqual(['plan', 'segment:1', 'segment:2', 'reteach:c1:b', 'answer:q2', 'recap'])
    expect(store.getState().log.some((e) => e.type === 'error' || e.type === 'seg/failed' || e.type === 'seg/regenerate')).toBe(false)
  })
})
