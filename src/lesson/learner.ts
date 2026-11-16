import type { CheckGrade } from './events'
import type { LearnerModel } from './types'

export const LOST_STYLES = ['a concrete numeric example', 'a picture', 'an everyday analogy', 'smaller steps'] as const
export type LostStyle = (typeof LOST_STYLES)[number]

/** `count` = lost segments already used for this main segment, so `lost:n:k` uses `nextLostStyle(k - 1)`. */
export function nextLostStyle(count: number): LostStyle {
  const i = ((Math.floor(count) % LOST_STYLES.length) + LOST_STYLES.length) % LOST_STYLES.length
  return LOST_STYLES[i] ?? LOST_STYLES[0]
}

export const emptyLearner = (): LearnerModel => ({
  answers: [], misconceptions: [], unsure: 0, lostCount: {}, questions: [], pace: 'normal',
})

export function recordAnswer(l: LearnerModel, checkId: string, grade: CheckGrade): LearnerModel {
  const correct = grade.result === 'correct'
  const answers = [...l.answers, { checkId, branch: grade.branch, correct }]
  let misconceptions = l.misconceptions
  if (correct) {
    if (misconceptions.some((m) => m.checkId === checkId && !m.resolved)) {
      misconceptions = misconceptions.map((m) => (m.checkId === checkId && !m.resolved ? { ...m, resolved: true } : m))
    }
  } else if (grade.misconception && !misconceptions.some((m) => m.text === grade.misconception && !m.resolved)) {
    misconceptions = [...misconceptions, { text: grade.misconception, resolved: false, checkId }]
  }
  return { ...l, answers, misconceptions }
}

export const recordUnsure = (l: LearnerModel): LearnerModel => ({ ...l, unsure: l.unsure + 1 })

export const recordLost = (l: LearnerModel, n: number, k: number): LearnerModel => ({
  ...l, lostCount: { ...l.lostCount, [n]: k },
})

export const recordQuestion = (l: LearnerModel, question: string): LearnerModel => ({
  ...l, questions: [...l.questions, question],
})
