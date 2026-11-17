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
import { replay } from '../lesson/machine'
import { createLessonStore } from '../lesson/store'
import type { LessonStore } from '../lesson/store'
import type { Speech } from '../player/speech'
import { TOPIC_MAX } from '../prompts/context'
import { manifest } from '../recordings/manifest'
import { createActiveSource } from '../sources/create'
import { keyStore } from '../sources/key-store'
import { RecordingSchema } from '../sources/recording'
import type { Recording } from '../sources/recording'
import { createReplaySource } from '../sources/replay'
import { badgeText } from '../sources/types'
import type { ReplayOpts } from '../sources/replay'
import type { AiSource } from '../sources/types'
import { getActive, listLessons, loadEntry, saveLesson, setActive } from '../storage/history'
import type { SourceRef, Summary } from '../storage/history'
import type { Settings } from '../storage/settings'
import { useUi } from './store'

export type StartInput = { kind: 'starter'; slug: string } | { kind: 'topic'; topic: string }

export type Session = {
  id: number
  store: StoreApi<LessonStore>
  controller: LessonController
  source: AiSource
  topic: string
  /** Where the lesson came from; saved with it so a refresh can rebuild the source. */
  origin: SourceRef
  /** Reopened from storage: the player waits for the learner's click before it speaks. */
  resumed?: boolean
  /** Board, transcript and recap only: a finished lesson, or a live one whose source is not connected. */
  readOnly?: 'done' | 'live'
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

/** Saves the open lesson 500 ms after its last event, and at once on `pagehide` (best effort: IDB is async). */
const SAVE_DELAY_MS = 500
/** While events keep arriving (a streaming lesson), a save still lands at least this often. */
const SAVE_MAX_WAIT_MS = 2000
let persistor: { flush(): void; stop(): void } | undefined

function persist(s: Session): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let firstPending = 0
  const save = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    firstPending = 0
    const { state, log } = s.store.getState()
    if (!state || state.phase === 'planning' || state.plan.length === 0 || state.scope?.verdict === 'declined') return
    const done = state.phase === 'done'
    void saveLesson(state.id, log, {
      topic: state.topic, createdAt: state.createdAt, badgeText: state.badge.text || badgeText(state.badge), done, source: s.origin,
    })
    void setActive(done ? null : state.id)
  }
  const unsub = s.store.subscribe(() => {
    if (timer !== undefined) clearTimeout(timer)
    const now = Date.now()
    if (!firstPending) firstPending = now
    timer = setTimeout(save, Math.max(0, Math.min(SAVE_DELAY_MS, firstPending + SAVE_MAX_WAIT_MS - now)))
  })
  const onHide = () => save()
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide)
  persistor = {
    flush: () => { if (timer !== undefined) save() },
    stop: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      unsub()
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide)
    },
  }
}

export function endSession(discard = false): void {
  if (!discard) persistor?.flush()
  persistor?.stop()
  persistor = undefined
  attempt++
  unwatch?.()
  unwatch = undefined
  sessionStore.getState().session?.controller.dispose()
  sessionStore.setState({ session: null, loading: false })
}

/** Leaves the lesson for Home (the controller stops). */
export function leaveLesson(): void {
  endSession()
  void setActive(null) // leaving keeps the lesson in History but it is not resumed on the next load
  useUi.getState().go('home')
}

