import type { CheckAction } from '../../actions'

type C = Extract<CheckAction, { kind: 'choice' }>

/** Radio group. Never marks the correct option, before or after a wrong answer. */
export function Choice({ check, value, onChange, disabled }: {
  check: C; value?: string; onChange(id: string): void; disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={check.prompt} className="cp-options">
      {check.options.map((o) => (
        <label key={o.id} className="cp-option">
          <input type="radio" name={check.id} value={o.id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
          <span>{o.text}</span>
        </label>
      ))}
    </div>
  )
}
