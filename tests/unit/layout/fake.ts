import type { Action } from '../../../src/actions'
import type { Box, Measurer, Page, Placed } from '../../../src/layout/types'
import type { Checked } from '../../../src/maths/verify'
import type { Beat } from '../../../src/pipeline/beats'

/** Fake measurer from the brief: text = chars·11 wrapped to maxWidth at 34 px/line; math 48; step 70. */
export const fake: Measurer = {
  measure(a: Action, maxWidth: number) {
    const text = (s: string) => {
      const raw = s.length * 11
      const lines = Math.max(1, Math.ceil(raw / maxWidth))
      return { w: Math.min(raw, maxWidth), h: 34 * lines }
    }
    switch (a.t) {
      case 'write': return text(a.text)
      case 'math':
      case 'solutions': return { w: Math.min(a.latex.length * 11, maxWidth), h: 48 }
      case 'step': return { w: Math.min(a.latex.length * 11, maxWidth), h: 70 }
      case 'table': return { w: Math.min(120 * a.head.length, maxWidth), h: 34 * (a.rows.length + 1) }
      case 'numberline': return { w: maxWidth, h: 80 }
      default: return { w: Math.min(200, maxWidth), h: 48 }
    }
  },
}

export const chk = (a: Action): Checked => ({ ...a, verify: { status: 'unchecked' } }) as Checked
export const beat = (id: string, actions: Action[], say = 'x', ink: 'lesson' | 'answer' = 'lesson'): Beat =>
  ({ id, say, actions: actions.map(chk), ink })

export const w = (id: string, text = `Line ${id} of the explanation`): Action => ({ t: 'write', id, text })
export const m = (id: string, latex = 'x^2 + 1'): Action => ({ t: 'math', id, latex })
export const plot = (id: string): Action => ({ t: 'plot', id, x: [-1, 5], y: [-2, 6], fns: [{ id: `${id}f`, expr: 'x^2' }] })
export const pt = (id: string, p: string, at: [number, number]): Action => ({ t: 'point', id, plot: p, at })
export const mark = (target: string, kind: 'circle' | 'underline' | 'arrow' | 'box' = 'circle'): Action =>
  ({ t: 'mark', kind, target, note: 'look' })

export const inside = (b: Box, o: Box) =>
  b.x >= o.x - 1e-9 && b.y >= o.y - 1e-9 && b.x + b.w <= o.x + o.w + 1e-9 && b.y + b.h <= o.y + o.h + 1e-9
export const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function noOverlap(items: Placed[]): boolean {
  const flow = items.filter((i) => i.region === 'notes' || i.region === 'figure')
  for (let i = 0; i < flow.length; i++)
    for (let j = i + 1; j < flow.length; j++)
      if (intersects((flow[i] as Placed).box, (flow[j] as Placed).box)) return false
  return true
}

export const allItems = (pages: Page[]) => pages.flatMap((p) => p.items)

/** The spike segment (tests/fixtures/streams/spike-sonnet.txt) as beats, check excluded. */
export function spikeBeats(): Beat[] {
  return [
    beat('seg:1#0', [{ t: 'math', id: 'eq1', latex: 'y = x^2 - 4x + 3', expr: 'y=x^2-4*x+3' }]),
    beat('seg:1#1', [{ t: 'math', id: 'fac', latex: 'x^2 - 4x + 3 = (x-1)(x-3) = 0', expr: '(x-1)*(x-3)=0' }]),
    beat('seg:1#2', [
      { t: 'solutions', id: 'roots', of: 'fac', var: 'x', values: [1, 3], latex: 'x = 1 \\quad \\text{or} \\quad x = 3' },
      { t: 'mark', kind: 'underline', target: 'roots', note: 'where the curve meets the x-axis' },
    ]),
    beat('seg:1#3', [
      { t: 'plot', id: 'p1', x: [-1, 5], y: [-2, 6], fns: [{ id: 'f1', expr: 'x^2-4*x+3', label: 'y = x² − 4x + 3' }] },
      { t: 'point', plot: 'p1', id: 'r1', at: [1, 0], label: '(1, 0)' },
      { t: 'point', plot: 'p1', id: 'r2', at: [3, 0], label: '(3, 0)' },
    ]),
    beat('seg:1#4', [{ t: 'math', id: 'axis', latex: 'x = \\frac{1+3}{2} = 2', expr: 'x=(1+3)/2' }]),
    beat('seg:1#5', [
      { t: 'math', id: 'sub', latex: 'y = 2^2 - 4(2) + 3 = 4 - 8 + 3 = -1', expr: '2^2-4*2+3' },
      { t: 'point', plot: 'p1', id: 'v', at: [2, -1], label: 'Vertex (2, −1)' },
      { t: 'mark', kind: 'circle', target: 'v', note: 'lowest point, on the axis x = 2' },
    ]),
    beat('seg:1#6', [], 'So the vertex is (2, −1).'),
  ]
}
