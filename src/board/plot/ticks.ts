/** Round-valued tick positions covering [min, max], about `target` of them. */
export function niceTicks(min: number, max: number, target = 8): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return []
  const raw = (max - min) / Math.max(1, target)
  const exp = Math.floor(Math.log10(raw))
  const base = 10 ** exp
  const m = raw / base
  const step = (m <= 1.5 ? 1 : m <= 3 ? 2 : m <= 7 ? 5 : 10) * base
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  const first = Math.ceil(min / step - 1e-9)
  const last = Math.floor(max / step + 1e-9)
  const ticks: number[] = []
  for (let i = first; i <= last; i++) ticks.push(Number((i * step).toFixed(decimals)) + 0)
  return ticks
}
