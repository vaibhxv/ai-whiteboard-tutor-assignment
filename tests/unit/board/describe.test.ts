import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { describeAction } from '../../../src/board/describe'

const plot: Action = { t: 'plot', id: 'p1', x: [-1, 5], y: [-2, 6], fns: [{ id: 'f1', expr: 'x^2-4*x+3', label: 'y = x² − 4x + 3' }] }
const pts: Action[] = [
  { t: 'point', plot: 'p1', id: 'r1', at: [1, 0], label: '(1, 0)' },
  { t: 'point', plot: 'p1', id: 'r2', at: [3, 0], label: '(3, 0)' },
  { t: 'point', plot: 'p1', id: 'v', at: [2, -1], label: 'vertex' },
]
const index = new Map<string, Action>([['p1', plot], ...pts.map((p) => [(p as { id: string }).id, p] as [string, Action])])

describe('describeAction', () => {
  test('describePlot matches FRD L2 exactly', () => {
    expect(describeAction(plot, index)).toBe(
      'Graph of y = x² − 4x + 3 from x = −1 to 5. Marked points: (1, 0), (3, 0), vertex (2, −1).',
    )
  })
  test('covers every action type with non-empty text', () => {
    const all: Action[] = [
      { t: 'say', text: 'hi' }, { t: 'page' }, { t: 'write', id: 'w', text: 'Hello' },
      { t: 'math', id: 'm', latex: 'x^2' }, { t: 'step', id: 's', latex: 'x', expr: 'x', why: 'because' },
      { t: 'solutions', id: 'so', of: 'm', var: 'x', values: [1, 3], latex: 'x=1' },
      plot, ...pts, { t: 'line', id: 'l', plot: 'p1', from: [0, 0], to: [1, 1], label: 'tangent' },
      { t: 'guide', id: 'g', plot: 'p1', x: 2 },
      { t: 'numberline', id: 'n', range: [0, 5], marks: [{ at: 2, label: 'two' }] },
      { t: 'table', id: 't', head: ['x', 'y'], rows: [['1', '2']] },
      { t: 'mark', kind: 'circle', target: 'v' },
      { t: 'explore', id: 'e', x: [-5, 5], y: [-5, 5], expr: 'a*x', prompt: 'Drag a', params: [{ name: 'a', min: -2, max: 2, start: 1 }] },
    ]
    for (const a of all) expect(describeAction(a, index).length).toBeGreaterThan(0)
  })
  test('a label without brackets gets its coordinates; unicode minus is used', () => {
    expect(describeAction(pts[2] as Action, index)).toBe('Point vertex (2, −1)')
  })
})
