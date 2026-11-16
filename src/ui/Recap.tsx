import { useEffect, useRef } from 'react'
import type { LessonState, SegKey } from '../lesson/types'
import { warmupRevisit } from './lesson-view'

/** Recap (FRD H1): the key ideas, each opening its board page, and the warm-up guess revisited. */
export function Recap({ state, onReview, onPractice }: { state: LessonState; onReview(key: SegKey): void; onPractice(): void }) {
  const r = state.recap
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const ready = r?.status === 'complete'
  const revisit = warmupRevisit(state)
  return (
    <section className="recap card" aria-labelledby="recap-h">
      <h3 id="recap-h" ref={heading} tabIndex={-1}>Recap</h3>
      {r && r.ideas.length > 0 ? (
        <>
          <h4>Key ideas</h4>
          <ol className="ideas">
            {r.ideas.map((idea) => {
              const key: SegKey = `seg:${idea.seg}`
              return (
                <li key={idea.id}>
                  {state.segments[key] ? (
                    <button type="button" className="idea" onClick={() => onReview(key)}>
                      <span>{idea.text}</span>
                      <span className="idea-cta" aria-hidden="true"> ↗</span>
                      <span className="visually-hidden"> (open its board)</span>
                    </button>
                  ) : (
                    <span className="idea">{idea.text}</span>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
      {ready && revisit ? (
        <div className="revisit">
          <h4>Your warm-up guess</h4>
          <p>{revisit.guess}</p>
          {r?.say ? <p>{r.say}</p> : null}
          {revisit.answer ? <p>{revisit.answer}</p> : null}
        </div>
      ) : null}
      {ready ? (
        <button type="button" className="primary" onClick={onPractice}>Practice</button>
      ) : (
        <p className="helper">Putting the recap together…</p>
      )}
    </section>
  )
}
