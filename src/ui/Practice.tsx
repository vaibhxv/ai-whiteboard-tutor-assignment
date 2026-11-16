import { useEffect, useRef, useState } from 'react'
import { Checkpoint } from '../checkpoint/Checkpoint'
import type { CheckGrade, LessonEvent } from '../lesson/events'
import type { LessonState, SegKey } from '../lesson/types'
import { ideaVerdicts } from './lesson-view'

/** Practice (FRD H2): the recap's questions one at a time, one try each, then Solid / Shaky per idea. */
export function Practice({ state, dispatch, onReview, onHome }: {
  state: LessonState
  dispatch(e: LessonEvent): void
  onReview(key: SegKey): void
  onHome(): void
}) {
  const checks = state.recap?.practice ?? []
  const current = checks.find((c) => !state.practice[c.id])
  const [graded, setGraded] = useState<{ id: string; grade: CheckGrade }>()
  const feedback = useRef<HTMLParagraphElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const done = state.phase === 'done'
  useEffect(() => { if (graded) feedback.current?.focus() }, [graded])
  useEffect(() => { heading.current?.focus() }, [done])

  if (done || !current) {
    return (
      <section className="practice card" aria-labelledby="results-h">
        <h3 id="results-h" ref={heading} tabIndex={-1}>How it went</h3>
        <ul className="verdicts" aria-label="How each idea went">
          {ideaVerdicts(state).map(({ idea, solid }) => (
            <li key={idea.id} className={solid ? 'is-solid' : 'is-shaky'}>
              <span className="verdict">
                <span aria-hidden="true">{solid ? '✓' : '↻'} </span>{solid ? 'Solid' : 'Shaky'}
              </span>
              <span className="verdict-idea">{idea.text}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="primary" onClick={onHome}>Start another lesson</button>
      </section>
    )
  }

  const n = checks.indexOf(current) + 1
  const mine = graded?.id === current.id ? graded : undefined
  const idea = state.recap?.ideas.find((i) => i.id === current.idea)
  const next = () => {
    if (!mine) return
    setGraded(undefined)
    dispatch({ type: 'practice/answer', checkId: current.id, grade: mine.grade })
  }
  return (
    <section className="practice card" aria-labelledby="practice-h">
      <h3 id="practice-h" ref={heading} tabIndex={-1}>Practice</h3>
      <p className="helper">Question {n} of {checks.length}. One try each.</p>
      {mine ? (
        <div className="practice-done">
          <p className="cp-prompt">{current.prompt}</p>
          <p ref={feedback} tabIndex={-1} className="cp-feedback" role="status" data-result={mine.grade.result}>
            {mine.grade.result === 'correct'
              ? <><span aria-hidden="true">✓ </span>Correct — {current.explain}</>
              : <><span aria-hidden="true">✗ </span>Not quite. {current.explain}</>}
          </p>
          <button type="button" className="primary" onClick={next}>{n < checks.length ? 'Next question' : 'See how it went'}</button>
        </div>
      ) : (
        <Checkpoint
          key={current.id}
          check={current}
          onAnswer={(grade) => setGraded({ id: current.id, grade })}
          onUnsure={() => {}}
          onSkip={() => dispatch({ type: 'practice/skip', checkId: current.id })}
          onReplaySegment={() => { if (idea) onReview(`seg:${idea.seg}`) }}
          onContinue={() => {}}
        />
      )}
    </section>
  )
}
