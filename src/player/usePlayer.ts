import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { paginate } from '../layout/engine'
import { createDomMeasurer } from '../layout/measure-dom'
import type { Measurer, Page, Viewport } from '../layout/types'
import { realClock } from '../lib/clock'
import type { Clock } from '../lib/clock'
import { activeThread, currentSegment, pagesInput, stalledAtEnd, visibleBeatIds } from '../lesson/selectors'
import type { LessonStore } from '../lesson/store'
import type { Beat } from '../pipeline/beats'
import { timeBeat } from './durations'
import type { BeatTiming } from './durations'
import { bindKeys } from './keyboard'
import { createScheduler } from './scheduler'
import { createSpeech } from './speech'
import type { Speech } from './speech'

export type PlayerOpts = {
  measureRoot: RefObject<HTMLElement | null>
  viewport: Viewport
  /** Tests inject a fake; otherwise `createDomMeasurer(measureRoot.current ?? document.body)`. */
  measurer?: Measurer
  clock?: Clock
  speech?: Speech
  initialSpeed?: number
  /** Start paused (a resumed lesson speaks only after the learner's click). */
  startPaused?: boolean
  /** Bind the global player keys (default true). */
  keys?: boolean
}

export type Player = {
  pages: Page[]
  pageIndex: number
  visibleBeats: ReadonlySet<string>
  animating?: { beatId: string; timing: BeatTiming }
  playToken: number
  paused: boolean
  /** The next beat has not streamed yet: show the thinking indicator. */
  waiting: boolean
  speed: number
  setSpeed(s: number): void
  muted: boolean
  toggleMute(): void
  togglePlay(): void
  replay(): void
  back(): void
  forward(): void
  raiseHand(): void
  currentSay: string
  /** Beats already on the board (for the transcript). */
  transcriptBeats: Beat[]
  /** Which track the playing beat belongs to. */
  track: 'lesson' | 'answer'
}

