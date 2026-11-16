import { useEffect, useRef, useState } from 'react'
import type { Action } from '../actions'
import { Checkpoint, FIRST_WRONG, SECOND_WRONG } from '../checkpoint/Checkpoint'
import type { CheckGrade, LessonEvent } from '../lesson/events'
import { activeCheck } from '../lesson/selectors'
import type { LessonState } from '../lesson/types'
import type { Beat } from '../pipeline/beats'
import { Transcript } from '../player/Transcript'

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

  if (!check) {
    return note ? (
      <p className="cp-note" role="status" data-result="wrong"><span aria-hidden="true">✗ </span>{note.text}</p>
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
  transcript: Beat[]
  index: ReadonlyMap<string, Action>
}

/** The side column: objective, checkpoint (or its feedback), raised-hand stub and the transcript. */
export function SidePanel(p: SidePanelProps) {
  const { state, dispatch } = p
  const inLesson = state.phase === 'teaching' || state.phase === 'checkpoint'
  return (
    <aside className="side" aria-label="Lesson panel">
      {state.objective ? (
        <p className="objective"><span className="objective-label">Goal: </span>{state.objective}</p>
      ) : null}
      {inLesson ? (
        <CheckpointArea
          state={state} dispatch={dispatch} selectedInFigure={p.selectedInFigure} paramValue={p.paramValue} onReplaySegment={p.onReplaySegment}
        />
      ) : null}
      {state.overlay?.kind === 'interrupt' ? (
        // Task 16 replaces this with the InterruptPanel.
        <div className="card interrupt-stub">
          <p>Your hand is up.</p>
          <button type="button" onClick={() => dispatch({ type: 'interrupt/close', outcome: 'cancel' })}>Carry on</button>
        </div>
      ) : null}
      {state.phase !== 'planning' && state.phase !== 'warmup' ? <Transcript beats={p.transcript} index={p.index} /> : null}
    </aside>
  )
}
