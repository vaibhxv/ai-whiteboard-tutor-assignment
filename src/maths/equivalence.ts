import { findRealRoots } from './roots'
import { compile, type MathNode, type Parsed } from './safe'

export type Verdict = {
  verdict: 'equal' | 'different' | 'unknown'
  evidence?: { at: Record<string, number>; left: number; right: number }
}

const WANT = 8
const TRIES = 64
const REL = 1e-6

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const close = (a: number, b: number, tol = REL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

function varsOf(...nodes: MathNode[]): string[] {
  const set = new Set<string>()
  const walk = (n: MathNode) => {
    if (n.type === 'SymbolNode') {
      const name = (n as unknown as { name: string }).name
      if (/^[a-z]$/.test(name) && name !== 'e') set.add(name)
    }
    n.forEach((c: MathNode) => walk(c))
  }
  nodes.forEach(walk)
  return [...set].sort()
}

type Sample = { at: Record<string, number>; l: number; r: number }

function sample(vars: string[], fl: (s: Record<string, number>) => number, fr: (s: Record<string, number>) => number, seed: number, accept: (l: number, r: number) => boolean = () => true): Sample[] {
  const rnd = mulberry32(seed)
  const out: Sample[] = []
  for (let i = 0; i < TRIES && out.length < WANT; i++) {
    const at: Record<string, number> = {}
    for (const v of vars) at[v] = rnd() * 20 - 10
    const l = fl(at)
    const r = fr(at)
    if (Number.isFinite(l) && Number.isFinite(r) && accept(l, r)) out.push({ at, l, r })
  }
  return out
}

export function exprEquivalent(a: MathNode, b: MathNode, opts: { seed?: number } = {}): Verdict {
  const fa = compile(a)
  const fb = compile(b)
  const samples = sample(varsOf(a, b), fa, fb, opts.seed ?? 7)
  if (samples.length < WANT) return { verdict: 'unknown' }
  for (const s of samples) {
    if (!close(s.l, s.r)) return { verdict: 'different', evidence: { at: s.at, left: s.l, right: s.r } }
  }
  return { verdict: 'equal' }
}

function sameRoots(r1: number[], r2: number[]): boolean {
  const has = (list: number[], x: number) => list.some((y) => Math.abs(x - y) <= 1e-5)
  return r1.every((x) => has(r2, x)) && r2.every((x) => has(r1, x))
}

export function equationsEquivalent(a: Parsed, b: Parsed, opts: { seed?: number } = {}): Verdict {
  if (a.kind !== 'equation' || b.kind !== 'equation') return { verdict: 'unknown' }
  if (a.sides.length !== 2 || b.sides.length !== 2) return { verdict: 'unknown' }
  const [al, ar] = a.sides as [MathNode, MathNode]
  const [bl, br] = b.sides as [MathNode, MathNode]
  const ca = compile(al)
  const cb = compile(ar)
  const cc = compile(bl)
  const cd = compile(br)
  const f1 = (s: Record<string, number>) => ca(s) - cb(s)
  const f2 = (s: Record<string, number>) => cc(s) - cd(s)

  if (a.vars.length === 1 && b.vars.length === 1) {
    const va = a.vars[0] as string
    const vb = b.vars[0] as string
    if (va !== vb) return { verdict: 'different' }
    const r1 = findRealRoots((x) => f1({ [va]: x }))
    const r2 = findRealRoots((x) => f2({ [va]: x }))
    if (r1.length === 0 && r2.length === 0) return { verdict: 'unknown' }
    return sameRoots(r1, r2) ? { verdict: 'equal' } : { verdict: 'different' }
  }

  const vars = [...new Set([...a.vars, ...b.vars])].sort()
  const samples = sample(vars, f1, f2, opts.seed ?? 7, (_l, r) => Math.abs(r) > 1e-9)
  if (samples.length < WANT) return { verdict: 'unknown' }
  const first = samples[0] as Sample
  const k = first.l / first.r
  for (const s of samples) {
    const ratio = s.l / s.r
    if (Math.abs(k) < 1e-9 || !close(ratio, k)) {
      return { verdict: 'different', evidence: { at: s.at, left: s.l, right: s.r } }
    }
  }
  return { verdict: 'equal' }
}
