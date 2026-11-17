import { useEffect, useRef, useState } from 'react'
import type { Action } from '../actions'
import { Checkpoint, FIRST_WRONG, SECOND_WRONG } from '../checkpoint/Checkpoint'
import type { CheckGrade, LessonEvent } from '../lesson/events'
import { activeCheck } from '../lesson/selectors'
import type { LessonState } from '../lesson/types'
import type { Beat } from '../pipeline/beats'
import { Transcript } from '../player/Transcript'
import type { LessonController } from '../lesson/controller'
import { InterruptPanel, SuggestedChips } from './InterruptPanel'
import { currentSegment } from '../lesson/selectors'

type Dispatch = (e: LessonEvent) => void

/**
 * The checkpoint in play. A correct answer is held until `Continue` so its feedback can be read; a wrong
 * one is sent at once (the re-teach starts) and its feedback stays here, as a status note, while the
 * re-teach or worked solution plays.
 */
export function CheckpointArea({ state, dispatch, selectedInFigure, paramValue, onReplaySegment }: {
  state: LessonState
  dispatch: Dispatch
  selectedInFigure?: string
  paramValue?: number
  onReplaySegment(): void
}) {
  const check = activeCheck(state)
  const [held, setHeld] = useState<{ checkId: string; grade: CheckGrade }>()
  const [note, setNote] = useState<{ checkId: string; text: string }>()
  const box = useRef<HTMLDivElement>(null)
  const noteEl = useRef<HTMLParagraphElement>(null)
  const kind = state.segments[state.cursor.seg]?.kind

  useEffect(() => {
    if (check || kind === 'main') setNote(undefined)
  }, [check?.id, kind, state.cursor.seg]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!check) return
    const el = box.current
    el?.focus({ preventScroll: true })
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [check?.id, state.cursor.seg]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = noteEl.current
    if (note && typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [note])

  if (!check) {
    return note ? (
      <p ref={noteEl} className="cp-note" role="status" data-result="wrong"><span aria-hidden="true">✗ </span>{note.text}</p>
    ) : null
  }

  const id = check.id
  const hold = held?.checkId === id ? held : undefined
  const send = (grade: CheckGrade) => dispatch({ type: 'check/answer', checkId: id, grade })
  const onAnswer = (grade: CheckGrade) => {
    if (grade.result === 'correct') {
      setHeld({ checkId: id, grade })
      return
    }
    const attempts = (state.checks[id]?.attempts ?? 0) + 1
    setNote({ checkId: id, text: attempts >= 2 ? SECOND_WRONG : FIRST_WRONG })
    send(grade)
  }
  return (
    <div ref={box} tabIndex={-1} className="checkpoint-box">
      <Checkpoint
        key={id}
        check={check}
        record={state.checks[id]}
        selectedInFigure={selectedInFigure}
        paramValue={paramValue}
        onAnswer={onAnswer}
        onUnsure={() => dispatch({ type: 'check/unsure', checkId: id })}
        onSkip={() => (hold ? send(hold.grade) : dispatch({ type: 'check/skip', checkId: id }))}
        onReplaySegment={() => { setHeld(undefined); onReplaySegment() }}
        onContinue={() => { if (hold) { setHeld(undefined); send(hold.grade) } }}
      />
    </div>
  )
}

export type SidePanelProps = {
  state: LessonState
  dispatch: Dispatch
  selectedInFigure?: string
  paramValue?: number
  onReplaySegment(): void
  /** Narrow layout: the checkpoint is rendered in the stage under the captions instead. */
  checkpointInStage?: boolean
  transcript: Beat[]
  index: ReadonlyMap<string, Action>
  controller: LessonController
  /** The lesson plays a recording: typed questions, follow-ups and repeated "I'm lost" are unavailable. */
  replay: boolean
  onRaiseHand(): void
  /** Narrow layout: the interrupt panel is rendered in the stage under the captions instead. */
  interruptInStage?: boolean
}

export const LOST_LIMIT_REASON = 'Recorded lessons include one other explanation per step.'

/** Raise hand, "I'm lost" and the suggested questions of the current step. */
function HandBar({ state, dispatch, controller, replay, onRaiseHand }: Pick<SidePanelProps, 'state' | 'dispatch' | 'controller' | 'replay' | 'onRaiseHand'>) {
  const open = !!state.overlay
  const seg = currentSegment(state)
  const lostHere = seg ? Object.values(state.segments).filter((g) => g.kind === 'lost' && g.n === seg.n).length : 0
  const lostBlocked = replay && lostHere >= 1
  return (
    <div className="hand-bar">
      <div className="btn-row">
        <button type="button" onClick={onRaiseHand} disabled={open}>✋ Raise hand</button>
        <button
          type="button" disabled={open || lostBlocked} aria-describedby={lostBlocked ? 'lost-reason' : undefined}
          onClick={() => dispatch({ type: 'lost/request' })}
        >😕 I'm lost</button>
      </div>
      {lostBlocked ? <p id="lost-reason" className="helper">{LOST_LIMIT_REASON}</p> : null}
      {!open ? (
        <SuggestedChips
          asks={seg?.asks ?? []}
          onAsk={(a) => { onRaiseHand(); controller.ask({ question: a.text, targets: [], askId: a.id }) }}
        />
      ) : null}
    </div>
  )
}

/** The side column: objective, checkpoint (or its feedback), raise hand / lost, the interrupt panel and the transcript. */
export function SidePanel(p: SidePanelProps) {
  const { state, dispatch } = p
  const inLesson = state.phase === 'teaching' || state.phase === 'checkpoint'
  return (
    <aside className="side" aria-label="Lesson panel">
      {state.objective ? (
        <p className="objective"><span className="objective-label">Goal: </span>{state.objective}</p>
      ) : null}
      {inLesson && !p.checkpointInStage ? (
        <CheckpointArea
          state={state} dispatch={dispatch} selectedInFigure={p.selectedInFigure} paramValue={p.paramValue} onReplaySegment={p.onReplaySegment}
        />
      ) : null}
      {inLesson ? <HandBar {...p} /> : null}
      {inLesson && !p.interruptInStage ? (
        <InterruptPanel
          state={state} controller={p.controller} dispatch={dispatch} index={p.index} replay={p.replay}
          asks={currentSegment(state)?.asks ?? []}
        />
      ) : null}
      {state.phase !== 'planning' && state.phase !== 'warmup' ? <Transcript beats={p.transcript} index={p.index} /> : null}
    </aside>
  )
}
