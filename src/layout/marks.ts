import type { Action } from '../actions'
import { clampBox } from './labels'
import { plotArea, plotTransform } from './plot-transform'
import type { Box, MarkKind, Placed } from './types'

const CIRCLE_PAD = 10
const BOX_PAD = 8
const UNDERLINE_H = 6
const ARROW_LEN = 48
const ARROW_THICK = 12
const ARROW_GAP = 4
const NOTE_GAP = 8
/** Room a note needs to sit to the right of its shape. */
const NOTE_ROOM = 160
/** Size of the target box around a point inside a plot. */
const POINT_BOX = 16

const pad = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p })
const clampPt = ([x, y]: [number, number], b: Box): [number, number] =>
  [Math.min(Math.max(x, b.x), b.x + b.w), Math.min(Math.max(y, b.y), b.y + b.h)]

/**
 * Geometry for a mark around `target`, clamped inside `bounds`.
 * - circle: the ellipse bounding the target padded by 10.
 * - box: a rect padded by 8.
 * - underline: a 6-px-tall box just under the target.
 * - arrow: a 12-px-thick box spanning the arrow. It runs horizontally from the note (right of the
 *   target) to the target's right edge, or vertically from below to the bottom edge when there is
 *   no room on the right. The arrow's tail is the end nearer `noteAnchor`; its head touches the target.
 * `noteAnchor` is right of the shape when the note fits inside bounds there, else below it.
 */
export function markGeometry(kind: MarkKind, target: Box, bounds: Box): { shape: Box; noteAnchor: [number, number] } {
  const right = bounds.x + bounds.w
  let raw: Box
  switch (kind) {
    case 'circle': raw = pad(target, CIRCLE_PAD); break
    case 'box': raw = pad(target, BOX_PAD); break
    case 'underline': raw = { x: target.x, y: target.y + target.h + 2, w: target.w, h: UNDERLINE_H }; break
    case 'arrow': {
      const horiz: Box = {
        x: target.x + target.w + ARROW_GAP, y: target.y + target.h / 2 - ARROW_THICK / 2, w: ARROW_LEN, h: ARROW_THICK,
      }
      raw = horiz.x + horiz.w + NOTE_GAP + NOTE_ROOM <= right
        ? horiz
        : { x: target.x + target.w / 2 - ARROW_THICK / 2, y: target.y + target.h + ARROW_GAP, w: ARROW_THICK, h: ARROW_LEN }
      break
    }
  }
  const shape = clampBox(raw, bounds)
  const anchor: [number, number] = shape.x + shape.w + NOTE_GAP + NOTE_ROOM <= right
    ? [shape.x + shape.w + NOTE_GAP, shape.y + shape.h / 2]
    : [shape.x, shape.y + shape.h + NOTE_GAP]
  return { shape, noteAnchor: clampPt(anchor, bounds) }
}

const around = ([x, y]: [number, number], w = POINT_BOX, h = POINT_BOX): Box => ({ x: x - w / 2, y: y - h / 2, w, h })

/**
 * The box a mark should wrap for `target`. Items inside a plot resolve to their own pixel
 * geometry (a point → a 16×16 box around it), so circling a point circles the point, not the plot.
 * `parent` is the placed figure that holds an inplot target.
 */
export function markTargetBox(target: Placed, parent?: Placed): Box {
  const a: Action = target.action
  if (target.region !== 'inplot' || !parent || (parent.action.t !== 'plot' && parent.action.t !== 'explore')) {
    return target.box
  }
  const area = plotArea(parent.action, parent.box)
  const { toPx, inner } = plotTransform(area, parent.action.x, parent.action.y)
  let box: Box
  if (a.t === 'point') box = around(toPx(a.at))
  else if (a.t === 'line') {
    const [x1, y1] = toPx(a.from)
    const [x2, y2] = toPx(a.to)
    const w = Math.max(Math.abs(x2 - x1), POINT_BOX)
    const h = Math.max(Math.abs(y2 - y1), POINT_BOX)
    box = around([(x1 + x2) / 2, (y1 + y2) / 2], w, h)
  } else if (a.t === 'guide' && a.x !== undefined && a.y !== undefined) box = around(toPx([a.x, a.y]))
  else if (a.t === 'guide' && a.x !== undefined) box = { ...around(toPx([a.x, 0])), y: inner.y, h: inner.h }
  else if (a.t === 'guide' && a.y !== undefined) box = { ...around(toPx([0, a.y])), x: inner.x, w: inner.w }
  else return area
  return clampBox(box, area)
}
