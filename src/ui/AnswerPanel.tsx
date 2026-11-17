import { useEffect, useRef } from 'react'
import type { ThreadOutcome, AnswerThread } from '../lesson/types'
import { ThinkingIndicator } from './ThinkingIndicator'

export const FOLLOW_UP_REASON = 'Follow-up questions need a live AI source.'

/**
 * The answer in the side column: what was asked, what the tutor has said so far (the drawing is on the
 * board's answer panel), a thinking indicator while the next beat is awaited, and at the end the
 * "Did that clear it up?" choice.
 */
export function AnswerPanel({ thread, played, replay, onOutcome, onCancel }: {
  thread: AnswerThread
  /** Beats of this thread already spoken (including the one being spoken). */
  played: number
  replay: boolean
  onOutcome(o: ThreadOutcome): void
  onCancel(): void
}) {
  const box = useRef<HTMLElement>(null)
  useEffect(() => { box.current?.focus({ preventScroll: true }) }, [thread.id])
  const live = thread.status === 'pending' || thread.status === 'streaming'
  const says = thread.beats.slice(0, played).filter((b) => b.say)
  const done = thread.status === 'complete' && played >= thread.beats.length
  const waiting = live && played >= thread.beats.length
  const failed = thread.status === 'failed'
  return (
    <section ref={box} tabIndex={-1} className="card answer-box" role="region" aria-label="Answer">
      <h3>Answer</h3>
      <p className="answer-q"><span className="answer-q-label">You asked: </span>{thread.question}</p>
      {says.length > 0 ? <ol className="answer-says">{says.map((b) => <li key={b.id}>{b.say}</li>)}</ol> : null}
      {waiting ? <ThinkingIndicator onCancel={onCancel} /> : null}
      {failed ? <p className="helper">That answer didn't arrive.</p> : null}
      {done ? (
        <div className="answer-done" role="group" aria-labelledby={`clear-${thread.id}`}>
          <p id={`clear-${thread.id}`} className="cp-prompt">Did that clear it up?</p>
          <div className="btn-row">
            <button type="button" className="primary" onClick={() => onOutcome('clear')}>Yes, carry on</button>
            <button type="button" disabled={replay} aria-describedby={replay ? 'follow-reason' : undefined} onClick={() => onOutcome('not-quite')}>Not quite</button>
            <button type="button" disabled={replay} aria-describedby={replay ? 'follow-reason' : undefined} onClick={() => onOutcome('differently')}>Show me differently</button>
          </div>
          {replay ? <p id="follow-reason" className="helper">{FOLLOW_UP_REASON}</p> : null}
        </div>
      ) : !waiting ? (
        <div className="btn-row"><button type="button" onClick={onCancel}>Cancel</button></div>
      ) : null}
    </section>
  )
}
