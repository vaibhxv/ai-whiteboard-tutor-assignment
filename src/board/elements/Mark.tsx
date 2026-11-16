import type { Action } from '../../actions'
import type { Box } from '../../layout/types'
import { roughPaths, seedOf } from '../rough'
import { SvgRoot } from './shared'
import type { ElProps } from './shared'

const NOTE_W = 160
const NOTE_H = 80
const GAP = 8

/** Where a mark's note text sits (right of its shape when it fits, else below); also used to keep point labels clear of it. */
export function noteBox(shape: Box, boardW: number): Box {
  const right = shape.x + shape.w + GAP + NOTE_W <= boardW
  const x = right ? shape.x + shape.w + GAP : shape.x
  const y = right ? shape.y + shape.h / 2 - 12 : shape.y + shape.h + GAP
  return { x, y, w: Math.max(60, Math.min(right ? NOTE_W : 240, boardW - x - GAP)), h: NOTE_H }
}

/** circle / box / underline / arrow drawn as rough paths over the shape Task 6 computed, plus its note. */
export function Mark({ boardW, ...p }: ElProps & { boardW: number }) {
  const a = p.item.action as Extract<Action, { t: 'mark' }>
  const { x, y, w, h } = p.item.box
  const seed = seedOf(p.item.id)
  let paths: string[]
  switch (a.kind) {
    case 'circle': paths = roughPaths('ellipse', { cx: x + w / 2, cy: y + h / 2, w, h }, seed); break
    case 'box': paths = roughPaths('rect', { x, y, w, h }, seed); break
    case 'underline': paths = roughPaths('line', { x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2 }, seed); break
    case 'arrow': paths = w >= h
      ? roughPaths('arrow', { x1: x + w, y1: y + h / 2, x2: x, y2: y + h / 2 }, seed)
      : roughPaths('arrow', { x1: x + w / 2, y1: y + h, x2: x + w / 2, y2: y }, seed)
      break
  }
  const note = noteBox(p.item.box, boardW)
  return (
    <SvgRoot {...p} className="el-mark">
      {paths.map((d, i) => <path key={i} d={d} className="stroke mark-stroke" />)}
      {a.note && (
        <foreignObject x={note.x} y={note.y} width={note.w} height={note.h}>
          <div className="mark-note">{a.note}</div>
        </foreignObject>
      )}
    </SvgRoot>
  )
}
