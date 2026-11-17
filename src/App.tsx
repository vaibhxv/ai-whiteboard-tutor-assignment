import { useEffect } from 'react'
import { History as HistoryIcon, House, Settings as SettingsIcon } from 'lucide-react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { LessonStore } from './lesson/store'
import { settingsBadge } from './sources/create'
import type { Badge } from './sources/types'
import { History } from './ui/History'
import { Home } from './ui/Home'
import { Settings } from './ui/Settings'
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
      <div className="brand-wrap">
        <span className="brand-logo" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 18c3-9 6-12 8-12s5 3 8 12" />
          </svg>
        </span>
        <h1 className="brand">Whyboard</h1>
      </div>
      <div className="header-spacer" />
      <SourceBadge badge={badge} />
      <nav className="app-nav" aria-label="Main">
        {screen !== 'home' ? (
          <button type="button" className="nav-btn" onClick={leaveLesson}><House size={18} aria-hidden="true" /><span className="nav-text">Home</span></button>
        ) : null}
        {screen !== 'history' ? (
          <button type="button" className="nav-btn" onClick={() => go('history')}><HistoryIcon size={18} aria-hidden="true" /><span className="nav-text">History</span></button>
        ) : null}
        {screen !== 'settings' ? (
          <button type="button" className="nav-btn" aria-label="Open settings" onClick={() => go('settings')}>
            <SettingsIcon size={18} aria-hidden="true" /><span className="nav-text">Settings</span>
          </button>
        ) : null}
      </nav>
    </header>
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
      {screen === 'settings' ? <Settings /> : null}
      {screen === 'history' ? <History /> : null}
    </div>
  )
}
