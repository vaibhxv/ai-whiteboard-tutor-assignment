import type { Action } from '../actions'
import { close, equationsEquivalent, exprEquivalent, type Verdict } from './equivalence'
import { fmtNum } from './format'
import { findRealRoots } from './roots'
import { compile, parseMath, type MathNode, type Parsed } from './safe'

export type Verification = { status: 'pass' | 'fail' | 'unchecked'; evidence?: string }
export type Checked<A extends Action = Action> = A & { verify: Verification }
export interface VerifyContext {
  index: ReadonlyMap<string, Action>
  lastMathId?: string
}

const PASS: Verification = { status: 'pass' }
const UNCHECKED: Verification = { status: 'unchecked' }
const fail = (evidence: string): Verification => ({ status: 'fail', evidence })
const num = fmtNum

type Expr = Extract<Parsed, { kind: 'expr' }>
type Equation = Extract<Parsed, { kind: 'equation' }>

function parse(src: string): Parsed | undefined {
  const p = parseMath(src)
  return p.ok ? p.value : undefined
}

function atText(at: Record<string, number>): string {
  const keys = Object.keys(at)
  return keys.length === 0 ? '' : `at ${keys.map((k) => `${k} = ${num(at[k] as number)}`).join(', ')} `
}

/** Compile a one-variable expression to f(x); constants ignore the argument. */
function fnOf(node: MathNode, v = 'x'): (x: number) => number {
  const f = compile(node)
  return (x) => f({ [v]: x })
}

function constantValue(src: string): number {
  const p = parse(src)
  if (!p || p.kind !== 'expr' || p.vars.length > 0) return NaN
  return compile(p.node)({})
}

const isLoneVariable = (n: MathNode) => n.type === 'SymbolNode'
function isZero(n: MathNode, vars: string[]): boolean {
  return vars.length === 0 && compile(n)({}) === 0
}

function sideVars(n: MathNode): number {
  let count = 0
  const walk = (m: MathNode) => {
    if (m.type === 'SymbolNode' && /^[a-z]$/.test((m as unknown as { name: string }).name) && (m as unknown as { name: string }).name !== 'e') count++
    m.forEach((c: MathNode) => walk(c))
  }
  walk(n)
  return count
}

function compareSides(a: MathNode, b: MathNode): Verdict {
  if (sideVars(a) === 0 && sideVars(b) === 0) {
    const l = compile(a)({})
    const r = compile(b)({})
    if (Number.isNaN(l) || Number.isNaN(r)) return { verdict: 'unknown' }
    return close(l, r) ? { verdict: 'equal' } : { verdict: 'different', evidence: { at: {}, left: l, right: r } }
  }
  return exprEquivalent(a, b)
}

function verifyMath(a: Extract<Action, { t: 'math' }>): Verification {
  if (!a.expr) return UNCHECKED
  const p = parse(a.expr)
  if (!p) return fail(`I couldn't read the maths "${a.expr}"`)
  if (p.kind !== 'equation') return UNCHECKED
  const sides = p.sides
  if (sides.length === 2) {
    const [l, r] = sides as [MathNode, MathNode]
    const constant = sideVars(l) === 0 && sideVars(r) === 0
    if (!constant && (isLoneVariable(l) || isLoneVariable(r) || isZero(l, p.vars) || isZero(r, p.vars))) return UNCHECKED
    const v = compareSides(l, r)
    if (v.verdict === 'equal') return PASS
    if (constant && v.verdict === 'different' && v.evidence) {
      return fail(`the left side is ${num(v.evidence.left)} and the right side is ${num(v.evidence.right)}`)
    }
    return UNCHECKED
  }
  let unknown = false
  for (let i = 0; i + 1 < sides.length; i++) {
    const v = compareSides(sides[i] as MathNode, sides[i + 1] as MathNode)
    if (v.verdict === 'different') {
      const e = v.evidence
      return fail(
        e
          ? `${atText(e.at)}part ${i + 1} is ${num(e.left)} but part ${i + 2} is ${num(e.right)}`
          : `part ${i + 1} and part ${i + 2} are not equal`,
      )
    }
    if (v.verdict === 'unknown') unknown = true
  }
  return unknown ? UNCHECKED : PASS
}

const exprOf = (a: Action | undefined): string | undefined =>
  a && (a.t === 'math' || a.t === 'step') ? a.expr : undefined

