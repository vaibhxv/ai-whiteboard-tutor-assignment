import { expect, test } from 'vitest'
import { fmtNum } from '../../../src/maths/format'

test('fmtNum', () => {
  expect(fmtNum(-2.5)).toBe('−2.5')
  expect(fmtNum(3)).toBe('3')
  expect(fmtNum(1 / 3)).toBe('0.333')
  expect(fmtNum(2.0004)).toBe('2')
  expect(fmtNum(-0.0001)).toBe('0')
  expect(fmtNum(1.5)).toBe('1.5')
})
