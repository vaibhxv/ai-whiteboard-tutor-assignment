import type { CheckAction } from '../../actions'
import type { RateValue } from '../grade-check'

type C = Extract<CheckAction, { kind: 'choice' }>

/** Self-rating: three buttons, answering immediately. */
export function Rate({ check, onRate, disabled }: { check: C; onRate(v: RateValue): void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={check.prompt} className="cp-rate">
      {check.options.map((o) => (
        <button key={o.id} type="button" disabled={disabled} onClick={() => onRate(o.id as RateValue)}>{o.text}</button>
      ))}
    </div>
  )
}
