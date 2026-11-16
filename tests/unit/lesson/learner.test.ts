import { describe, expect, test } from 'vitest'
import { emptyLearner, LOST_STYLES, nextLostStyle, recordAnswer } from '../../../src/lesson/learner'
import { run, teaching, advance, fill } from './helpers'

describe('learner model', () => {
  test('nextLostStyle rotates; two lost requests in one segment use different styles', () => {
    expect(LOST_STYLES).toEqual(['a concrete numeric example', 'a picture', 'an everyday analogy', 'smaller steps'])
    expect([0, 1, 2, 3, 4].map(nextLostStyle)).toEqual([...LOST_STYLES, LOST_STYLES[0]])
    const s = run([...advance(1), { type: 'lost/request' }, ...fill('lost:1:1', 1), ...advance(1), { type: 'lost/request' }], teaching())
    expect(s.learner.lostCount[1]).toBe(2)
    expect(s.segments['lost:1:2']).toBeDefined()
    // k is 1-based: style for lost:n:k is nextLostStyle(k - 1)
    expect(nextLostStyle(0)).not.toBe(nextLostStyle(1))
  })

  test('recordAnswer appends answers and tracks misconceptions without mutating', () => {
    const l0 = Object.freeze(emptyLearner())
    expect(l0).toEqual({ answers: [], misconceptions: [], unsure: 0, lostCount: {}, questions: [], pace: 'normal' })
    const l1 = recordAnswer(l0, 'c1', { result: 'wrong', branch: 'a0', misconception: 'adds exponents' })
    const l2 = recordAnswer(l1, 'c1', { result: 'wrong', branch: 'a0', misconception: 'adds exponents' })
    expect(l2.answers).toEqual([{ checkId: 'c1', branch: 'a0', correct: false }, { checkId: 'c1', branch: 'a0', correct: false }])
    expect(l2.misconceptions).toEqual([{ text: 'adds exponents', resolved: false, checkId: 'c1' }])
    const l3 = recordAnswer(l2, 'c1', { result: 'correct', branch: 'opt1' })
    expect(l3.misconceptions[0]?.resolved).toBe(true)
    expect(l0.answers).toEqual([])
  })
})
