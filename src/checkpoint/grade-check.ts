import type { CheckAction } from '../actions'
import type { CheckGrade } from '../lesson/events'
import { gradeExpr, gradeNumber } from '../maths/grade'
import type { Checked } from '../maths/verify'

export type RateValue = 'yes' | 'sort-of' | 'no'

export type CheckResponse =
  | { kind: 'choice'; optionId: string }
  | { kind: 'number' | 'expr'; text: string }
  | { kind: 'tap'; elementId: string }
  | { kind: 'set'; value: number }
  | { kind: 'rate'; value: RateValue }

export type GradeOutcome = CheckGrade | { result: 'invalid'; message: string }

/** Self-rating is a `choice` check (the schema has no `rate` kind) whose id ends in this suffix; every option is "correct". */
export const RATE_SUFFIX = '-rate'
export const isRateCheck = (c: { id: string; kind: string }): boolean => c.kind === 'choice' && c.id.endsWith(RATE_SUFFIX)

/** Self-rating checkpoint (used when verification replaces a checkpoint). Renders as three buttons, never graded. */
export function selfRatingCheck(id: string): Checked<Extract<CheckAction, { kind: 'choice' }>> {
  const base = id.endsWith(RATE_SUFFIX) ? id : `${id}${RATE_SUFFIX}`
  return {
    t: 'check', kind: 'choice', id: base, prompt: 'Did that make sense?',
    explain: 'Thanks — that helps me pace the next part.', hint: 'Pick whichever is closest.',
    options: [
      { id: 'yes', text: 'Yes', correct: true },
      { id: 'sort-of', text: 'Sort of', correct: true },
      { id: 'no', text: 'No', correct: true },
    ],
    verify: { status: 'unchecked' },
  }
}

const bad = (message: string): GradeOutcome => ({ result: 'invalid', message })

/** Pure grading. Invalid input is returned as such and must not count as an attempt. Never throws. */
export function gradeCheck(check: CheckAction, response: CheckResponse): GradeOutcome {
  if (response.kind === 'rate') return { result: 'correct', branch: response.value }
  if (response.kind !== check.kind) return bad('That answer does not fit this question.')
  switch (check.kind) {
    case 'choice': {
      const r = response as Extract<CheckResponse, { kind: 'choice' }>
      const o = check.options.find((x) => x.id === r.optionId)
      if (!o) return bad('Pick one of the options first.')
      return o.correct
        ? { result: 'correct', branch: o.id }
        : { result: 'wrong', branch: o.id, ...(o.misconception ? { misconception: o.misconception } : {}) }
    }
    case 'number':
    case 'expr': {
      const r = response as Extract<CheckResponse, { kind: 'number' | 'expr' }>
      const run = (ans: string) =>
        check.kind === 'number' ? gradeNumber(r.text, ans, check.tolerance) : gradeExpr(r.text, ans)
      const g = run(check.answer)
      if (g.result === 'invalid') return g
      if (g.result === 'correct') return { result: 'correct', branch: 'correct' }
      const list = check.anticipated ?? []
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!
        const m = check.kind === 'number' ? gradeNumber(r.text, a.value) : gradeExpr(r.text, a.value)
        if (m.result === 'correct') return { result: 'wrong', branch: `a${i}`, misconception: a.misconception }
      }
      return { result: 'wrong', branch: 'other' }
    }
    case 'tap': {
      const r = response as Extract<CheckResponse, { kind: 'tap' }>
      if (!r.elementId) return bad('Select an element on the graph first.')
      return r.elementId === check.answer
        ? { result: 'correct', branch: 'correct' }
        : { result: 'wrong', branch: 'other' }
    }
    case 'set': {
      const r = response as Extract<CheckResponse, { kind: 'set'; value: number }>
      if (!Number.isFinite(r.value)) return bad('Set the slider first.')
      const [lo, hi] = check.target
      return r.value >= lo && r.value <= hi
        ? { result: 'correct', branch: 'correct' }
        : { result: 'wrong', branch: 'other' }
    }
  }
}
