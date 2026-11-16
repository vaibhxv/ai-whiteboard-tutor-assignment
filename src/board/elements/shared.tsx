import { useId } from 'react'
import type { ReactNode } from 'react'
import { renderLatex } from './shared-latex'
import type { Action } from '../../actions'
import type { Checked } from '../../maths/verify'
import type { Placed } from '../../layout/types'

export type ElProps = {
  item: Placed
  index: ReadonlyMap<string, Action>
  selected: boolean
  onSelect(id: string): void
  label: string
}

export function Latex({ latex, className }: { latex: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderLatex(latex) }} />
}

const MATHS = new Set<Action['t']>(['math', 'step', 'solutions'])

/** Verification marks: ✓ when code checked it, a worded warning when it failed, `not checked` for unverified maths. */
export function VerifyBadge({ a, descId }: { a: Checked; descId: string }) {
  const v = a.verify
  if (v.status === 'pass') {
    return <span className="badge badge-ok" role="img" title="Checked by code" aria-label="Checked by code">✓</span>
  }
  if (v.status === 'fail') {
    return (
      <span className="badge badge-warn" title={v.evidence ?? 'This did not check out'} aria-describedby={descId}>
        ⚠ May be wrong
      </span>
    )
  }
  return MATHS.has(a.t) ? <span className="badge badge-muted">not checked</span> : null
}

/** Accessible label for an element: its description plus the verification outcome, in words. */
export function labelWith(a: Checked, text: string): string {
  if (a.verify.status === 'pass') return `${text}. Checked by code.`
  if (a.verify.status === 'fail') return `${text}. May be wrong.`
  return text
}

export function useDescId(): string {
  return `${useId().replace(/:/g, '')}-why`
}

/** Absolutely positioned HTML element root: handles box, focus, selection and the fit scale. */
export function HtmlRoot({
  item, selected, onSelect, label, className, role = 'img', children,
}: ElProps & { className: string; role?: 'img' | 'group'; children: ReactNode }) {
  const { box, fit } = item
  const descId = useDescId()
  const a = item.action
  const failEvidence = a.verify.status === 'fail' ? a.verify.evidence ?? '' : ''
  const body =
    fit !== undefined ? (
      <div className="fit" style={{ width: box.w / fit, height: box.h / fit, transform: `scale(${fit})` }}>{children}</div>
    ) : children
  return (
    <div
      data-el={item.id}
      className={`el ${className} ink-${item.ink}${selected ? ' is-selected' : ''}${item.reprise ? ' is-reprise' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      tabIndex={0}
      role={role}
      aria-label={labelWith(a, label)}
      aria-describedby={failEvidence ? descId : undefined}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(item.id) }}
    >
      {body}
      <VerifyBadge a={a} descId={descId} />
      {failEvidence && <span id={descId} className="sr-only">{failEvidence}</span>}
    </div>
  )
}

/** SVG element root with a focus ring rect (outline on <g> is unreliable). */
export function SvgRoot({
  item, selected, onSelect, label, className, children,
}: ElProps & { className: string; children: ReactNode }) {
  const { box } = item
  return (
    <g
      data-el={item.id}
      className={`el ${className} ink-${item.ink}${selected ? ' is-selected' : ''}`}
      tabIndex={0}
      role="img"
      aria-label={labelWith(item.action, label)}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(item.id) }}
    >
      <rect className="focus-ring" x={box.x - 2} y={box.y - 2} width={box.w + 4} height={box.h + 4} rx={4} />
      {children}
    </g>
  )
}
