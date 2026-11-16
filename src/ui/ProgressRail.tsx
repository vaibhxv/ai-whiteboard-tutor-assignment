import type { LessonState, SegKey } from '../lesson/types'
import { railItems } from './lesson-view'

/**
 * Segment titles in play order. Completed segments open a read-only review; the current one is marked;
 * future ones are plain text (Skip at a checkpoint is the only way forward).
 */
export function ProgressRail({ state, reviewing, onReview }: { state: LessonState; reviewing?: SegKey; onReview(key: SegKey): void }) {
  const items = railItems(state)
  if (items.length === 0) return null
  let n = 0
  const marks = items.map((it) => (it.extra ? '+' : String(++n)))
  return (
    <nav className="rail" aria-label="Lesson progress">
      <ol>
        {items.map((it, i) => (
          <li key={it.key} className={`rail-item is-${it.status}${it.extra ? ' is-extra' : ''}`} aria-current={it.status === 'current' ? 'step' : undefined}>
            {it.status === 'done' && it.key !== 'recap' ? (
              <button type="button" aria-pressed={reviewing === it.key} onClick={() => onReview(it.key as SegKey)}>
                <span className="rail-mark" aria-hidden="true">✓</span>
                <span className="rail-label">{it.label}</span>
                <span className="visually-hidden"> (done, review)</span>
              </button>
            ) : (
              <span className="rail-static">
                <span className="rail-mark" aria-hidden="true">{it.status === 'current' ? '●' : marks[i]}</span>
                <span className="rail-label">{it.label}</span>
                {it.status === 'future' ? <span className="visually-hidden"> (coming up)</span> : null}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
