import type { Action } from '../actions'
import { intersects } from '../layout/labels'
import { plotArea } from '../layout/plot-transform'
import type { Box, Placed } from '../layout/types'
import type { Avoid } from './elements/Plot'
import { layoutLabels, plotFns } from './elements/Plot'
import { placeAround, plotGeometry } from './plot/geometry'

const NOTE_W = 160
const GAP = 8
const LINE_H = 23
const CHARS_PER_LINE = 16

/** Estimated size of a mark's note (Playpen 18 px wrapped to NOTE_W). */
export const noteSize = (text: string): { w: number; h: number } => ({
  w: NOTE_W,
  h: Math.max(1, Math.ceil(text.length / CHARS_PER_LINE)) * LINE_H + 4,
})

/** Default note position: right of the shape when it fits, else below it; always clamped inside the board. */
export function noteBox(shape: Box, boardW: number, boardH: number, text: string): Box {
  const { h } = noteSize(text)
  const right = shape.x + shape.w + GAP + NOTE_W <= boardW
  const w = right ? NOTE_W : Math.min(240, boardW - 2 * GAP)
  const x = right ? shape.x + shape.w + GAP : Math.min(shape.x, boardW - w - GAP)
  const y = right ? shape.y + shape.h / 2 - 12 : shape.y + shape.h + GAP
  return { x: Math.max(GAP, x), y: Math.max(GAP, Math.min(y, boardH - h - GAP)), w, h }
}

type MarkAction = Extract<Action, { t: 'mark' }>
const isPlotLike = (p: Placed) => p.action.t === 'plot' || p.action.t === 'explore'

/**
 * Note boxes for every visible mark, plus the shapes and notes other labels must avoid.
 * A mark inside a plot gets its note from a label search that steers clear of axes, tick labels,
 * the curve, points, other marks and other notes; elsewhere the default right/below rule applies.
 */
export function layoutNotes(
  shown: Placed[], boardW: number, boardH: number, params: (id: string) => Record<string, number>,
): { notes: Map<string, Box>; labels: Map<string, Box> } {
  const marks = shown.filter((p) => p.action.t === 'mark')
  const shapes = marks.map((m) => m.box)
  const notes = new Map<string, Box>()
  const placed: Box[] = []
  const geos = new Map<string, ReturnType<typeof plotGeometry>>()
  const labels = new Map<string, Box>()
  const avoid: Avoid = { shapes, notes: [] }
  // Point/line/guide labels first: they sit next to their dot, so notes (longer, freer) work around them.
  for (const plot of shown.filter(isPlotLike)) {
    const pa = plot.action as Extract<Action, { t: 'plot' | 'explore' }>
    const area = plotArea(pa, plot.box)
    const geo = plotGeometry(area, pa.x, pa.y, plotFns(pa, params(plot.id)))
    geos.set(plot.id, geo)
    const kids = shown.filter((p) => p.region === 'inplot' && p.parent === plot.id)
    for (const [id, b] of layoutLabels(kids, area, pa, geo, avoid)) labels.set(id, b)
  }
  const plotOf = (m: Placed): Placed | undefined => {
    const t = shown.find((p) => p.id === (m.action as MarkAction).target && p.region !== 'overlay')
    if (!t) return undefined
    if (t.region === 'inplot') return shown.find((p) => p.id === t.parent && p.region !== 'overlay')
    return isPlotLike(t) ? t : undefined
  }
  for (const m of marks) {
    const a = m.action as MarkAction
    if (!a.note) continue
    const plot = plotOf(m)
    const fallback = noteBox(m.box, boardW, boardH, a.note)
    if (!plot || !isPlotLike(plot)) { notes.set(m.id, fallback); placed.push(fallback); continue }
    const pa = plot.action as Extract<Action, { t: 'plot' | 'explore' }>
    const area = plotArea(pa, plot.box)
    const geo = geos.get(plot.id)
    if (!geo) { notes.set(m.id, fallback); placed.push(fallback); continue }
    const kidIds = new Set(shown.filter((p) => p.parent === plot.id).map((p) => p.id))
    const labelBoxes = [...labels].filter(([id]) => kidIds.has(id)).map(([, b]) => b)
    const s = m.box
    const near = { x: s.x - 8, y: s.y - 8, w: s.w + 16, h: s.h + 16 }
    const size = noteSize(a.note)
    const e = Math.max(4, Math.max(s.w, s.h) / 2 - 6 + 4)
    const others = [
      ...geo.structure, ...geo.curve.filter((c) => !intersects(c, near)), ...geo.legend.map((l) => l.box),
      ...shapes.filter((x) => x !== s), ...labelBoxes, ...placed,
    ]
    const box = placeAround([s.x + s.w / 2, s.y + s.h / 2], size, others, area, [e, e + 16, e + 32, e + 48])
    notes.set(m.id, box)
    placed.push(box)
  }
  return { notes, labels }
}