function verifyStep(a: Extract<Action, { t: 'step' }>, ctx: VerifyContext): Verification {
  const fromId = a.from ?? ctx.lastMathId
  if (!fromId) return UNCHECKED
  const src = exprOf(ctx.index.get(fromId))
  if (!src) return UNCHECKED
  const prev = parse(src)
  if (!prev) return UNCHECKED
  const next = parse(a.expr)
  if (!next) return fail(`I couldn't read the maths "${a.expr}"`)
  if (prev.kind === 'expr' && next.kind === 'expr') {
    const v = exprEquivalent((prev as Expr).node, (next as Expr).node)
    if (v.verdict === 'equal') return PASS
    if (v.verdict === 'different') {
      const e = v.evidence
      return fail(e ? `${atText(e.at)}the line before is ${num(e.left)} but this step is ${num(e.right)}` : 'this step is not equal to the line before')
    }
    return UNCHECKED
  }
  if (prev.kind === 'equation' && next.kind === 'equation') {
    const v = equationsEquivalent(prev, next)
    if (v.verdict === 'equal') return PASS
    if (v.verdict === 'different') {
      const e = v.evidence
      return fail(
        e
          ? `${atText(e.at)}the two equations disagree (${num(e.left)} against ${num(e.right)})`
          : 'this equation does not have the same solutions as the one before',
      )
    }
  }
  return UNCHECKED
}

function equationOf(id: string, ctx: VerifyContext): Equation | undefined {
  const src = exprOf(ctx.index.get(id))
  const p = src ? parse(src) : undefined
  return p && p.kind === 'equation' && p.sides.length === 2 ? p : undefined
}

function verifySolutions(a: Extract<Action, { t: 'solutions' }>, ctx: VerifyContext): Verification {
  const eq = equationOf(a.of, ctx)
  if (!eq || eq.vars.length !== 1 || eq.vars[0] !== a.var) return UNCHECKED
  const [l, r] = eq.sides as [MathNode, MathNode]
  const fl = fnOf(l, a.var)
  const fr = fnOf(r, a.var)
  for (const v of a.values) {
    const lv = fl(v)
    const rv = fr(v)
    if (Number.isNaN(lv) || Number.isNaN(rv)) return fail(`${a.var} = ${num(v)} can't be put into the equation`)
    if (Math.abs(lv - rv) > 1e-6 * Math.max(1, Math.abs(lv), Math.abs(rv))) {
      return fail(`at ${a.var} = ${num(v)} the left side is ${num(lv)} and the right side is ${num(rv)}`)
    }
  }
  const roots = findRealRoots((x) => fl(x) - fr(x))
  const missed = roots.find((root) => !a.values.some((v) => Math.abs(v - root) <= 1e-6 * Math.max(1, Math.abs(root))))
  if (missed !== undefined) return fail(`missed a solution: ${a.var} = ${num(missed)}`)
  return PASS
}

function verifyPoint(a: Extract<Action, { t: 'point' }>, ctx: VerifyContext): Verification {
  const plot = ctx.index.get(a.plot)
  if (!plot || plot.t !== 'plot') return UNCHECKED
  const [px, py] = a.at
  const miss = (expr: string): number | undefined => {
    const p = parse(expr)
    if (!p || p.kind !== 'expr') return undefined
    const y = fnOf(p.node)(px)
    return Number.isNaN(y) ? undefined : y
  }
  const near = (y: number) => Math.abs(y - py) <= 1e-3 * Math.max(1, Math.abs(py))
  if (a.on) {
    const fn = plot.fns.find((f) => f.id === a.on)
    if (!fn) return fail(`the point says it is on "${a.on}", but that curve is not on the plot`)
    const y = miss(fn.expr)
    if (y === undefined) return UNCHECKED
    return near(y) ? PASS : fail(`at x = ${num(px)} the curve is ${num(y)} but the point is at y = ${num(py)}`)
  }
  return plot.fns.some((f) => {
    const y = miss(f.expr)
    return y !== undefined && near(y)
  })
    ? PASS
    : UNCHECKED
}

function verifyTable(a: Extract<Action, { t: 'table' }>): Verification {
  if (!a.fn) return UNCHECKED
  const p = parse(a.fn)
  if (!p || p.kind !== 'expr') return UNCHECKED
  const f = fnOf(p.node)
  for (const [i, row] of a.rows.entries()) {
    if (row.length < 2) continue
    const x = constantValue(row[0] as string)
    const y = constantValue(row[1] as string)
    if (Number.isNaN(x) || Number.isNaN(y)) continue
    const want = f(x)
    if (Number.isNaN(want)) continue
    if (!close(want, y, 1e-3)) return fail(`row ${i + 1}: at x = ${num(x)} the value should be ${num(want)} but the table says ${num(y)}`)
  }
  return PASS
}

type Check = Extract<Action, { t: 'check' }>

