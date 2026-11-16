import { expect, test } from 'vitest'
import { intents } from '../../../src/lesson/intents'

test('intents are the exact strings above', () => {
  expect(intents.plan).toBe('plan')
  expect(intents.segment(2)).toBe('segment:2')
  expect(intents.reteach('c1', 'a0')).toBe('reteach:c1:a0')
  expect(intents.solution('c1')).toBe('solution:c1')
  expect(intents.lost(1, 2)).toBe('lost:1:2')
  expect(intents.answer('q1')).toBe('answer:q1')
  expect(intents.freeAnswer(3)).toBe('answer:free:3')
  expect(intents.recap).toBe('recap')
  expect(intents.review('c1')).toBe('review:c1')
  expect(intents.repair('w3')).toBe('repair:w3')
})
