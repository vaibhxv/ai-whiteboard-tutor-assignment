import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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

/**
 * Everything else on the page is made `inert` while the problem is open, so focus and clicks stay in the
 * dialog (restored on close). Escape does nothing: every way out is an explicit choice.
 */
function useInertSiblings(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const me = ref.current
    if (!me?.parentElement) return
    const made: Element[] = []
    for (const el of Array.from(me.parentElement.children)) {
      if (el === me || el.hasAttribute('inert')) continue
      el.setAttribute('inert', '')
      made.push(el)
    }
    return () => { for (const el of made) el.removeAttribute('inert') }
  }, [ref])
}

/** The Problem overlay (FRD §6): plain-words copy for the error kind, a next step, and always Go home. */
export function ProblemOverlay({ error, onRetry, onSettings, onHome }: ProblemProps) {
  const copy = errorCopy(error.kind) ?? errorCopy('unknown')
  const first = useRef<HTMLButtonElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  useInertSiblings(backdrop)
  useEffect(() => { first.current?.focus() }, [error.kind])
  const toSettings = SETTINGS_FIX.includes(error.kind)
  return createPortal(
    <div className="overlay-backdrop" ref={backdrop}>
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
    </div>,
    document.body,
  )
}
