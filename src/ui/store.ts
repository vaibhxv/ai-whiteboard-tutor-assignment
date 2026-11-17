import { create } from 'zustand'
import type { SegKey } from '../lesson/types'
import { loadSettings, sanitizeSettings, saveSettings } from '../storage/settings'
import type { Settings } from '../storage/settings'

export type Screen = 'home' | 'lesson' | 'settings' | 'history'

export type UiState = {
  screen: Screen
  /** The board element selected on the lesson board. */
  selected?: string
  captions: boolean
  speed: number
  muted: boolean
  settings: Settings
  /** A completed segment open in the read-only review view (the lesson cursor does not move). */
  review?: SegKey
  /** Elements the learner is asking about (chips in the interrupt panel). */
  askTargets: string[]
  /** Shown on Home after a lesson was declined or could not start. */
  notice?: string
  /** The last topic was declined: its reason and two suggestions, shown on Home. */
  declined?: { reason: string; suggest: string[] }
  go(screen: Screen): void
  select(id: string | undefined): void
  setAskTargets(ids: string[]): void
  setCaptions(on: boolean): void
  setSpeed(speed: number): void
  setMuted(muted: boolean): void
  updateSettings(patch: Partial<Settings>): void
  openReview(key: SegKey): void
  closeReview(): void
  setNotice(notice: string | undefined): void
}

function initial(): Pick<UiState, 'screen' | 'askTargets' | 'captions' | 'speed' | 'muted' | 'settings'> {
  const settings = loadSettings()
  return { screen: 'home', askTargets: [], captions: settings.captions, speed: settings.speed, muted: settings.muted, settings }
}

export const useUi = create<UiState>()((set, get) => {
  const persist = (patch: Partial<Settings>) => {
    const settings = sanitizeSettings({ ...get().settings, ...patch })
    saveSettings(settings)
    return settings
  }
  return {
    ...initial(),
    go: (screen) => set({ screen, selected: undefined, review: undefined, askTargets: [] }),
    select: (selected) => set({ selected }),
    setAskTargets: (askTargets) => set({ askTargets }),
    setCaptions: (captions) => set({ captions, settings: persist({ captions }) }),
    setSpeed: (speed) => set({ speed, settings: persist({ speed }) }),
    setMuted: (muted) => set({ muted, settings: persist({ muted }) }),
    updateSettings: (patch) => {
      const settings = persist(patch)
      set({ settings, captions: settings.captions, speed: settings.speed, muted: settings.muted })
    },
    openReview: (review) => set({ review, selected: undefined }),
    closeReview: () => set({ review: undefined }),
    setNotice: (notice) => set({ notice }),
  }
})

/** Tests: back to a fresh UI built from (cleared) storage. */
export function resetUi(): void {
  useUi.setState({ ...initial(), selected: undefined, review: undefined, notice: undefined, declined: undefined })
}
