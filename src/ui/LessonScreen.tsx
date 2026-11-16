import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useStore } from 'zustand'
import { Board } from '../board/Board'
import { startValues } from '../board/elements/Explore'
import type { ParamValues } from '../board/elements/Explore'
import type { Viewport } from '../layout/types'
import { activeCheck } from '../lesson/selectors'
import type { LessonEvent } from '../lesson/events'
import type { SegKey } from '../lesson/types'
import { Captions } from '../player/Captions'
import { Controls } from '../player/Controls'
import { usePlayer } from '../player/usePlayer'
import { BestEffortBanner } from './BestEffortBanner'
import { Disclosure } from './Disclosure'
import { buildIndex, segmentTitle, selectedInFigure } from './lesson-view'
import { Practice } from './Practice'
import { ProblemOverlay } from './ProblemOverlay'
import { ProgressRail } from './ProgressRail'
import { Recap } from './Recap'
import { ReviewView } from './ReviewView'
import { boardMeasurer, leaveLesson, sessionDeps, useSession } from './session'
import type { Session } from './session'
import { SidePanel } from './SidePanel'
import { useUi } from './store'
import { ThinkingIndicator } from './ThinkingIndicator'
import { WarmUp } from './WarmUp'

/** The board uses its narrow logical size when its container is under 900 CSS px. */
function useViewport(ref: RefObject<HTMLElement | null>): Viewport {
  const [vp, setVp] = useState<Viewport>('wide')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setVp(w < 900 ? 'narrow' : 'wide')
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return vp
}

export function LessonScreen() {
  const session = useSession((s) => s.session)
  if (!session) {
    return (
      <main className="lesson-empty" id="main">
        <p>No lesson in progress.</p>
        <button type="button" onClick={leaveLesson}>Go home</button>
      </main>
    )
  }
  return <LessonView key={session.id} session={session} />
}

