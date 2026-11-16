import { all, create, type FactoryFunctionMap, type MathNode } from 'mathjs'

export type { MathNode }

export type Parsed =
  | { kind: 'expr'; node: MathNode; vars: string[] }
  | { kind: 'equation'; sides: MathNode[]; vars: string[] }

const MAX_CHARS = 200
const MAX_NODES = 200
const FUNCTIONS = new Set(['sqrt', 'abs', 'sin', 'cos', 'tan', 'exp', 'log', 'log10'])
const BINARY_OPS = new Set(['+', '-', '*', '/', '^'])

// Own instance. Capture what we need BEFORE disabling the dangerous entry points
// (mathjs security guidance), then neutralise them on this instance.
const math = create(all as FactoryFunctionMap)
const rawParse = math.parse.bind(math)
const { OperatorNode, SymbolNode } = math
const disabled = () => {
  throw new Error('Function is disabled')
}
math.import(
  {
    import: disabled,
    createUnit: disabled,
    evaluate: disabled,
    parse: disabled,
    simplify: disabled,
    derivative: disabled,
    resolve: disabled,
  },
  { override: true },
)

export function normalizeInput(src: string): string {
  let s = src
    .replace(/[−–]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\bln\s*\(/gi, 'log(')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.endsWith('=')) s = s.slice(0, -1).trim()
  return s
}

const isVarName = (name: string) => /^[a-z]$/.test(name) && name !== 'e'

/** Rewrite `x(x+1)` (parsed as a call) into implicit multiplication. f, g, h stay function-like and are rejected. */
function fixImplicitCalls(node: MathNode): MathNode {
  return node.transform((n: MathNode) => {
    if (n.type === 'FunctionNode') {
      const f = n as unknown as { fn: MathNode; args: MathNode[] }
      const name = f.fn.type === 'SymbolNode' ? (f.fn as unknown as { name: string }).name : ''
      if (isVarName(name) && !'fgh'.includes(name) && f.args.length === 1 && f.args[0]) {
        return new OperatorNode('*', 'multiply', [new SymbolNode(name), fixImplicitCalls(f.args[0])], true)
      }
    }
    return n
  })
}

/** Throws if the tree contains anything outside the allow-list. Returns variable names found. */
function validate(root: MathNode): Set<string> {
  const vars = new Set<string>()
  let count = 0
  const visit = (n: MathNode, isCallee = false): void => {
    if (++count > MAX_NODES) throw new Error('That expression is too big')
    const any = n as unknown as Record<string, unknown>
    switch (n.type) {
      case 'ConstantNode':
        if (typeof any.value !== 'number') throw new Error('Only numbers are allowed')
        return
      case 'SymbolNode': {
        const name = any.name as string
        if (isCallee) {
          if (!FUNCTIONS.has(name)) throw new Error(`Unknown function ${name}`)
        } else if (isVarName(name)) vars.add(name)
        else if (name !== 'e' && name !== 'pi') throw new Error(`Unknown symbol ${name}`)
        return
      }
      case 'ParenthesisNode':
        visit(any.content as MathNode)
        return
      case 'OperatorNode': {
        const args = any.args as MathNode[]
        const op = any.op as string
        const okUnary = args.length === 1 && op === '-'
        const okBinary = args.length === 2 && BINARY_OPS.has(op)
        if (!okUnary && !okBinary) throw new Error(`Operator ${op} is not allowed`)
        args.forEach((a) => visit(a))
        return
      }
      case 'FunctionNode': {
        const fn = any.fn as MathNode
        const args = any.args as MathNode[]
        if (fn.type !== 'SymbolNode' || args.length !== 1) throw new Error('Function call not allowed')
        visit(fn, true)
        args.forEach((a) => visit(a))
        return
      }
      default:
        throw new Error(`${n.type} is not allowed`)
    }
  }
  visit(root)
  return vars
}

export function parseMath(src: string): { ok: true; value: Parsed } | { ok: false; error: string } {
  try {
    const s = normalizeInput(src)
    if (s.length === 0) return { ok: false, error: 'Empty input' }
    if (s.length > MAX_CHARS) return { ok: false, error: 'That is too long' }
    const parts = s.split('=')
    if (parts.some((p) => p.trim() === '')) return { ok: false, error: 'Each side of = needs something on it' }
    const vars = new Set<string>()
    const nodes = parts.map((p) => {
      const node = fixImplicitCalls(rawParse(p))
      validate(node).forEach((v) => vars.add(v))
      return node
    })
    const sorted = [...vars].sort()
    if (nodes.length === 1 && nodes[0]) return { ok: true, value: { kind: 'expr', node: nodes[0], vars: sorted } }
    return { ok: true, value: { kind: 'equation', sides: nodes, vars: sorted } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not parse' }
  }
}

/** Compile an allow-listed node. Non-number, complex or non-finite results become NaN. */
export function compile(node: MathNode): (scope: Record<string, number>) => number {
  const code = node.compile()
  return (scope) => {
    try {
      const r: unknown = code.evaluate({ ...scope })
      return typeof r === 'number' && Number.isFinite(r) ? r : NaN
    } catch {
      return NaN
    }
  }
}
