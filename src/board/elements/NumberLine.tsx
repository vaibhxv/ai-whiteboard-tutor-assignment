import type { Action } from '../../actions'
import { fmtNum } from '../../maths/format'
import { niceTicks } from '../plot/ticks'
import { roughPaths, seedOf } from '../rough'
import { SvgRoot } from './shared'
import type { ElProps } from './shared'

const SIDE = 24

export function NumberLine(p: ElProps) {
  const a = p.item.action as Extract<Action, { t: 'numberline' }>
  const { box, id } = p.item
  const x0 = box.x + SIDE
  const x1 = box.x + box.w - SIDE
  const y = box.y + box.h * 0.6
  const px = (v: number) => x0 + ((v - a.range[0]) / (a.range[1] - a.range[0])) * (x1 - x0)
  const ticks = niceTicks(a.range[0], a.range[1], Math.max(2, Math.floor((x1 - x0) / 70)))
  const line = roughPaths('line', { x1: x0, y1: y, x2: x1, y2: y }, seedOf(`${id}:axis`))
  return (
    <SvgRoot {...p} className="el-numberline">
      {line.map((d, i) => <path key={i} d={d} className="stroke" pathLength={1} />)}
      {ticks.map((t) => (
        <g key={t}>
          {roughPaths('line', { x1: px(t), y1: y - 6, x2: px(t), y2: y + 6 }, seedOf(`${id}:t${t}`)).map((d, i) => (
            <path key={i} d={d} className="stroke" pathLength={1} />
          ))}
          <text x={px(t)} y={y + 24} textAnchor="middle" className="tick-label">{fmtNum(t)}</text>
        </g>
      ))}
      {a.marks.map((m, i) => (
        <g key={i}>
          <circle cx={px(m.at)} cy={y} r={6} className="point-dot" />
          <text x={px(m.at)} y={y - 16} textAnchor="middle" className="svg-note">{m.label ?? fmtNum(m.at)}</text>
        </g>
      ))}
    </SvgRoot>
  )
}
