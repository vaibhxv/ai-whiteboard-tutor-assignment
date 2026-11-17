import { useEffect, useMemo, useRef, useState } from 'react'
import type { Action } from '../actions'
import { Board } from '../board/Board'
import type { Page, Viewport } from '../layout/types'

const noop = () => {}

/** Read-only review of a completed segment: its pages, fully drawn, no animation (the lesson cursor stays put). */
export function ReviewView({ title, pages, index, viewport, maxHeight, onBack }: {
  title: string; pages: Page[]; index: ReadonlyMap<string, Action>; viewport: Viewport; maxHeight?: number; onBack(): void
}) {
  const [at, setAt] = useState(0)
  const i = Math.min(at, Math.max(0, pages.length - 1))
  const visible = useMemo(() => new Set(pages.flatMap((p) => p.beatIds)), [pages])
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [title])
  return (
    <section className="review" aria-label={`Review: ${title}`}>
      <div className="review-bar">
        <h3 ref={heading} tabIndex={-1}>Review: {title}</h3>
        {pages.length > 1 ? (
          <span className="review-pages">
            <button type="button" disabled={i === 0} onClick={() => setAt(i - 1)}>Previous page</button>
            <span>Page {i + 1} of {pages.length}</span>
            <button type="button" disabled={i >= pages.length - 1} onClick={() => setAt(i + 1)}>Next page</button>
          </span>
        ) : null}
        <button type="button" onClick={onBack}>Back to lesson</button>
      </div>
      {pages.length > 0 ? (
        <div className="board-card">
          <Board pages={pages} pageIndex={i} visibleBeats={visible} speed={1} index={index} viewport={viewport} maxHeight={maxHeight} onSelect={noop} />
        </div>
      ) : (
        <p className="helper">Nothing was drawn in this part.</p>
      )}
    </section>
  )
}
