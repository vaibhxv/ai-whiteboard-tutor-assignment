import { useEffect, useRef, useState } from 'react'
import type { CheckAction } from '../actions'
import type { CheckGrade } from '../lesson/events'
import type { CheckRecord } from '../lesson/types'
import { gradeCheck, isRateCheck } from './grade-check'
import type { CheckResponse, RateValue } from './grade-check'
import { Choice } from './inputs/Choice'
import { ExprIn } from './inputs/ExprIn'
import { NumberIn } from './inputs/NumberIn'
import { Rate } from './inputs/Rate'
import { SetIn } from './inputs/SetIn'
import { Tap } from './inputs/Tap'

export type CheckpointProps = {
  check: CheckAction
  record?: CheckRecord
  /** Tap mode: the board element currently selected inside `check.figure`, if any. */
  selectedInFigure?: string
  /** Set mode: the live value of `check.param`. */
  paramValue?: number
  onAnswer(grade: CheckGrade): void
  onUnsure(): void
  onSkip(): void
  onReplaySegment(): void
  onContinue(): void
}

export const FIRST_WRONG = "Not quite. Let's look at it another way."
export const SECOND_WRONG = "Let's work through it together."

export function Checkpoint(p: CheckpointProps) {
  const { check, record } = p
  const rate = isRateCheck(check)
  const [text, setText] = useState('')
  const [choice, setChoice] = useState<string | undefined>()
  const [grade, setGrade] = useState<CheckGrade | undefined>()
  const [wrongs, setWrongs] = useState(0)
  const [invalid, setInvalid] = useState<string | undefined>()
  const [hint, setHint] = useState(false)
  const [done, setDone] = useState(false) // Continue pressed: feedback hidden
  const lastKey = useRef<string | undefined>(undefined) // synchronous double-submit guard
  const [sentKey, setSentKey] = useState<string | undefined>()
  const fb = useRef<HTMLDivElement>(null)

  const answered = grade?.result === 'correct'
  useEffect(() => {
    if (grade || invalid) fb.current?.focus()
  }, [grade, invalid, wrongs])

  const unlock = () => { setInvalid(undefined); if (grade?.result === 'wrong') setGrade(undefined) }

  const submit = (resp: CheckResponse) => {
    const key = JSON.stringify(resp)
    if (lastKey.current === key) return
    const g = gradeCheck(check, resp)
    if (g.result === 'invalid') {
      setInvalid(g.message)
      return
    }
    lastKey.current = key
    setSentKey(key)
    setInvalid(undefined)
    setGrade(g)
    if (g.result === 'wrong') setWrongs((n) => n + 1)
    p.onAnswer(g)
  }

  const current = (): CheckResponse | undefined => {
    switch (check.kind) {
      case 'choice': return choice === undefined ? undefined : { kind: 'choice', optionId: choice }
      case 'number': case 'expr': return { kind: check.kind, text }
      case 'tap': return p.selectedInFigure ? { kind: 'tap', elementId: p.selectedInFigure } : undefined
      case 'set': return p.paramValue === undefined ? undefined : { kind: 'set', value: p.paramValue }
    }
  }
  const resp = current()
  const ready = !rate && resp !== undefined && !(check.kind !== 'choice' && check.kind !== 'tap' && check.kind !== 'set' && text.trim() === '')
  const respKey = resp === undefined ? undefined : JSON.stringify(resp)
  const submitDisabled = !ready || answered || (respKey !== undefined && respKey === sentKey)
  // Any change to the response releases the same-answer guard (B, A, B must work); a held Enter or double click
  // with nothing changed stays blocked by lastKey/sentKey.
  useEffect(() => {
    if (respKey !== sentKey) { lastKey.current = undefined; setSentKey(undefined) }
  }, [respKey, sentKey])

  const doSubmit = () => { if (resp && !submitDisabled) submit(resp) }

  const attempts = Math.max(record?.attempts ?? 0, wrongs)
  let feedback: React.ReactNode = null
  if (invalid) feedback = <><span aria-hidden="true">⚠ </span>{invalid}</>
  else if (grade && !done) {
    if (rate) feedback = check.explain
    else if (grade.result === 'correct') feedback = <><span aria-hidden="true">✓ </span>Correct — {check.explain}</>
    else feedback = <><span aria-hidden="true">✗ </span>{attempts >= 2 ? SECOND_WRONG : FIRST_WRONG}</>
  }

  const inputsOff = answered || done
  return (
    <section className="checkpoint" aria-label="Checkpoint">
      <p className="cp-prompt">{check.prompt}</p>
      {rate ? (
        <Rate check={check as Extract<CheckAction, { kind: 'choice' }>} disabled={!!grade}
          onRate={(v: RateValue) => submit({ kind: 'rate', value: v })} />
      ) : null}
      {!rate && check.kind === 'choice' ? (
        <Choice check={check} value={choice} disabled={inputsOff} onChange={(id) => { setChoice(id); unlock() }} />
      ) : null}
      {check.kind === 'number' ? (
        <NumberIn label="Your answer" value={text} disabled={inputsOff} onEnter={doSubmit} onChange={(v) => { setText(v); unlock() }} />
      ) : null}
      {check.kind === 'expr' ? (
        <ExprIn label={`Your answer, in ${check.variable}`} value={text} disabled={inputsOff} onEnter={doSubmit} onChange={(v) => { setText(v); unlock() }} />
      ) : null}
      {check.kind === 'tap' ? <Tap selected={p.selectedInFigure} /> : null}
      {check.kind === 'set' ? <SetIn param={check.param} value={p.paramValue} /> : null}

      <div ref={fb} className="cp-feedback" role="status" aria-live="polite" tabIndex={-1} data-result={invalid ? 'invalid' : grade?.result}>
        {feedback}
      </div>
      {hint && !rate ? <p className="cp-hint">Hint: {check.hint}</p> : null}

      {!rate && !ready && (check.kind === 'number' || check.kind === 'expr') && text.trim() === '' ? (
        <p className="cp-empty" id={`${check.id}-empty`}>Type your answer first</p>
      ) : null}
      <div className="cp-actions">
        {!rate ? <button type="button" onClick={doSubmit} disabled={submitDisabled}>Check</button> : null}
        {(answered || (rate && grade)) && !done ? (
          <button type="button" onClick={() => { setDone(true); p.onContinue() }}>Continue</button>
        ) : null}
        {!rate ? (
          <button type="button" onClick={() => { setHint(true); p.onUnsure() }}>I'm not sure</button>
        ) : null}
        <button type="button" onClick={p.onReplaySegment}>Replay this part</button>
        <button type="button" onClick={p.onSkip}>Skip</button>
      </div>
    </section>
  )
}