export function usePlayer(store: StoreApi<LessonStore>, opts: PlayerOpts): Player {
  const state = useStore(store, (s) => s.state)
  const [paused, setPaused] = useState(opts.startPaused ?? false)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeedState] = useState(opts.initialSpeed ?? 1)
  const [playToken, setPlayToken] = useState(0)
  const [currentSay, setSay] = useState('')
  const pausedRef = useRef(opts.startPaused ?? false)
  const mutedRef = useRef(false)
  const speedRef = useRef(speed)
  const playingRef = useRef<string | null>(null)

  const speech = useMemo(
    () => opts.speech ?? createSpeech({ muted: () => mutedRef.current, clock: opts.clock }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.speech, opts.clock],
  )
  const scheduler = useMemo(
    () =>
      createScheduler({
        speech,
        clock: opts.clock ?? realClock,
        onBeatEnd(id) {
          if (playingRef.current === id && !pausedRef.current) store.getState().dispatch({ type: 'player/advance' })
        },
      }),
    [speech, opts.clock, store],
  )

  // What is playing now.
  const play = useMemo(() => {
    if (!state) return null
    const pb = state.playback
    if (pb.track === 'answer') {
      const t = activeThread(state)
      const beat = t?.beats[pb.beat]
      return t && beat ? { key: `a:${t.id}:${pb.beat}`, beat, track: 'answer' as const } : null
    }
    if (state.phase !== 'teaching' || state.overlay) return null
    const beat = currentSegment(state)?.beats[state.cursor.beat]
    return beat ? { key: `l:${state.cursor.seg}:${state.cursor.beat}`, beat, track: 'lesson' as const } : null
  }, [state])
  const playBeatId = play?.beat.id ?? null
  playingRef.current = playBeatId

  const seg = state?.segments
  const pages = useMemo(() => {
    if (!state) return []
    const m = opts.measurer ?? createDomMeasurer(opts.measureRoot.current ?? document.body)
    return paginate(pagesInput(state), m, opts.viewport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg, state?.order, state?.visited, state?.cursor.seg, state?.patches, opts.viewport, opts.measurer])

  // (Re)start the beat whenever it changes, on replay/resume, or when un-paused.
  const playRef = useRef(play)
  playRef.current = play
  useEffect(() => {
    const p = playRef.current
    if (!p) { scheduler.stop(); return }
    if (p.beat.say) setSay(p.beat.say)
    if (paused) { scheduler.stop(); return }
    scheduler.play(p.beat, speedRef.current)
  }, [play?.key, paused, playToken, scheduler])
  useEffect(() => () => scheduler.stop(), [scheduler])

  // Advance contract: the reducer does not self-advance.
  // Never while an overlay is open: the cursor must stay where the learner interrupted.
  const stalled = state && !state.overlay ? stalledAtEnd(state) : false
  const stallKey = stalled && state ? `${state.cursor.seg}:${state.cursor.beat}` : null
  const stallDone = useRef<string | null>(null)
  useEffect(() => {
    if (stallKey === null) { stallDone.current = null; return }
    if (stallDone.current === stallKey) return // once per stall (StrictMode / remount safe)
    stallDone.current = stallKey
    store.getState().dispatch({ type: 'player/advance' })
  }, [stallKey, store])

  // Closing an overlay (hand lowered) replays the interrupted beat from its start, whatever else changed.
  const overlayOpen = !!state?.overlay
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !overlayOpen) setPlayToken((t) => t + 1)
    wasOpen.current = overlayOpen
  }, [overlayOpen])

  const setPausedBoth = (v: boolean) => { pausedRef.current = v; setPaused(v) }

  const togglePlay = useCallback(() => {
    if (pausedRef.current) {
      setPausedBoth(false)
      setPlayToken((t) => t + 1)
    } else {
      scheduler.pause()
      setPausedBoth(true)
    }
  }, [scheduler])

  const seek = useCallback((delta: number | 'same') => {
    const s = store.getState().state
    if (!s || s.playback.track !== 'lesson') return
    const g = currentSegment(s)
    if (!g || g.beats.length === 0) return
    const last = g.beats.length - 1
    const at = Math.min(s.cursor.beat, last)
    const next = delta === 'same' ? at : at + delta
    if (next < 0 || next > last) return
    if (s.phase === 'teaching' || s.phase === 'checkpoint') store.getState().dispatch({ type: 'player/seek', cursor: { seg: g.key, beat: next } })
    setPlayToken((t) => t + 1)
  }, [store])

  const replay = useCallback(() => {
    const s = store.getState().state
    if (s?.playback.track === 'answer') setPlayToken((t) => t + 1)
    else seek('same')
    setPausedBoth(false)
    setPlayToken((t) => t + 1)
  }, [seek, store])
  const back = useCallback(() => seek(-1), [seek])
  const forward = useCallback(() => {
    const s = store.getState().state
    // At a checkpoint the cursor sits past the last beat: forward must not skip the checkpoint.
    if (s && s.phase === 'teaching') seek(1)
  }, [seek, store])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if (next) speech.cancelAll() // the beat finishes on the timer
  }, [speech])

  const raiseHand = useCallback(() => {
    const open = store.getState().state?.overlay
    if (open?.kind === 'interrupt' || (open?.kind === 'problem' && open.prev)) return // already up: do not cut the answer short
    // Raising a hand is not a user pause: stop speech now; the open overlay stops the lesson track.
    scheduler.stop()
    store.getState().dispatch({ type: 'interrupt/open' })
  }, [scheduler, store])

  const setSpeed = useCallback((s: number) => { speedRef.current = s; setSpeedState(s) }, [])

  const handlersRef = useRef({ togglePlay, back, forward, replay, toggleMute, raiseHand })
  handlersRef.current = { togglePlay, back, forward, replay, toggleMute, raiseHand }
  useEffect(() => {
    if (opts.keys === false) return
    return bindKeys(window, {
      togglePlay: () => handlersRef.current.togglePlay(),
      back: () => handlersRef.current.back(),
      forward: () => handlersRef.current.forward(),
      replay: () => handlersRef.current.replay(),
      toggleMute: () => handlersRef.current.toggleMute(),
      raiseHand: () => handlersRef.current.raiseHand(),
    })
  }, [opts.keys])

  const visibleBeats = useMemo<ReadonlySet<string>>(() => (state ? new Set(visibleBeatIds(state, { includeCurrent: true })) : new Set()), [state])

  const pageIndex = useMemo(() => {
    if (!state || pages.length === 0) return 0
    const g = currentSegment(state)
    const id = g && g.beats.length > 0 ? g.beats[Math.min(state.cursor.beat, g.beats.length - 1)]!.id : undefined
    const hit = id ? pages.findIndex((p) => p.beatIds.includes(id)) : -1
    if (hit >= 0) return hit
    for (let i = pages.length - 1; i >= 0; i--) if (pages[i]!.segKey === state.cursor.seg) return i
    return pages.length - 1
  }, [state, pages])

  const animating = useMemo(
    // Speed changes apply from the next beat: the timing is frozen to what the scheduler started with.
    () => (play ? { beatId: play.beat.id, timing: timeBeat(play.beat, speedRef.current) } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [play?.key, playToken],
  )

  const waiting = useMemo(() => {
    if (!state) return false
    if (state.phase === 'planning') return true
    if (state.playback.track === 'answer') {
      const t = activeThread(state)
      return !!t && state.playback.beat >= t.beats.length && (t.status === 'pending' || t.status === 'streaming')
    }
    if (state.phase !== 'teaching' || state.overlay) return false
    const g = currentSegment(state)
    return !!g && state.cursor.beat >= g.beats.length && (g.status === 'pending' || g.status === 'streaming')
  }, [state])

  const transcriptBeats = useMemo(() => {
    if (!state) return []
    return pagesInput(state).flatMap((p) => p.beats).filter((b) => visibleBeats.has(b.id))
  }, [state, visibleBeats])

  return {
    pages, pageIndex, visibleBeats, animating, playToken, paused, waiting, speed, setSpeed, muted, toggleMute,
    togglePlay, replay, back, forward, raiseHand, currentSay, transcriptBeats, track: play?.track ?? (state?.playback.track ?? 'lesson'),
  }
}
