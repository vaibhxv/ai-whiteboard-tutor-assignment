import { useEffect, useId, useRef, useState } from 'react'
import type { Action, AskAction } from '../actions'
import { describeAction } from '../board/describe'
import type { LessonController } from '../lesson/controller'
import type { LessonEvent } from '../lesson/events'
import type { InterruptOverlay, LessonState, ThreadOutcome } from '../lesson/types'
import { AnswerPanel } from './AnswerPanel'
import { useUi } from './store'

export const QUESTION_MAX = 500
export const TYPED_REASON = 'Typed questions need a live AI source.'
const GENERIC_QUESTION = 'Can you explain this part?'

/** The interrupt overlay, also while a problem overlay covers it. */
export function interruptOf(s: LessonState): InterruptOverlay | null {
  const ov = s.overlay
  if (!ov) return null
  return ov.kind === 'interrupt' ? ov : (ov.prev ?? null)
}

/** The short form of an element's description for a chip: at most 40 characters. */
export function chipLabel(id: string, index: ReadonlyMap<string, Action>): string {
  const a = index.get(id)
  const text = a ? describeAction(a, index) : id
  return text.length <= 40 ? text : `${text.slice(0, 39).trimEnd()}…`
}

/** Questions the current segment suggests; a chip asks with its `askId`. */
export function SuggestedChips({ asks, disabled, onAsk }: { asks: AskAction[]; disabled?: boolean; onAsk(a: AskAction): void }) {
  if (asks.length === 0) return null
  return (
    <ul className="chips" aria-label="Suggested questions">
      {asks.map((a) => (
        <li key={a.id}><button type="button" className="chip" disabled={disabled} onClick={() => onAsk(a)}>{a.text}</button></li>
      ))}
    </ul>
  )
}

export type InterruptPanelProps = {
  state: LessonState
  controller: LessonController
  dispatch(e: LessonEvent): void
  index: ReadonlyMap<string, Action>
  replay: boolean
  asks: AskAction[]
}

/** The raised hand: the question form, then (once asked) the answer and its follow-up choice. */
export function InterruptPanel(p: InterruptPanelProps) {
  const ov = interruptOf(p.state)
  if (!ov) return null
  const thread = ov.threadId ? p.state.threads.find((t) => t.id === ov.threadId) : undefined
  const clear = () => useUi.getState().setAskTargets([])
  if (thread) {
    const pb = p.state.playback
    const shown = pb.track === 'answer' && pb.threadId === thread.id ? pb.beat + 1 : thread.beats.length
    return (
      <AnswerPanel
        thread={thread}
        played={Math.min(shown, thread.beats.length)}
        replay={p.replay}
        onCancel={() => { clear(); p.dispatch({ type: 'interrupt/close', outcome: 'cancel' }) }}
        onOutcome={(o: ThreadOutcome) => {
          p.dispatch({ type: 'interrupt/close', outcome: o })
          if (o !== 'clear') p.controller.followUp(thread.id, o)
        }}
      />
    )
  }
  return <AskForm {...p} />
}

function AskForm({ controller, dispatch, index, replay, asks }: InterruptPanelProps) {
  const targets = useUi((s) => s.askTargets)
  const [text, setText] = useState('')
  const id = useId()
  const box = useRef<HTMLFormElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (replay) box.current?.focus({ preventScroll: true })
    else area.current?.focus({ preventScroll: true })
  }, [replay])
  const question = text.trim() || (targets.length > 0 ? GENERIC_QUESTION : '')
  const submit = () => {
    if (replay || !question) return
    useUi.getState().setAskTargets([])
    controller.ask({ question, targets })
  }
  const setTargets = (ids: string[]) => useUi.getState().setAskTargets(ids)
  return (
    <form
      ref={box} tabIndex={-1} className="card interrupt-box" aria-label="Ask the tutor"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <h3>Your hand is up</h3>
      <label htmlFor={`${id}-q`}>Your question</label>
      <textarea
        id={`${id}-q`} ref={area} rows={3} maxLength={QUESTION_MAX} value={text} disabled={replay}
        aria-describedby={replay ? `${id}-why` : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      {replay ? <p id={`${id}-why`} className="helper">{TYPED_REASON}</p> : null}
      {targets.length > 0 ? (
        <ul className="chips" aria-label="Asking about">
          {targets.map((t) => {
            const label = chipLabel(t, index)
            return (
              <li key={t} className="chip chip-target">
                <span>{label}</span>
                <button type="button" aria-label={`Remove ${label}`} onClick={() => setTargets(targets.filter((x) => x !== t))}>×</button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <SuggestedChips
        asks={asks}
        onAsk={(a) => { useUi.getState().setAskTargets([]); controller.ask({ question: a.text, targets, askId: a.id }) }}
      />
      <div className="btn-row">
        <button type="submit" className="primary" disabled={replay || !question}>Ask</button>
        <button type="button" onClick={() => { setTargets([]); dispatch({ type: 'interrupt/close', outcome: 'cancel' }) }}>Cancel</button>
      </div>
    </form>
  )
}
