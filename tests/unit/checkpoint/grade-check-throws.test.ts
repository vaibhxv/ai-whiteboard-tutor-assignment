import { describe, expect, test, vi } from 'vitest'
import type { CheckAction } from '../../../src/actions'

vi.mock('../../../src/maths/grade', () => ({
  gradeNumber: () => { throw new Error('boom') },
  gradeExpr: () => { throw new Error('boom') },
}))

describe('gradeCheck when the maths layer throws', () => {
  test('returns invalid with a reading message', async () => {
    const { gradeCheck } = await import('../../../src/checkpoint/grade-check')
    const c = { t: 'check', id: 'c', prompt: 'p', explain: 'e', hint: 'h', kind: 'number', answer: '2' } as CheckAction
    expect(gradeCheck(c, { kind: 'number', text: '2' })).toMatchObject({ result: 'invalid', message: expect.stringMatching(/couldn.t read that/) })
  })
})
