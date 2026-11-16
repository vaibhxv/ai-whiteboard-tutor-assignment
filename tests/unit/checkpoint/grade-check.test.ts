import { describe, expect, test } from 'vitest'
import type { CheckAction } from '../../../src/actions'
import { gradeCheck, selfRatingCheck } from '../../../src/checkpoint/grade-check'

const base = { t: 'check', id: 'c1', prompt: 'p', explain: 'e', hint: 'h' } as const
const num: CheckAction = {
  ...base, kind: 'number', answer: '2',
  anticipated: [{ value: '-2', misconception: 'sign slip' }, { value: '4', misconception: 'doubled' }],
}
const expr: CheckAction = { ...base, kind: 'expr', answer: '2x+2', variable: 'x', anticipated: [{ value: '2x+1', misconception: 'forgot' }] }
const choice: CheckAction = {
  ...base, kind: 'choice',
  options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false, misconception: 'bad b' }],
}

describe('gradeCheck number', () => {
  test('"-2" matches anticipated a0', () => {
    expect(gradeCheck(num, { kind: 'number', text: '-2' })).toEqual({ result: 'wrong', branch: 'a0', misconception: 'sign slip' })
  })
  test('unicode minus matches anticipated', () => {
    expect(gradeCheck(num, { kind: 'number', text: '−2' })).toMatchObject({ branch: 'a0' })
  })
  test('second anticipated', () => {
    expect(gradeCheck(num, { kind: 'number', text: '4' })).toMatchObject({ branch: 'a1', misconception: 'doubled' })
  })
  test('other, correct, notation', () => {
    expect(gradeCheck(num, { kind: 'number', text: '7' })).toEqual({ result: 'wrong', branch: 'other' })
    expect(gradeCheck(num, { kind: 'number', text: 'x = 2' })).toMatchObject({ result: 'correct' })
    expect(gradeCheck(num, { kind: 'number', text: '4/2' })).toMatchObject({ result: 'correct' })
  })
  test.each(['', '   ', '2x+', 'hello', '3 =', '(('])('invalid input %j never throws', (text) => {
    const g = gradeCheck(num, { kind: 'number', text })
    expect(g.result === 'invalid' || g.result === 'wrong' || g.result === 'correct').toBe(true)
  })
  test('empty is invalid with a message', () => {
    expect(gradeCheck(num, { kind: 'number', text: '' })).toMatchObject({ result: 'invalid', message: expect.stringContaining('couldn') })
  })
})

describe('gradeCheck expr', () => {
  test.each(['2(x+1)', '2x + 2', 'x*2+2', '2*x+2', '2x+2 =', '2·x+2'])('%s is correct', (text) => {
    expect(gradeCheck(expr, { kind: 'expr', text })).toMatchObject({ result: 'correct' })
  })
  test('anticipated and other', () => {
    expect(gradeCheck(expr, { kind: 'expr', text: '2x+1' })).toMatchObject({ result: 'wrong', branch: 'a0', misconception: 'forgot' })
    expect(gradeCheck(expr, { kind: 'expr', text: '3x' })).toEqual({ result: 'wrong', branch: 'other' })
  })
  test('unreadable is invalid', () => {
    expect(gradeCheck(expr, { kind: 'expr', text: '2x+*' }).result).toBe('invalid')
  })
})

describe('gradeCheck real-world notation', () => {
  const e: CheckAction = { ...base, kind: 'expr', answer: '12', variable: 'x' }
  test('expr path: 3×4, −3, 3/4 and x² are graded without throwing', () => {
    expect(gradeCheck(e, { kind: 'expr', text: '3×4' })).toMatchObject({ result: 'correct' })
    expect(gradeCheck({ ...e, answer: '-3' }, { kind: 'expr', text: '−3' })).toMatchObject({ result: 'correct' })
    expect(gradeCheck({ ...e, answer: '0.75' }, { kind: 'expr', text: '3/4' })).toMatchObject({ result: 'correct' })
    expect(gradeCheck({ ...e, answer: 'x^2' }, { kind: 'expr', text: 'x²' })).toMatchObject({ result: 'correct' })
  })
  test('number path: −3 and 3/4', () => {
    expect(gradeCheck({ ...num, answer: '-3', anticipated: undefined }, { kind: 'number', text: '−3' })).toMatchObject({ result: 'correct' })
    expect(gradeCheck({ ...num, answer: '0.75', anticipated: undefined }, { kind: 'number', text: '3/4' })).toMatchObject({ result: 'correct' })
  })
  test.each(['number', 'expr'] as const)('%s: empty and whitespace-only are invalid with a message', (kind) => {
    for (const text of ['', '   ', '\t\n']) {
      expect(gradeCheck(kind === 'number' ? num : expr, { kind, text })).toMatchObject({ result: 'invalid', message: expect.stringMatching(/couldn.t read that/) })
    }
  })
  test('large garbage table never throws', () => {
    const junk = ['(((', ')))', '1/0', '0/0', 'x^x^x^x^x^x', '9'.repeat(400), '\u0000', '<script>', '2x+', '=', '==', '∞', 'sqrt(', '1e999', '🙂', '2^(2^(2^(2^9)))', 'a'.repeat(5000)]
    for (const text of junk) for (const c of [num, expr]) {
      expect(() => gradeCheck(c, { kind: c.kind as 'number', text })).not.toThrow()
    }
  })
})

describe('gradeCheck other kinds', () => {
  test('choice', () => {
    expect(gradeCheck(choice, { kind: 'choice', optionId: 'a' })).toEqual({ result: 'correct', branch: 'a' })
    expect(gradeCheck(choice, { kind: 'choice', optionId: 'b' })).toEqual({ result: 'wrong', branch: 'b', misconception: 'bad b' })
    expect(gradeCheck(choice, { kind: 'choice', optionId: 'zz' }).result).toBe('invalid')
  })
  test('tap', () => {
    const t: CheckAction = { ...base, kind: 'tap', figure: 'f', answer: 'v' }
    expect(gradeCheck(t, { kind: 'tap', elementId: 'v' })).toMatchObject({ result: 'correct' })
    expect(gradeCheck(t, { kind: 'tap', elementId: 'w' })).toMatchObject({ result: 'wrong', branch: 'other' })
  })
  test('set inclusive range', () => {
    const s: CheckAction = { ...base, kind: 'set', explore: 'e', param: 'a', target: [1, 2] }
    for (const v of [1, 1.5, 2]) expect(gradeCheck(s, { kind: 'set', value: v }).result).toBe('correct')
    for (const v of [0.99, 2.01]) expect(gradeCheck(s, { kind: 'set', value: v }).result).toBe('wrong')
  })
  test('rate is always correct with branch = value; self rating factory', () => {
    const r = selfRatingCheck('s1')
    expect(r.id).toBe('s1-rate')
    expect(r.options.map((o) => o.text)).toEqual(['Yes', 'Sort of', 'No'])
    expect(gradeCheck(r, { kind: 'rate', value: 'sort-of' })).toEqual({ result: 'correct', branch: 'sort-of' })
    expect(gradeCheck(r, { kind: 'choice', optionId: 'no' })).toEqual({ result: 'correct', branch: 'no' })
  })
})
