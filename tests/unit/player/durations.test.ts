import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { ACTION_MS, estimateSpeechMs, timeBeat } from '../../../src/player/durations'
import { beat } from '../layout/fake'

const math = (latex: string): Action => ({ t: 'math', id: 'm1', latex })

describe('estimateSpeechMs', () => {
  test('empty text is 0; otherwise words/2.6 s scaled by rate plus 250', () => {
    expect(estimateSpeechMs('', 1)).toBe(0)
    expect(estimateSpeechMs('a b c d e', 1)).toBeCloseTo((5 / 2.6) * 1000 + 250)
    expect(estimateSpeechMs('a b c d e', 2)).toBeCloseTo((5 / 2.6) * 500 + 250)
  })
})

describe('ACTION_MS', () => {
  test('constants from the brief', () => {
    expect(ACTION_MS.write({ t: 'write', id: 'a', text: 'hi' })).toBe(600)
    expect(ACTION_MS.write({ t: 'write', id: 'a', text: 'x'.repeat(30) })).toBe(1200)
    expect(ACTION_MS.write({ t: 'write', id: 'a', text: 'x'.repeat(100) })).toBe(2500)
    expect(ACTION_MS.math(math('x'.repeat(10)) as never)).toBe(1200)
    expect(ACTION_MS.math(math('x'.repeat(100)) as never)).toBe(2500)
    expect(ACTION_MS.step({ t: 'step', id: 's', latex: 'x'.repeat(10), expr: 'x', why: 'w' })).toBe(1600)
    expect(ACTION_MS.table({ t: 'table', id: 't', head: ['a'], rows: [['1'], ['2'], ['3']] })).toBe(900)
    expect(ACTION_MS.table({ t: 'table', id: 't', head: ['a'], rows: Array.from({ length: 10 }, () => ['1']) })).toBe(1800)
    expect(ACTION_MS.page()).toBe(0)
    expect([ACTION_MS.solutions(), ACTION_MS.plot(), ACTION_MS.point(), ACTION_MS.line(), ACTION_MS.guide(), ACTION_MS.numberline(), ACTION_MS.mark(), ACTION_MS.explore()])
      .toEqual([900, 1800, 350, 500, 400, 900, 500, 1800])
  })
})

describe('timeBeat', () => {
  test('one math action: delays [0], total = max(speech, math ms)', () => {
    const b = beat('b', [math('x'.repeat(10))], 'Now we square both sides of it')
    const t = timeBeat(b, 1)
    expect(t.actionDelays).toEqual([0])
    expect(t.actionDurations).toEqual([1200])
    expect(t.total).toBe(Math.max(1200, estimateSpeechMs(b.say, 1)))
  })
  test('actions run sequentially and scale with speed; empty say totals the animation time', () => {
    const b = beat('b', [math('x'.repeat(10)), { t: 'point', id: 'p', plot: 'g', at: [0, 0] }], '')
    const t = timeBeat(b, 1.5)
    expect(t.actionDelays).toEqual([0, 800])
    expect(t.actionDurations).toEqual([800, 350 / 1.5])
    expect(t.total).toBeCloseTo(800 + 350 / 1.5)
  })
})
