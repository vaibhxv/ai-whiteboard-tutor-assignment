import type { Expr } from '../actions'
import { exprEquivalent } from './equivalence'
import { compile, normalizeInput, parseMath } from './safe'

export type Grade = { result: 'correct' | 'wrong' } | { result: 'invalid'; message: string }

const NUMBER_HELP = 'I couldn’t read that — try a number like 3 or −2.5'
const EXPR_HELP = 'I couldn’t read that — try writing it like 2x + 3'

const invalid = (message: string): Grade => ({ result: 'invalid', message })

function evalConstant(src: string): number {
  const p = parseMath(src)
  if (!p.ok || p.value.kind !== 'expr' || p.value.vars.length > 0) return NaN
  return compile(p.value.node)({})
}

export function gradeNumber(input: string, answer: Expr, tolerance?: number): Grade {
  let s = normalizeInput(input)
  const m = /^[a-z]\s*=\s*(.+)$/.exec(s)
  if (m && m[1] !== undefined) s = m[1]
  if (s === '') return invalid(NUMBER_HELP)
  const value = evalConstant(s)
  if (Number.isNaN(value)) return invalid(NUMBER_HELP)
  const target = evalConstant(answer)
  if (Number.isNaN(target)) return invalid('I couldn’t check that one')
  const tol = tolerance ?? Math.max(1e-9, 1e-3 * Math.abs(target))
  return { result: Math.abs(value - target) <= tol ? 'correct' : 'wrong' }
}

export function gradeExpr(input: string, answer: Expr): Grade {
  const a = parseMath(input)
  if (!a.ok || a.value.kind !== 'expr') return invalid(EXPR_HELP)
  const b = parseMath(answer)
  if (!b.ok || b.value.kind !== 'expr') return invalid('I couldn’t check that one')
  const v = exprEquivalent(a.value.node, b.value.node)
  if (v.verdict === 'equal') return { result: 'correct' }
  if (v.verdict === 'different') return { result: 'wrong' }
  return invalid(EXPR_HELP)
}
