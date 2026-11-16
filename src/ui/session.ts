/**
 * The one lesson in progress: its store, controller and source. `startLesson` disposes the previous
 * controller before starting the next. Starter lessons always play their recording through replay;
 * a typed topic uses the active (live) source from the settings.
 */
import { createStore, useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { createDomMeasurer, warmMeasureFonts } from '../layout/measure-dom'
import type { Measurer } from '../layout/types'
import { createController } from '../lesson/controller'
import type { LessonController } from '../lesson/controller'
import { capChars } from '../lesson/controller-support'
import { createLessonStore } from '../lesson/store'
import type { LessonStore } from '../lesson/store'
import type { Speech } from '../player/speech'
import { TOPIC_MAX } from '../prompts/context'
import { manifest } from '../recordings/manifest'
import { createActiveSource, noKeys } from '../sources/create'
import { RecordingSchema } from '../sources/recording'
import type { Recording } from '../sources/recording'
import { createReplaySource } from '../sources/replay'
import type { ReplayOpts } from '../sources/replay'
import type { AiSource } from '../sources/types'
import type { Settings } from '../storage/settings'
import { useUi } from './store'

export type StartInput = { kind: 'starter'; slug: string } | { kind: 'topic'; topic: string }

export type Session = {
  id: number
  store: StoreApi<LessonStore>
  controller: LessonController
  source: AiSource
  topic: string
}

type SessionState = { session: Session | null; loading: boolean }

export const sessionStore = createStore<SessionState>()(() => ({ session: null, loading: false }))

export function useSession<T>(sel: (s: SessionState) => T): T {
  return useStore(sessionStore, sel)
}

/** Injection points (tests, dev). */
export type SessionDeps = {
  fetch: typeof fetch
  now(): number
  replay?: ReplayOpts
  measurer?: Measurer
  speech?: Speech
  /** Overrides `createActiveSource` for typed topics. */
  createSource?(settings: Settings): AiSource | null
}

/**
 * Recordings stream at 48 characters every 20 ms: a recorded plan (under 1 KB) arrives in well under the
 * 1.5 s first-warm-up budget, and segments still arrive progressively like a live stream.
 */
export const REPLAY_PACE: ReplayOpts = { chunkChars: 48, intervalMs: 20 }

const defaults = (): SessionDeps => ({
  fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(), replay: REPLAY_PACE,
})
let deps: SessionDeps = defaults()

export function setSessionDeps(patch: Partial<SessionDeps>): void {
  deps = { ...deps, ...patch }
}
export const sessionDeps = (): SessionDeps => deps

let domMeasurer: Measurer | undefined
/** One DOM measurer for the app's lifetime (it owns a hidden host element). */
export function boardMeasurer(): Measurer {
  return deps.measurer ?? (domMeasurer ??= createDomMeasurer(document.body))
}

let fonts: Promise<void> | undefined
/** Board fonts must load before the first measure; skipped where there is no font loading (jsdom). */
function warmFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts || typeof requestAnimationFrame !== 'function') return Promise.resolve()
  fonts ??= warmMeasureFonts().catch(() => {})
  return fonts
}

let attempt = 0
let unwatch: (() => void) | undefined

export function endSession(): void {
  attempt++
  unwatch?.()
  unwatch = undefined
  sessionStore.getState().session?.controller.dispose()
  sessionStore.setState({ session: null, loading: false })
}

/** Leaves the lesson for Home (the controller stops). */
export function leaveLesson(): void {
  endSession()
  useUi.getState().go('home')
}

/** Tests: drop the session and the injected dependencies. */
export function resetSession(): void {
  endSession()
  deps = defaults()
}

const DEFAULT_SUGGESTIONS = ['Completing the square', 'What the gradient of a line means']

/** A declined topic goes back to Home, which shows the reason and two suggestions. */
function watchScope(s: Session) {
  let handled = false
  unwatch = s.store.subscribe((st) => {
    const scope = st.state?.scope
    if (handled || scope?.verdict !== 'declined') return
    handled = true
    queueMicrotask(() => {
      if (sessionStore.getState().session?.id !== s.id) return
      const suggest = [...(scope.suggest ?? []), ...DEFAULT_SUGGESTIONS].slice(0, 2)
      endSession()
      useUi.getState().go('home')
      useUi.setState({ declined: { reason: scope.reason, suggest } })
    })
  })
}

async function begin(source: AiSource, topic: string, mine: number): Promise<boolean> {
  await warmFonts()
  if (mine !== attempt) return false
  endSession()
  const store = createLessonStore()
  const controller = createController({ store, source, now: () => deps.now() })
  const session: Session = { id: ++attempt, store, controller, source, topic }
  sessionStore.setState({ session, loading: false })
  watchScope(session)
  useUi.getState().go('lesson')
  void controller.start({ topic })
  return true
}

async function loadRecording(file: string): Promise<Recording | null> {
  try {
    const res = await deps.fetch(file)
    if (!res.ok) return null
    const parsed = RecordingSchema.safeParse(await res.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Plays a recording already in memory (the dev fixture path). */
export function startRecording(rec: unknown, topic: string): Promise<boolean> {
  const parsed = RecordingSchema.safeParse(rec)
  if (!parsed.success) return Promise.resolve(false)
  return begin(createReplaySource(parsed.data, deps.replay), topic, ++attempt)
}

export async function startLesson(input: StartInput): Promise<boolean> {
  const ui = useUi.getState()
  useUi.setState({ notice: undefined, declined: undefined })
  const mine = ++attempt
  if (input.kind === 'starter') {
    const entry = manifest.find((m) => m.slug === input.slug)
    if (!entry) return false
    sessionStore.setState({ loading: true })
    const rec = await loadRecording(entry.file)
    if (mine !== attempt) return false
    sessionStore.setState({ loading: false })
    if (!rec) {
      ui.setNotice("Couldn't load that recorded lesson. Check your connection and try again.")
      return false
    }
    return begin(createReplaySource(rec, deps.replay), entry.title, mine)
  }
  const topic = capChars(input.topic, TOPIC_MAX)
  if (!topic) return false
  const settings = ui.settings
  const source = deps.createSource ? deps.createSource(settings) : createActiveSource(settings, noKeys)
  if (!source) {
    ui.setNotice("Your chosen AI source isn't connected yet. Open Settings to set it up.")
    return false
  }
  return begin(source, topic, mine)
}
