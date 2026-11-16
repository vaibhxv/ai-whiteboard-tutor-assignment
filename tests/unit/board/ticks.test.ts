import { expect, test } from 'vitest'
import { niceTicks } from '../../../src/board/plot/ticks'

test('niceTicks(-1,5) is every integer', () => expect(niceTicks(-1, 5)).toEqual([-1, 0, 1, 2, 3, 4, 5]))
test('niceTicks(0,100) steps by 10 or 20', () => {
  const t = niceTicks(0, 100)
  expect([10, 20]).toContain((t[1] as number) - (t[0] as number))
  expect(t[0]).toBe(0)
  expect(t.at(-1)).toBe(100)
})
test('niceTicks avoids float noise', () => expect(niceTicks(0, 1)).toContain(0.5))