function LessonView({ session }: { session: Session }) {
  const { store, controller } = session
  const state = useStore(store, (s) => s.state)
  const dispatch = useCallback((e: LessonEvent) => store.getState().dispatch(e), [store])
  const selected = useUi((s) => s.selected)
  const review = useUi((s) => s.review)
  const captions = useUi((s) => s.captions)
  const ui = useUi.getState()

  const stageRef = useRef<HTMLDivElement>(null)
  const viewport = useViewport(stageRef)
  const measurer = useMemo(boardMeasurer, [])
  const player = usePlayer(store, {
    measureRoot: stageRef, viewport, measurer, initialSpeed: ui.speed, speech: sessionDeps().speech,
  })

  // Mute follows the saved setting, and later toggles (button or M key) are saved.
  const prevMuted = useRef(player.muted)
  useEffect(() => {
    if (useUi.getState().muted && !player.muted) player.toggleMute()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prevMuted.current === player.muted) return
    prevMuted.current = player.muted
    useUi.getState().setMuted(player.muted)
  }, [player.muted])

  const index = useMemo(
    () => (state ? buildIndex(state) : new Map()),
    [state?.segments, state?.threads, state?.patches], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Explore sliders are controlled here so a `set` checkpoint can read the value.
  const [params, setParams] = useState<Record<string, ParamValues>>({})
  const onParamChange = useCallback((id: string, name: string, v: number) => {
    setParams((p) => ({ ...p, [id]: { ...p[id], [name]: v } }))
  }, [])

  // Task 16 wires these to the interrupt panel and report-a-mistake.
  const onAskAbout = useCallback((_id: string) => {}, [])
  const onReport = useCallback((_id: string) => {}, [])

  const pausedForReview = useRef(false)
  const openReview = (key: SegKey) => {
    if (!player.paused && state?.phase === 'teaching') {
      player.togglePlay()
      pausedForReview.current = true
    }
    ui.openReview(key)
  }
  const closeReview = () => {
    ui.closeReview()
    if (pausedForReview.current) {
      pausedForReview.current = false
      if (player.paused) player.togglePlay()
    }
  }

  if (!state) return <main className="lesson" id="main"><p className="helper">Starting…</p></main>

  const phase = state.phase
  const check = activeCheck(state)
  const tapSel = check ? selectedInFigure(check, selected, index) : undefined
  let paramValue: number | undefined
  if (check?.kind === 'set') {
    const ex = index.get(check.explore)
    paramValue = params[check.explore]?.[check.param] ?? (ex?.t === 'explore' ? startValues(ex)[check.param] : undefined)
  }
  const replaySegment = () => {
    dispatch({ type: 'player/seek', cursor: { seg: state.cursor.seg, beat: 0 } })
    if (player.paused) player.togglePlay()
  }

  const problem = state.overlay?.kind === 'problem' ? state.overlay : null
  const recapBusy = phase === 'recap' && (state.recap?.status === 'pending' || state.recap?.status === 'streaming')
  const thinking = !state.overlay && (player.waiting || phase === 'planning' || recapBusy)
  const reviewing = review && state.segments[review] ? review : undefined

  let stage: React.ReactNode
  if (phase === 'planning') {
    stage = <p className="stage-note card">Planning your lesson…</p>
  } else if (reviewing) {
    stage = (
      <ReviewView
        key={reviewing} title={segmentTitle(state, reviewing)} pages={player.pages.filter((p) => p.segKey === reviewing)}
        index={index} viewport={viewport} onBack={closeReview}
      />
    )
  } else if (phase === 'warmup' && state.warmup) {
    stage = (
      <WarmUp
        record={state.warmup.record}
        onAnswer={(optionId) => dispatch({ type: 'warmup/answer', optionId })}
        onSkip={() => dispatch({ type: 'warmup/skip' })}
      />
    )
  } else if (phase === 'recap') {
    stage = <Recap state={state} onReview={openReview} onPractice={() => dispatch({ type: 'practice/start' })} />
  } else if (phase === 'practice' || phase === 'done') {
    stage = <Practice state={state} dispatch={dispatch} onReview={openReview} onHome={leaveLesson} />
  } else {
    stage = (
      <>
        <Board
          pages={player.pages} pageIndex={player.pageIndex} visibleBeats={player.visibleBeats} animating={player.animating}
          playToken={player.playToken} paused={player.paused} speed={player.speed} selected={selected} onSelect={ui.select}
          onAskAbout={onAskAbout} onReport={onReport} index={index} viewport={viewport} params={params} onParamChange={onParamChange}
        />
        <Captions say={player.currentSay} enabled={captions} />
        <div className="player-bar">
          <Controls
            paused={player.paused} muted={player.muted} speed={player.speed}
            onTogglePlay={player.togglePlay} onBack={player.back} onForward={player.forward} onReplay={player.replay}
            onSpeed={(s) => { player.setSpeed(s); ui.setSpeed(s) }} onToggleMute={player.toggleMute}
          />
          <label className="captions-toggle">
            <input type="checkbox" checked={captions} onChange={(e) => ui.setCaptions(e.target.checked)} /> Captions
          </label>
        </div>
      </>
    )
  }

  return (
    <main className="lesson" id="main">
      <h2 className="lesson-topic">{state.topic}</h2>
      {state.scope?.verdict === 'adjacent' ? <BestEffortBanner /> : null}
      <ProgressRail state={state} reviewing={reviewing} onReview={openReview} />
      <div className="lesson-grid">
        <div className="stage" ref={stageRef}>
          {thinking ? <ThinkingIndicator onCancel={() => controller.cancel()} /> : null}
          {stage}
          <Disclosure />
        </div>
        <SidePanel
          state={state} dispatch={dispatch} selectedInFigure={tapSel} paramValue={paramValue}
          onReplaySegment={replaySegment} transcript={player.transcriptBeats} index={index}
        />
      </div>
      {problem ? (
        <ProblemOverlay
          error={problem.error}
          onRetry={() => controller.retry()}
          onSettings={() => ui.go('settings')}
          onHome={leaveLesson}
        />
      ) : null}
    </main>
  )
}
