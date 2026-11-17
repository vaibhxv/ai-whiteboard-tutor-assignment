import { useEffect } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { LessonStore } from './lesson/store'
import { settingsBadge } from './sources/create'
import type { Badge } from './sources/types'
import { History } from './ui/History'
import { Home } from './ui/Home'
import { LessonScreen } from './ui/LessonScreen'
import { leaveLesson, resumeActive, useSession } from './ui/session'
import { SourceBadge } from './ui/SourceBadge'
import { useUi } from './ui/store'

const none: StoreApi<LessonStore> = {
  getState: () => ({ state: null }) as unknown as LessonStore,
  getInitialState: () => ({ state: null }) as unknown as LessonStore,
  setState: () => {},
  subscribe: () => () => {},
}

/** The lesson's own badge while one is open; otherwise the source the next lesson would use. */
function useBadge(): Badge {
  const screen = useUi((s) => s.screen)
  const settings = useUi((s) => s.settings)
  const session = useSession((s) => s.session)
  const lessonBadge = useStore(session?.store ?? none, (s) => s.state?.badge)
  if (session && screen !== 'home') return lessonBadge ?? session.source.badge()
  return settingsBadge(settings)
}

function Header() {
  const screen = useUi((s) => s.screen)
  const go = useUi((s) => s.go)
  const badge = useBadge()
  return (
    <header className="app-header">
      <a className="skip-link" href="#main">Skip to content</a>
      <h1 className="brand">Whyboard</h1>
      <nav className="app-nav" aria-label="Main">
        {screen !== 'home' ? <button type="button" onClick={leaveLesson}>Home</button> : null}
        {screen !== 'history' ? <button type="button" onClick={() => go('history')}>History</button> : null}
        {screen !== 'settings' ? <button type="button" aria-label="Open settings" onClick={() => go('settings')}>Settings</button> : null}
      </nav>
      <SourceBadge badge={badge} />
    </header>
  )
}

/** Placeholder until Task 18 builds the Settings screen. */
function SettingsScreen() {
  const go = useUi((s) => s.go)
  const inLesson = useSession((s) => !!s.session)
  return (
    <main className="settings" id="main">
      <h2>Settings</h2>
      <p>Choosing an AI source arrives in a later build. For now Whyboard plays recorded lessons.</p>
      <button type="button" onClick={() => go(inLesson ? 'lesson' : 'home')}>{inLesson ? 'Back to lesson' : 'Back'}</button>
    </main>
  )
}

export default function App() {
  const screen = useUi((s) => s.screen)
  // A lesson that was in progress when the page went away comes back (once per page load).
  useEffect(() => {
    if (new URLSearchParams(location.search).has('fixture')) return
    void resumeActive()
  }, [])
  return (
    <div className="app">
      <Header />
      {screen === 'home' ? <Home /> : null}
      {screen === 'lesson' ? <LessonScreen /> : null}
      {screen === 'settings' ? <SettingsScreen /> : null}
      {screen === 'history' ? <History /> : null}
    </div>
  )
}
