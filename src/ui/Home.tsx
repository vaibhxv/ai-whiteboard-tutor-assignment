import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Play, Sparkles } from 'lucide-react'
import { TOPIC_MAX } from '../prompts/context'
import { manifest } from '../recordings/manifest'
import type { StarterLesson } from '../recordings/manifest'
import { startLesson, useSession } from './session'
import { useUi } from './store'

/** Caps by code point, so a paste can never exceed the limit even where `maxLength` is not enforced. */
const cap = (s: string) => Array.from(s).slice(0, TOPIC_MAX).join('')

/** A small drawing for each bundled starter; decorative. */
function StarterArt({ slug }: { slug: string }) {
  if (slug === 'balance') return <span className="starter-art-text">3x + 5 = 20</span>
  if (slug === 'slope') {
    return (
      <svg width="140" height="90" viewBox="0 0 140 90" fill="none">
        <path d="M10 80L130 15" className="art-main" strokeWidth="3" strokeLinecap="round" />
        <path d="M50 58h40v-22" className="art-mark" strokeWidth="2.5" strokeDasharray="5 4" />
      </svg>
    )
  }
  if (slug === 'vertex') {
    return (
      <svg width="140" height="90" viewBox="0 0 140 90" fill="none">
        <path d="M10 10c25 95 95 95 120 0" className="art-main" strokeWidth="3" strokeLinecap="round" />
        <circle cx="70" cy="80" r="8" className="art-mark" strokeWidth="2.5" />
      </svg>
    )
  }
  return (
    <svg width="140" height="90" viewBox="0 0 140 90" fill="none">
      <path d="M10 70c20-50 40-50 60-20s40 30 60-30" className="art-main" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function StarterCard({ lesson, live, busy }: { lesson: StarterLesson; live: boolean; busy: boolean }) {
  return (
    <li className={`starter${live ? ' has-live' : ''}`}>
      <button type="button" className="starter-main" disabled={busy} onClick={() => void startLesson({ kind: 'starter', slug: lesson.slug })}>
        <span className="starter-art" aria-hidden="true"><StarterArt slug={lesson.slug} /></span>
        <span className="starter-title">{lesson.title}</span>
        <span className="starter-blurb">{lesson.blurb}</span>
        <span className="starter-cta"><Play size={14} aria-hidden="true" fill="currentColor" />Play recording</span>
      </button>
      {live ? (
        <button type="button" className="starter-live" disabled={busy} onClick={() => void startLesson({ kind: 'topic', topic: lesson.title })}>
          <Sparkles size={16} aria-hidden="true" />Generate live
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
      <section className="hero">
      <h2 className="promise">Stuck on a maths idea? I'll draw it out with you.</h2>
      <p className="hero-sub">A tutor that draws and talks it through, asks you to guess first, and stops to check you've got it.</p>

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
          <button type="submit" className="primary" disabled={!live || !topic.trim() || busy}>Start lesson</button>
        </div>
        <p id="topic-help" className="helper">Don't include personal details.</p>
        {!live ? (
          <p id="topic-why" className="helper">
            Typing your own topic needs a live AI source.{' '}
            <button type="button" className="link" onClick={() => go('settings')}>Settings</button>
          </p>
        ) : null}
      </form>
      </section>

      {notice ? <p className="notice">{notice}</p> : null}

      <section className="starters-section" aria-labelledby="starters-h">
        <h3 id="starters-h" className="section-label">Or try a recorded lesson</h3>
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
