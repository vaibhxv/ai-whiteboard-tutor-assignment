import { useEffect, useRef } from 'react'
import type { SourceErrorData } from '../lesson/types'
import { errorCopy } from '../sources/errors'
import type { ErrorKind } from '../sources/errors'

/** Kinds whose fix is in Settings rather than trying again. */
const SETTINGS_FIX: readonly ErrorKind[] = ['invalid-key', 'cli-missing', 'usage-limit', 'not-recorded']

export type ProblemProps = {
  error: SourceErrorData
  onRetry(): void
  onSettings(): void
  onHome(): void
}

/** The Problem overlay (FRD §6): plain-words copy for the error kind, a next step, and always Go home. */
export function ProblemOverlay({ error, onRetry, onSettings, onHome }: ProblemProps) {
  const copy = errorCopy(error.kind) ?? errorCopy('unknown')
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus() }, [error.kind])
  const toSettings = SETTINGS_FIX.includes(error.kind)
  return (
    <div className="overlay-backdrop">
      <div className="problem" role="alertdialog" aria-modal="true" aria-labelledby="problem-title" aria-describedby="problem-body">
        <h3 id="problem-title">{copy.title}</h3>
        <p id="problem-body">{copy.body}</p>
        <div className="problem-actions">
          {toSettings ? (
            <button ref={first} type="button" onClick={onSettings}>{copy.action}</button>
          ) : (
            <button ref={first} type="button" onClick={onRetry}>{copy.action}</button>
          )}
          {error.kind === 'cli-signed-out' ? <button type="button" onClick={onSettings}>Open settings</button> : null}
          <button type="button" onClick={onHome}>Go home</button>
        </div>
      </div>
    </div>
  )
}