/** Tests: drop the session and the injected dependencies. */
export function resetSession(): void {
  endSession(true)
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

async function begin(source: AiSource, topic: string, mine: number, origin: SourceRef): Promise<boolean> {
  await warmFonts()
  if (mine !== attempt) return false
  endSession()
  const store = createLessonStore()
  const controller = createController({ store, source, now: () => deps.now() })
  const session: Session = { id: ++attempt, store, controller, source, topic, origin }
  sessionStore.setState({ session, loading: false })
  watchScope(session)
  persist(session)
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
export const FIXTURE_SLUG = 'fixture:vertex'

export function startRecording(rec: unknown, topic: string): Promise<boolean> {
  const parsed = RecordingSchema.safeParse(rec)
  if (!parsed.success) return Promise.resolve(false)
  return begin(createReplaySource(parsed.data, deps.replay), topic, ++attempt, { kind: 'recording', slug: FIXTURE_SLUG })
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
    return begin(createReplaySource(rec, deps.replay), entry.title, mine, { kind: 'recording', slug: entry.slug, file: entry.file })
  }
  const topic = capChars(input.topic, TOPIC_MAX)
  if (!topic) return false
  const settings = ui.settings
  const source = deps.createSource ? deps.createSource(settings) : createActiveSource(settings, keyStore)
  if (!source) {
    ui.setNotice("Your chosen AI source isn't connected yet. Open Settings to set it up.")
    return false
  }
  const model = source.badge().model
  return begin(source, topic, mine, {
    kind: 'live', sourceId: source.id, ...(settings.provider ? { provider: settings.provider } : {}), ...(model ? { model } : {}),
  })
}

// ------------------------------------------------------------------------------------ history / resume

const inertController: LessonController = {
  start: async () => {}, ask: () => '', followUp() {}, report() {}, retry() {}, cancel() {}, dispose() {},
}

/** The source a saved lesson came from, when it can be rebuilt right now. */
async function sourceFor(ref: SourceRef): Promise<AiSource | null> {
  if (ref.kind === 'recording') {
    let rec: Recording | null = null
    if (ref.slug === FIXTURE_SLUG) {
      if (!import.meta.env.DEV) return null
      const fx = await import('../../tests/fixtures/lessons/vertex.fixture.json')
      const parsed = RecordingSchema.safeParse(fx.default)
      rec = parsed.success ? parsed.data : null
    } else {
      const file = manifest.find((m) => m.slug === ref.slug)?.file ?? ref.file
      rec = file ? await loadRecording(file) : null
    }
    return rec ? createReplaySource(rec, deps.replay) : null
  }
  const settings = useUi.getState().settings
  const src = deps.createSource ? deps.createSource(settings) : createActiveSource(settings, keyStore)
  if (!src || src.id !== ref.sourceId) return null
  if (ref.provider && settings.provider !== ref.provider) return null
  if (ref.model && src.badge().model !== ref.model) return null
  return src
}

function mountReadOnly(log: Parameters<LessonStore['load']>[0], kind: 'done' | 'live', origin: SourceRef): void {
  endSession()
  const store = createLessonStore()
  store.getState().load(log)
  const state = store.getState().state
  const source: AiSource = {
    id: 'replay', badge: () => state!.badge, preflight: async () => ({ ready: false, reason: 'read-only' }),
    // eslint-disable-next-line require-yield
    async *generate() { throw new Error('read-only lesson') },
  }
  const session: Session = { id: ++attempt, store, controller: inertController, source, topic: state!.topic, origin, readOnly: kind }
  sessionStore.setState({ session, loading: false })
  useUi.getState().go('lesson')
}

/**
 * Opens a saved lesson. A finished one (or a live one whose AI source is not connected) opens read-only;
 * otherwise generation resumes from the last completed beat, paused until the learner clicks Play.
 */
export async function openLesson(id: string): Promise<boolean> {
  const mine = ++attempt
  const entry = await loadEntry(id)
  if (!entry || mine !== attempt) return false
  let state
  try { state = replay(entry.log) } catch { return false }
  const origin: SourceRef = entry.summary?.source ?? { kind: 'recording' }
  if (state.phase === 'done' || entry.summary?.done) {
    mountReadOnly(entry.log, 'done', origin)
    return true
  }
  const source = await sourceFor(origin)
  if (mine !== attempt) return false
  if (!source) {
    if (origin.kind === 'live') {
      mountReadOnly(entry.log, 'live', origin)
      return true
    }
    useUi.getState().setNotice("Couldn't load that recorded lesson. Check your connection and try again.")
    return false
  }
  await warmFonts()
  if (mine !== attempt) return false
  endSession()
  const store = createLessonStore()
  store.getState().load(entry.log)
  store.getState().dispatch({ type: 'lesson/resumed' })
  const controller = createController({ store, source, now: () => deps.now() })
  const session: Session = { id: ++attempt, store, controller, source, topic: state.topic, origin, resumed: true }
  sessionStore.setState({ session, loading: false })
  watchScope(session)
  persist(session)
  useUi.getState().go('lesson')
  return true
}

/** App boot: a lesson that was in progress when the page went away comes back (paused). */
export async function resumeActive(): Promise<void> {
  try {
    const id = await getActive()
    if (id && !sessionStore.getState().session) await openLesson(id)
  } catch { /* history unavailable: the app works without it */ }
}

export { listLessons }
export type { Summary }
