import { useId, useMemo } from 'react'
import type { Action } from '../../actions'
import { placeLabel } from '../../layout/labels'
import { markTargetBox } from '../../layout/marks'
import { plotArea, plotTransform } from '../../layout/plot-transform'
import type { Box, Placed } from '../../layout/types'
import { fmtNum } from '../../maths/format'
import { compile, parseMath } from '../../maths/safe'
import { describeAction } from '../describe'
import { samplePath } from '../plot/sample'
import { niceTicks } from '../plot/ticks'
import { roughPaths, seedOf } from '../rough'
import { SvgRoot } from './shared'
import type { ElProps } from './shared'

export type PlotFn = { id: string; f: (x: number) => number; label?: string }
type Kid = Extract<Action, { t: 'point' | 'line' | 'guide' }>

/** Compile an expression of x (plus any `scope` params) to a function; NaN everywhere if it will not parse. */
export function compileFn(expr: string, scope: Record<string, number> = {}): (x: number) => number {
  const p = parseMath(expr)
  if (!p.ok || p.value.kind !== 'expr') return () => NaN
  const f = compile(p.value.node)
  return (x) => f({ ...scope, x })
}

const LABEL_H = 20
const labelSize = (s: string) => ({ w: s.length * 8.5 + 8, h: LABEL_H })
const POINT_BOX = 16

