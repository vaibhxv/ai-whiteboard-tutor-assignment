import { describe, expect, test } from 'vitest'
import { gradeExpr, gradeNumber } from '../../../src/maths/grade'

describe('gradeExpr', () => {
  test.each([
    ['2(x+1)', '2x+2', 'correct'],
    ['2x + 2', '2*x+2', 'correct'],
    ['x*2+2', '2x+2', 'correct'],
    ['2x+1', '2x+2', 'wrong'],
    ['', '2x+2', 'invalid'],
    ['2x+', '2x+2', 'invalid'],
    ['2x+2 =', '2x+2', 'correct'],
    ['x = 3', '2x+2', 'invalid'],
    ['x²', 'x*x', 'correct'],
  ])('gradeExpr %s', (input, answer, result) => {
    expect(gradeExpr(input, answer).result).toBe(result)
  })
  test('invalid message suggests a form', () => {
    const g = gradeExpr('2x+', '2x+2')
    expect(g.result === 'invalid' && g.message).toContain('2x + 3')
  })
})

describe('gradeNumber', () => {
  test.each([
    ['−3', '-3', 'correct'],
    ['3/4', '0.75', 'correct'],
    ['0.7501', '0.75', 'correct'],
    ['0.76', '0.75', 'wrong'],
    ['x = 3', '3', 'correct'],
    ['x = 4', '3', 'wrong'],
    ['3×4', '12', 'correct'],
    ['three', '3', 'invalid'],
    ['', '3', 'invalid'],
    ['x', '3', 'invalid'],
    ['1/0', '3', 'invalid'],
  ])('gradeNumber %s', (input, answer, result) => {
    expect(gradeNumber(input, answer).result).toBe(result)
  })
  test('friendly message', () => {
    const g = gradeNumber('three', '3')
    expect(g).toEqual({ result: 'invalid', message: 'I couldn’t read that — try a number like 3 or −2.5' })
  })
  test('explicit tolerance', () => {
    expect(gradeNumber('3.05', '3', 0.1).result).toBe('correct')
  })
})