function verifyChoice(a: Extract<Check, { kind: 'choice' }>): Verification {
  const correct = a.options.filter((o) => o.correct)
  if (correct.length !== 1) return fail(`exactly one option must be correct, but ${correct.length} are`)
  const seen = new Set<string>()
  for (const o of a.options.filter((o) => !o.correct)) {
    const m = (o.misconception ?? '').trim().toLowerCase()
    if (!m) return fail(`the wrong option "${o.id}" has no misconception`)
    if (seen.has(m)) return fail(`two wrong options share the misconception "${o.misconception}"`)
    seen.add(m)
  }
  const key = correct[0]?.value === undefined ? NaN : constantValue(correct[0].value)
  if (!Number.isNaN(key)) {
    for (const o of a.options) {
      if (o.correct || o.value === undefined) continue
      const v = constantValue(o.value)
      if (!Number.isNaN(v) && close(v, key)) return fail(`the wrong option "${o.id}" has the same value as the correct one`)
    }
  }
  return PASS
}

function verifyNumberCheck(a: Extract<Check, { kind: 'number' }>): Verification {
  const key = constantValue(a.answer)
  if (Number.isNaN(key)) return fail(`I couldn't read the answer "${a.answer}" as a number`)
  for (const an of a.anticipated ?? []) {
    const v = constantValue(an.value)
    if (!Number.isNaN(v) && close(v, key, a.tolerance !== undefined ? Math.max(1e-9, a.tolerance / Math.max(1, Math.abs(key))) : 1e-6)) {
      return fail(`the anticipated wrong answer ${num(v)} equals the correct answer`)
    }
  }
  return PASS
}

function verifyExprCheck(a: Extract<Check, { kind: 'expr' }>): Verification {
  const key = parse(a.answer)
  if (!key || key.kind !== 'expr') return fail(`I couldn't read the answer "${a.answer}"`)
  for (const an of a.anticipated ?? []) {
    const p = parse(an.value)
    if (p && p.kind === 'expr' && exprEquivalent(key.node, p.node).verdict === 'equal') {
      return fail(`the anticipated wrong answer "${an.value}" is equivalent to the correct answer`)
    }
  }
  return PASS
}

function verifyTap(a: Extract<Check, { kind: 'tap' }>, ctx: VerifyContext): Verification {
  const fig = ctx.index.get(a.figure)
  if (!fig) return UNCHECKED
  if (a.answer === a.figure) return PASS
  if (fig.t === 'plot') {
    if (fig.fns.some((f) => f.id === a.answer)) return PASS
    for (const el of ctx.index.values()) {
      if ((el.t === 'point' || el.t === 'line' || el.t === 'guide') && el.plot === a.figure && el.id === a.answer) return PASS
    }
    return fail(`the answer "${a.answer}" is not an element of the figure "${a.figure}"`)
  }
  return UNCHECKED
}

function verifySet(a: Extract<Check, { kind: 'set' }>, ctx: VerifyContext): Verification {
  const ex = ctx.index.get(a.explore)
  if (!ex || ex.t !== 'explore') return UNCHECKED
  const p = ex.params.find((q) => q.name === a.param)
  if (!p) return fail(`the explore figure has no parameter "${a.param}"`)
  const [lo, hi] = a.target
  if (lo < p.min || hi > p.max) return fail(`the target ${num(lo)} to ${num(hi)} is outside the range ${num(p.min)} to ${num(p.max)} for ${a.param}`)
  return PASS
}

function verifyCheck(a: Check, ctx: VerifyContext): Verification {
  switch (a.kind) {
    case 'choice': return verifyChoice(a)
    case 'number': return verifyNumberCheck(a)
    case 'expr': return verifyExprCheck(a)
    case 'tap': return verifyTap(a, ctx)
    case 'set': return verifySet(a, ctx)
  }
}

function verifyExplore(a: Extract<Action, { t: 'explore' }>): Verification {
  for (const p of a.params) {
    if (!/^[a-df-wyz]$/.test(p.name)) return fail(`the parameter name "${p.name}" must be a single letter (not e or x)`)
  }
  const p = parse(a.expr)
  if (!p || p.kind !== 'expr') return fail(`I couldn't read the expression "${a.expr}"`)
  const allowed = new Set(['x', ...a.params.map((q) => q.name)])
  const bad = p.vars.find((v) => !allowed.has(v))
  if (bad) return fail(`the expression uses "${bad}", which is not x or a declared parameter`)
  return PASS
}

export function verifyAction(a: Action, ctx: VerifyContext): Verification {
  switch (a.t) {
    case 'math': return verifyMath(a)
    case 'step': return verifyStep(a, ctx)
    case 'solutions': return verifySolutions(a, ctx)
    case 'point': return verifyPoint(a, ctx)
    case 'table': return verifyTable(a)
    case 'check': return verifyCheck(a, ctx)
    case 'explore': return verifyExplore(a)
    default: return UNCHECKED
  }
}