function Axes({ id, area, x, y }: { id: string; area: Box; x: [number, number]; y: [number, number] }) {
  const { toPx, inner } = plotTransform(area, x, y)
  const clampX = (v: number) => Math.min(Math.max(v, inner.x), inner.x + inner.w)
  const clampY = (v: number) => Math.min(Math.max(v, inner.y), inner.y + inner.h)
  const ax = clampX(toPx([0, 0])[0])
  const ay = clampY(toPx([0, 0])[1])
  const crossAtOrigin = x[0] <= 0 && 0 <= x[1] && y[0] <= 0 && 0 <= y[1]
  const xt = niceTicks(x[0], x[1])
  const yt = niceTicks(y[0], y[1])
  const rp = (s: string, x1: number, y1: number, x2: number, y2: number) =>
    roughPaths('line', { x1, y1, x2, y2 }, seedOf(`${id}:${s}`))
  return (
    <g className="axes">
      {rp('ax', inner.x, ay, inner.x + inner.w, ay).map((d, i) => <path key={`x${i}`} d={d} className="stroke" />)}
      {rp('ay', ax, inner.y, ax, inner.y + inner.h).map((d, i) => <path key={`y${i}`} d={d} className="stroke" />)}
      {xt.map((t) => {
        const px = toPx([t, 0])[0]
        return (
          <g key={`tx${t}`}>
            {rp(`tx${t}`, px, ay - 5, px, ay + 5).map((d, i) => <path key={i} d={d} className="stroke" />)}
            {!(crossAtOrigin && t === 0) && (
              <text x={px} y={Math.min(ay + 22, inner.y + inner.h + 22)} textAnchor="middle" className="tick-label">{fmtNum(t)}</text>
            )}
          </g>
        )
      })}
      {yt.map((t) => {
        const py = toPx([0, t])[1]
        return (
          <g key={`ty${t}`}>
            {rp(`ty${t}`, ax - 5, py, ax + 5, py).map((d, i) => <path key={i} d={d} className="stroke" />)}
            {!(crossAtOrigin && t === 0) && (
              <text x={Math.max(ax - 10, inner.x - 10)} y={py + 5} textAnchor="end" className="tick-label">{fmtNum(t)}</text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/** Label boxes for points/lines/guides, laid out together so they avoid each other and the dots. */
function layoutLabels(kids: Placed[], area: Box, a: { x: [number, number]; y: [number, number] }, avoid: Box[]): Map<string, Box> {
  const { toPx, inner } = plotTransform(area, a.x, a.y)
  const dots = new Map<string, Box>()
  const placed: Box[] = []
  const anchors: { id: string; at: [number, number]; text: string }[] = []
  for (const k of kids) {
    const c = k.action as Kid
    if (c.t === 'point') {
      const at = toPx(c.at)
      dots.set(k.id, { x: at[0] - POINT_BOX / 2, y: at[1] - POINT_BOX / 2, w: POINT_BOX, h: POINT_BOX })
      if (c.label) anchors.push({ id: k.id, at, text: c.label })
    } else if (c.t === 'line' && c.label) {
      const [x1, y1] = toPx(c.from)
      const [x2, y2] = toPx(c.to)
      anchors.push({ id: k.id, at: [(x1 + x2) / 2, (y1 + y2) / 2], text: c.label })
    } else if (c.t === 'guide' && c.label) {
      const at: [number, number] = c.x !== undefined ? [toPx([c.x, 0])[0], inner.y + 8] : [inner.x + 8, toPx([0, c.y ?? 0])[1]]
      anchors.push({ id: k.id, at, text: c.label })
    }
  }
  const out = new Map<string, Box>()
  for (const an of anchors) {
    // A point's own dot is not an obstacle for its own label, only the other dots, labels and mark notes are.
    const others = [...avoid, ...[...dots].filter(([id]) => id !== an.id).map(([, d]) => d), ...placed]
    const b = placeLabel(an.at, labelSize(an.text), others, area)
    placed.push(b)
    out.set(an.id, b)
  }
  return out
}

function KidShape({ kid, area, plot, label }: { kid: Placed; area: Box; plot: { x: [number, number]; y: [number, number] }; label?: Box }) {
  const c = kid.action as Kid
  const { toPx, inner } = plotTransform(area, plot.x, plot.y)
  const text = label && 'label' in c && c.label ? (
    <text x={label.x + label.w / 2} y={label.y + label.h - 5} textAnchor="middle" className="svg-note">{c.label}</text>
  ) : null
  if (c.t === 'point') {
    const [px, py] = toPx(c.at)
    return <><circle cx={px} cy={py} r={5} className="point-dot" />{text}</>
  }
  if (c.t === 'line') {
    const [x1, y1] = toPx(c.from)
    const [x2, y2] = toPx(c.to)
    return (
      <>
        {roughPaths('line', { x1, y1, x2, y2 }, seedOf(kid.id)).map((d, i) => (
          <path key={i} d={d} className="stroke" strokeDasharray={c.dashed ? '8 6' : undefined} />
        ))}
        {text}
      </>
    )
  }
  const lines: [number, number, number, number][] = []
  if (c.x !== undefined) { const px = toPx([c.x, 0])[0]; lines.push([px, inner.y, px, c.y !== undefined ? toPx([c.x, c.y])[1] : inner.y + inner.h]) }
  if (c.y !== undefined) { const py = toPx([0, c.y])[1]; lines.push([inner.x, py, c.x !== undefined ? toPx([c.x, c.y])[0] : inner.x + inner.w, py]) }
  return (
    <>
      {lines.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="guide-line" />)}
      {text}
    </>
  )
}

/** The drawing: axes, computed curves (clipped to the plot area) and a legend. */
export function PlotDrawing({ id, box, x, y, fns }: { id: string; box: Box; x: [number, number]; y: [number, number]; fns: PlotFn[] }) {
  const clip = `clip-${useId().replace(/:/g, '')}`
  const { toPx, inner } = plotTransform(box, x, y)
  const paths = useMemo(() => fns.map((fn) => samplePath(fn.f, x, y, toPx)), [fns, x, y, box]) // eslint-disable-line react-hooks/exhaustive-deps
  const legend = fns.filter((f) => f.label)
  return (
    <>
      <Axes id={id} area={box} x={x} y={y} />
      <clipPath id={clip}><rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} /></clipPath>
      <g clipPath={`url(#${clip})`}>
        {paths.map((d, i) => d && <path key={fns[i]?.id ?? i} d={d} className={`curve fn-${i % 4}`} fill="none" />)}
      </g>
      {legend.map((f, i) => (
        <text key={f.id} x={inner.x + inner.w - 4} y={inner.y + 16 + i * 20} textAnchor="end" className={`legend fn-${fns.indexOf(f) % 4}`}>
          {f.label}
        </text>
      ))}
    </>
  )
}

/** Points, lines and guides on a plot: each is its own focusable element, laid out against the others. */
export function PlotKids({ plot, kids, area, avoid, index, selectedId, onSelect }: {
  plot: Placed; kids: Placed[]; area: Box; avoid: Box[]; index: ElProps['index']; selectedId?: string; onSelect(id: string): void
}) {
  const a = plot.action as Extract<Action, { t: 'plot' | 'explore' }>
  const labels = useMemo(() => layoutLabels(kids, area, a, avoid), [kids, area, a, avoid])
  return (
    <>
      {kids.map((k) => (
        <SvgRoot
          key={k.id}
          index={index}
          onSelect={onSelect}
          item={{ ...k, box: markTargetBox(k, plot) }}
          selected={k.id === selectedId}
          label={describeAction(k.action, index)}
          className={`el-${k.action.t}`}
        >
          <KidShape kid={k} area={area} plot={a} label={labels.get(k.id)} />
          {k.action.verify.status === 'fail' && <text x={markTargetBox(k, plot).x + 18} y={markTargetBox(k, plot).y - 4} className="svg-warn">⚠ May be wrong</text>}
        </SvgRoot>
      ))}
    </>
  )
}

export function Plot(p: ElProps & { kids: Placed[]; avoid: Box[]; selectedId?: string }) {
  const { kids, avoid, selectedId, ...root } = p
  const a = p.item.action as Extract<Action, { t: 'plot' }>
  const fns = useMemo<PlotFn[]>(() => a.fns.map((f) => ({ id: f.id, f: compileFn(f.expr), label: f.label })), [a])
  const area = plotArea(a, p.item.box)
  return (
    <>
      <SvgRoot {...root} className="el-plot">
        <PlotDrawing id={p.item.id} box={area} x={a.x} y={a.y} fns={fns} />
      </SvgRoot>
      <PlotKids plot={p.item} kids={kids} area={area} avoid={avoid} index={p.index} selectedId={selectedId} onSelect={p.onSelect} />
    </>
  )
}
