const STEPS = 4000
const POLE = 1e6

function golden(g: (x: number) => number, a: number, b: number): number {
  const phi = (Math.sqrt(5) - 1) / 2
  let c = b - phi * (b - a)
  let d = a + phi * (b - a)
  let gc = g(c)
  let gd = g(d)
  for (let i = 0; i < 200 && b - a > 1e-13; i++) {
    if (gc < gd) {
      b = d
      d = c
      gd = gc
      c = b - phi * (b - a)
      gc = g(c)
    } else {
      a = c
      c = d
      gc = gd
      d = a + phi * (b - a)
      gd = g(d)
    }
  }
  return (a + b) / 2
}

export function findRealRoots(f: (x: number) => number, lo = -50, hi = 50): number[] {
  const safe = (x: number) => {
    try {
      const y = f(x)
      return Number.isFinite(y) ? y : NaN
    } catch {
      return NaN
    }
  }
  const h = (hi - lo) / STEPS
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= STEPS; i++) {
    const x = i === STEPS ? hi : lo + i * h
    xs.push(x)
    ys.push(safe(x))
  }
  const roots: number[] = []
  const at = (i: number) => ys[i] as number
  for (let i = 0; i <= STEPS; i++) {
    const y = at(i)
    if (y === 0) {
      roots.push(xs[i] as number)
      continue
    }
    if (i === 0 || Number.isNaN(y)) continue
    const p = at(i - 1)
    if (Number.isNaN(p) || p === 0) continue
    if (p * y < 0) {
      if (Math.abs(p) > POLE || Math.abs(y) > POLE) continue
      let a = xs[i - 1] as number
      let b = xs[i] as number
      let fa = p
      for (let k = 0; k < 200 && b - a > 1e-13; k++) {
        const m = (a + b) / 2
        const fm = safe(m)
        if (Number.isNaN(fm)) break
        if (fm === 0) {
          a = b = m
          break
        }
        if (fa * fm < 0) b = m
        else {
          a = m
          fa = fm
        }
      }
      const r = (a + b) / 2
      const fr = safe(r)
      // a jump (tan, 1/x) leaves a large residual: not a root
      if (Math.abs(fr) < 1e-6) roots.push(r)
    }
  }
  // double roots: local minima of |f| that touch zero without a sign change
  const absf = (x: number) => {
    const y = safe(x)
    return Number.isNaN(y) ? Infinity : Math.abs(y)
  }
  for (let i = 1; i < STEPS; i++) {
    const p = at(i - 1)
    const y = at(i)
    const n = at(i + 1)
    if (Number.isNaN(p) || Number.isNaN(y) || Number.isNaN(n) || y === 0) continue
    if (p * n <= 0) continue
    if (Math.abs(y) <= Math.abs(p) && Math.abs(y) <= Math.abs(n)) {
      const x = golden(absf, xs[i - 1] as number, xs[i + 1] as number)
      if (absf(x) < 1e-9) roots.push(x)
    }
  }
  roots.sort((a, b) => a - b)
  const out: number[] = []
  for (const r of roots) {
    const last = out[out.length - 1]
    if (last === undefined || Math.abs(r - last) > 1e-6) out.push(r)
  }
  return out
}
