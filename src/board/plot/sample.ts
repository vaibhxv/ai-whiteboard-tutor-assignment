/**
 * SVG path `d` for y = f(x) over `x`, sampled at `n` points. Never contains NaN.
 * - A non-finite value lifts the pen (the next finite sample starts a new `M`).
 * - Two consecutive samples that lie more than one y-span outside the y range on opposite sides
 *   are an asymptote: the pen lifts instead of drawing a vertical spike.
 * - Every other value is clamped to the y range ± 1 span (the Plot clips to its area).
 */
export function samplePath(
  f: (x: number) => number,
  x: [number, number],
  y: [number, number],
  toPx: (p: [number, number]) => [number, number],
  n = 480,
): string {
  const span = y[1] - y[0]
  const lo = y[0] - span
  const hi = y[1] + span
  const out: string[] = []
  let pen = false
  let prev: number | undefined
  for (let i = 0; i <= n; i++) {
    const xv = x[0] + ((x[1] - x[0]) * i) / n
    const v = f(xv)
    if (!Number.isFinite(v)) {
      pen = false
      prev = undefined
      continue
    }
    if (pen && prev !== undefined && ((prev > hi && v < lo) || (prev < lo && v > hi))) pen = false
    prev = v
    const [px, py] = toPx([xv, Math.min(Math.max(v, lo), hi)])
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      pen = false
      continue
    }
    out.push(`${pen ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`)
    pen = true
  }
  return out.join('')
}
