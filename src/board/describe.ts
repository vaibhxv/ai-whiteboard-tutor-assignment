import type { Action } from '../actions'
import { fmtNum } from '../maths/format'

const pt = (p: [number, number]) => `(${fmtNum(p[0])}, ${fmtNum(p[1])})`
const withCoords = (label: string | undefined, p: [number, number]) =>
  label === undefined || label === '' ? pt(p) : label.includes('(') ? label : `${label} ${pt(p)}`

function describePlot(a: Extract<Action, { t: 'plot' }>, index: ReadonlyMap<string, Action>): string {
  const fns = a.fns.map((f) => f.label ?? `y = ${f.expr}`).join(' and ')
  const head = `Graph of ${fns === '' ? 'axes' : fns} from x = ${fmtNum(a.x[0])} to ${fmtNum(a.x[1])}.`
  const pts = [...index.values()].filter((p): p is Extract<Action, { t: 'point' }> => p.t === 'point' && p.plot === a.id)
  return pts.length === 0 ? head : `${head} Marked points: ${pts.map((p) => withCoords(p.label, p.at)).join(', ')}.`
}

/** Short screen-reader text for any action (model text is used as plain strings only). */
export function describeAction(a: Action, index: ReadonlyMap<string, Action>): string {
  switch (a.t) {
    case 'say': return `Spoken: ${a.text}`
    case 'page': return a.title ? `New page: ${a.title}` : 'New page'
    case 'write': return a.text
    case 'math': return `Equation: ${a.latex}`
    case 'step': return `Step: ${a.latex}. ${a.why}`
    case 'solutions': return `Solutions for ${a.var}: ${a.values.length === 0 ? 'none' : a.values.map(fmtNum).join(', ')}`
    case 'plot': return describePlot(a, index)
    case 'point': return `Point ${withCoords(a.label, a.at)}`
    case 'line': return `Line from ${pt(a.from)} to ${pt(a.to)}${a.label ? `, ${a.label}` : ''}`
    case 'guide': {
      const where = [a.x !== undefined ? `x = ${fmtNum(a.x)}` : '', a.y !== undefined ? `y = ${fmtNum(a.y)}` : '']
        .filter(Boolean).join(' and ')
      return `Guide line at ${where || 'the axes'}${a.label ? `, ${a.label}` : ''}`
    }
    case 'numberline': {
      const marks = a.marks.map((m) => (m.label ? `${m.label} at ${fmtNum(m.at)}` : fmtNum(m.at)))
      return `Number line from ${fmtNum(a.range[0])} to ${fmtNum(a.range[1])}${marks.length ? `. Marked: ${marks.join(', ')}` : ''}.`
    }
    case 'table': return `Table with columns ${a.head.join(', ')} and ${a.rows.length} rows`
    case 'mark': {
      const target = index.get(a.target)
      const what = target ? describeAction(target, index) : 'an element'
      const verb = { circle: 'Circle around', box: 'Box around', underline: 'Underline under', arrow: 'Arrow pointing at' }[a.kind]
      return `${verb} ${what}${a.note ? `. Note: ${a.note}` : ''}`
    }
    case 'explore': return `Interactive graph of y = ${a.expr}. ${a.prompt} Adjust ${a.params.map((p) => p.name).join(' and ')}.`
    case 'check': return `Question: ${a.prompt}`
    case 'ask': return `Question for you: ${a.text}`
  }
}
