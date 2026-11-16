import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { TOPIC_MAX } from '../prompts/context'
import { manifest } from '../recordings/manifest'
import type { StarterLesson } from '../recordings/manifest'
import { startLesson, useSession } from './session'
import { useUi } from './store'

/** Caps by code point, so a paste can never exceed the limit even where `maxLength` is not enforced. */
const cap = (s: string) => Array.from(s).slice(0, TOPIC_MAX).join('')

function StarterCard({ lesson, live, busy }: { lesson: StarterLesson; live: boolean; busy: boolean }) {
  return (
    <li className="starter">
      <button type="button" className="starter-main" disabled={busy} onClick={() => void startLesson({ kind: 'starter', slug: lesson.slug })}>
        <span className="starter-title">{lesson.title}</span>
        <span className="starter-blurb">{lesson.blurb}</span>
        <span className="starter-cta"><span aria-hidden="true">▶ </span>Play recording</span>
      </button>
      {live ? (
        <button type="button" className="starter-live" disabled={busy} onClick={() => void startLesson({ kind: 'topic', topic: lesson.title })}>
          Generate live
        </button>
      ) : null}
    </li>
  )
}

export function Home() {
  const settings = useUi((s) => s.settings)
  const notice = useUi((s) => s.notice)
  const declined = useUi((s) => s.declined)
  const go = useUi((s) => s.go)
  const busy = useSession((s) => s.loading)
  const live = settings.sourceId !== 'replay'
  const [topic, setTopic] = useState('')
  const box = useRef<HTMLInputElement>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (live && topic.trim()) void startLesson({ kind: 'topic', topic })
  }
  const suggest = (s: string) => {
    setTopic(cap(s))
    box.current?.focus()
  }

  return (
    <main className="home" id="main">
      <h2 className="promise">Stuck on a maths idea? I'll draw it out with you.</h2>

      {declined ? (
        <section className="declined" aria-labelledby="declined-h">
          <h3 id="declined-h">That one's outside what I teach</h3>
          <p>{declined.reason}</p>
          <p>You could try one of these instead:</p>
          <ul className="suggestions">
            {declined.suggest.map((s) => (
              <li key={s}><button type="button" onClick={() => suggest(s)}>{s}</button></li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="topic-form" onSubmit={submit}>
        <label htmlFor="topic">What are you stuck on?</label>
        <div className="topic-row">
          <input
            ref={box} id="topic" type="text" maxLength={TOPIC_MAX} autoComplete="off" disabled={!live}
            aria-describedby={live ? 'topic-help' : 'topic-help topic-why'}
            value={topic} onChange={(e) => setTopic(cap(e.target.value))}
          />
          <button type="submit" disabled={!live || !topic.trim() || busy}>Start lesson</button>
        </div>
        <p id="topic-help" className="helper">Don't include personal details.</p>
        {!live ? (
          <p id="topic-why" className="helper">
            Typing your own topic needs a live AI source.{' '}
            <button type="button" className="link" onClick={() => go('settings')}>Settings</button>
          </p>
        ) : null}
      </form>

      {notice ? <p className="notice">{notice}</p> : null}

      <section className="starters-section" aria-labelledby="starters-h">
        <h3 id="starters-h">Recorded lessons</h3>
        {manifest.length === 0 ? (
          <p className="helper">No recorded lessons are bundled with this build yet.</p>
        ) : (
          <ul className="starters">
            {manifest.map((m) => <StarterCard key={m.slug} lesson={m} live={live} busy={busy} />)}
          </ul>
        )}
      </section>
    </main>
  )
}
