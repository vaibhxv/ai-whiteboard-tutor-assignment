export function NumberIn({ label, value, onChange, disabled, onEnter }: {
  label: string; value: string; onChange(v: string): void; disabled?: boolean; onEnter(): void
}) {
  return (
    <input
      className="cp-text" type="text" inputMode="decimal" autoComplete="off" aria-label={label}
      value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }}
    />
  )
}
