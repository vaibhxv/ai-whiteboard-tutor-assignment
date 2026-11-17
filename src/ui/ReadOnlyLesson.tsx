import { useMemo } from 'react'
import { paginate } from '../layout/engine'
import { pagesInput } from '../lesson/selectors'
import type { SegKey } from '../lesson/types'
import { useStore } from 'zustand'
import { Transcript } from '../player/Transcript'
import { buildIndex, ideaVerdicts, segmentTitle } from './lesson-view'
import { ProgressRail } from './ProgressRail'
import { ReviewView } from './ReviewView'
import { boardMeasurer, leaveLesson } from './session'
import type { Session } from './session'
import { useUi } from './store'

const LIVE_BANNER = 'This lesson was generated live. Reconnect the same AI source to continue.'

/** Board, transcript and recap of a saved lesson, with no controller: nothing is generated or asked. */
export function ReadOnlyLesson({ session }: { session: Session }) {
  const state = useStore(session.store, (s) => s.state)
  const review = useUi((s) => s.review)
  const go = useUi((s) => s.go)
  const index = useMemo(() => (state ? buildIndex(state) : new Map()), [state])
  const pages = useMemo(() => (state ? paginate(pagesInput(state), boardMeasurer(), 'wide') : []), [state])
  if (!state) return null
  const beats = state.order.flatMap((k) => state.segments[k]?.beats ?? [])
  const reviewing: SegKey | undefined = review && state.segments[review] ? review : undefined
  const open = (k: SegKey) => useUi.getState().openReview(k)
  return (
    <main className="lesson read-only" id="main">
      <h2 className="lesson-topic">{state.topic}</h2>
      {session.readOnly === 'live' ? (
        <p className="notice" role="note">
          {LIVE_BANNER}{' '}
          <button type="button" className="link" onClick={() => go('settings')}>Settings</button>
        </p>
      ) : null}
      <ProgressRail state={state} reviewing={reviewing} onReview={open} />
      {reviewing ? (
        <ReviewView
          key={reviewing} title={segmentTitle(state, reviewing)} pages={pages.filter((p) => p.segKey === reviewing)}
          index={index} viewport="wide" onBack={() => useUi.getState().closeReview()}
        />
      ) : null}
      {state.recap && state.recap.ideas.length > 0 ? (
        <section className="recap card" aria-labelledby="ro-recap-h">
          <h3 id="ro-recap-h">Recap</h3>
          <ol className="ideas">
            {state.recap.ideas.map((idea) => {
              const key: SegKey = `seg:${idea.seg}`
              return (
                <li key={idea.id}>
                  {state.segments[key] ? (
                    <button type="button" className="idea" onClick={() => open(key)}>{idea.text}</button>
                  ) : <span className="idea">{idea.text}</span>}
                </li>
              )
            })}
          </ol>
          {state.phase === 'done' ? (
            <ul className="verdicts" aria-label="How each idea went">
              {ideaVerdicts(state).map(({ idea, solid }) => (
                <li key={idea.id} className={solid ? 'is-solid' : 'is-shaky'}>
                  <span aria-hidden="true">{solid ? '✓' : '↻'} </span>{solid ? 'Solid' : 'Shaky'}: {idea.text}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <Transcript beats={beats} index={index} />
      <button type="button" onClick={leaveLesson}>Home</button>
    </main>
  )
}
