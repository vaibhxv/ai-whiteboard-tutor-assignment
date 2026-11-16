/** Format a number for display: unicode minus, at most 3 decimals, no trailing zeros. */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const s = n.toFixed(3).replace(/\.?0+$/, '')
  const t = s === '-0' || s === '' ? '0' : s
  return t.replace('-', '−')
}
