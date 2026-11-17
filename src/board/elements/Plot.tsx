import { useId, useMemo } from 'react'
import type { Action } from '../../actions'
import { intersects } from '../../layout/labels'
import { markTargetBox } from '../../layout/marks'
import { plotArea, plotTransform } from '../../layout/plot-transform'
import type { Box, Placed } from '../../layout/types'
import { fmtNum } from '../../maths/format'
import { compile, parseMath } from '../../maths/safe'
import { describeAction } from '../describe'
import { samplePath } from '../plot/sample'
import { axisPos, labelSize, placeAround, plotGeometry } from '../plot/geometry'
import type { PlotFn, PlotGeo } from '../plot/geometry'
import { niceTicks } from '../plot/ticks'
import { roughPaths, seedOf } from '../rough'
import type { Anim } from '../anim'
import { SvgRoot } from './shared'
import type { ElProps } from './shared'

export type { PlotFn }
type Kid = Extract<Action, { t: 'point' | 'line' | 'guide' }>

/** Compile an expression of x (plus any `scope` params) to a function; NaN everywhere if it will not parse. */
export function compileFn(expr: string, scope: Record<string, number> = {}): (x: number) => number {
  const p = parseMath(expr)
  if (!p.ok || p.value.kind !== 'expr') return () => NaN
  const f = compile(p.value.node)
  return (x) => f({ ...scope, x })
}

const POINT_BOX = 16

function Axes({ id, area, x, y }: { id: string; area: Box; x: [number, number]; y: [number, number] }) {
  const { toPx, inner, ax, ay } = axisPos(area, x, y)
  const crossAtOrigin = x[0] <= 0 && 0 <= x[1] && y[0] <= 0 && 0 <= y[1]
  const xt = niceTicks(x[0], x[1])
  const yt = niceTicks(y[0], y[1])
  const rp = (s: string, x1: number, y1: number, x2: number, y2: number) =>
    roughPaths('line', { x1, y1, x2, y2 }, seedOf(`${id}:${s}`))
  return (
    <g className="axes">
      {rp('ax', inner.x, ay, inner.x + inner.w, ay).map((d, i) => <path key={`x${i}`} d={d} className="stroke" pathLength={1} />)}
      {rp('ay', ax, inner.y, ax, inner.y + inner.h).map((d, i) => <path key={`y${i}`} d={d} className="stroke" pathLength={1} />)}
      {xt.map((t) => {
        const px = toPx([t, 0])[0]
        return (
          <g key={`tx${t}`}>
            {rp(`tx${t}`, px, ay - 5, px, ay + 5).map((d, i) => <path key={i} d={d} className="stroke" pathLength={1} />)}
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
            {rp(`ty${t}`, ax - 5, py, ax + 5, py).map((d, i) => <path key={i} d={d} className="stroke" pathLength={1} />)}
            {!(crossAtOrigin && t === 0) && (
              <text x={Math.max(ax - 10, inner.x - 10)} y={py + 5} textAnchor="end" className="tick-label">{fmtNum(t)}</text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/** Obstacles shared by everything placed on one plot. */
export type Avoid = { shapes: Box[]; notes: Box[] }
const contains = (b: Box, [x, y]: [number, number]) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
const GAP_AROUND = 4

/** Label boxes for points/lines/guides, laid out together so they avoid axes, the curve, marks, notes, dots and each other. */
export function layoutLabels(kids: Placed[], area: Box, a: { x: [number, number]; y: [number, number] }, geo: PlotGeo, avoid: Avoid): Map<string, Box> {
  const { toPx, inner } = plotTransform(area, a.x, a.y)
  const dots = new Map<string, Box>()
  const placed: Box[] = []
  const anchors: { id: string; at: [number, number]; text: string; own?: Box }[] = []
  for (const k of kids) {
    const c = k.action as Kid
    if (c.t === 'point') {
      const at = toPx(c.at)
      const dot = { x: at[0] - POINT_BOX / 2, y: at[1] - POINT_BOX / 2, w: POINT_BOX, h: POINT_BOX }
      dots.set(k.id, dot)
      if (c.label) anchors.push({ id: k.id, at, text: c.label, own: dot })
    } else if (c.t === 'line' && c.label) {
      const [x1, y1] = toPx(c.from)
      const [x2, y2] = toPx(c.to)
      anchors.push({ id: k.id, at: [(x1 + x2) / 2, (y1 + y2) / 2], text: c.label })
    } else if (c.t === 'guide' && c.label) {
      const at: [number, number] = c.x !== undefined ? [toPx([c.x, 0])[0], inner.y + 8] : [inner.x + 8, toPx([0, c.y ?? 0])[1]]
      anchors.push({ id: k.id, at, text: c.label })
    }
  }
  const legendBoxes = geo.legend.map((l) => l.box)
  const out = new Map<string, Box>()
  for (const an of anchors) {
    // A mark's shape around this anchor is cleared by inflating the label rather than treated as an obstacle.
    const covering = avoid.shapes.filter((s) => contains(s, an.at))
    const extra = covering.reduce((m, s) => Math.max(m, Math.max(s.w, s.h) / 2 - POINT_BOX / 2), 0)
    const e = GAP_AROUND + Math.max(0, extra)
    const ownDot = an.own
    const curve = ownDot ? geo.curve.filter((c) => !intersects(c, { x: ownDot.x - 10, y: ownDot.y - 10, w: ownDot.w + 20, h: ownDot.h + 20 })) : geo.curve
    const others = [
      ...geo.structure, ...curve, ...legendBoxes, ...avoid.notes,
      ...avoid.shapes.filter((s) => !covering.includes(s)),
      ...[...dots].filter(([id]) => id !== an.id).map(([, d]) => d), ...placed,
    ]
    const size = labelSize(an.text)
    const b = placeAround(an.at, size, others, area, [e, Math.max(extra, 0), e + 16, e + 32, e + 48])
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
          <path key={i} d={d} className="stroke" pathLength={c.dashed ? undefined : 1} strokeDasharray={c.dashed ? '8 6' : undefined} />
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
/** The curves of a plot or explore (an explore's use its current param values). */
export function plotFns(a: Extract<Action, { t: 'plot' | 'explore' }>, values: Record<string, number> = {}): PlotFn[] {
  return a.t === 'plot'
    ? a.fns.map((f) => ({ id: f.id, f: compileFn(f.expr), label: f.label }))
    : [{ id: a.id, f: compileFn(a.expr, values) }]
}

export function PlotDrawing({ id, box, x, y, fns, geo }: { id: string; box: Box; x: [number, number]; y: [number, number]; fns: PlotFn[]; geo: PlotGeo }) {
  const clip = `clip-${useId().replace(/:/g, '')}`
  const { toPx, inner } = plotTransform(box, x, y)
  const paths = useMemo(() => fns.map((fn) => samplePath(fn.f, x, y, toPx)), [fns, x, y, box]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Axes id={id} area={box} x={x} y={y} />
      <clipPath id={clip}><rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} /></clipPath>
      <g clipPath={`url(#${clip})`}>
        {paths.map((d, i) => d && <path key={fns[i]?.id ?? i} d={d} className={`curve fn-${i % 4}`} fill="none" pathLength={1} />)}
      </g>
      {geo.legend.map(({ fn, box: b }) => (
        <text key={fn.id} x={b.x} y={b.y + b.h - 5} className={`legend fn-${fns.indexOf(fn) % 4}`}>{fn.label}</text>
      ))}
    </>
  )
}

/** Points, lines and guides on a plot: each is its own focusable element, laid out against the others. */
export function PlotKids({ plot, kids, area, labels, index, selectedId, onSelect, animOf, struck }: {
  plot: Placed; kids: Placed[]; area: Box; labels: ReadonlyMap<string, Box>; index: ElProps['index']; selectedId?: string; onSelect(id: string): void
  animOf?: (item: Placed) => Anim | undefined
  struck?: ReadonlySet<string>
}) {
  const a = plot.action as Extract<Action, { t: 'plot' | 'explore' }>
  return (
    <>
      {kids.map((k) => (
        <SvgRoot
          key={`${k.id}:${animOf?.(k)?.key ?? ''}`}
          anim={animOf?.(k)}
          index={index}
          onSelect={onSelect}
          item={{ ...k, box: markTargetBox(k, plot) }}
          selected={k.id === selectedId}
          struck={struck?.has(k.id)}
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

export function Plot(p: ElProps & { kids: Placed[]; labels: ReadonlyMap<string, Box>; selectedId?: string; animOf?: (item: Placed) => Anim | undefined; struckKids?: ReadonlySet<string> }) {
  const { kids, labels, selectedId, animOf, struckKids, ...root } = p
  const a = p.item.action as Extract<Action, { t: 'plot' }>
  const fns = useMemo<PlotFn[]>(() => a.fns.map((f) => ({ id: f.id, f: compileFn(f.expr), label: f.label })), [a])
  const area = plotArea(a, p.item.box)
  const geo = useMemo(() => plotGeometry(area, a.x, a.y, fns), [area.x, area.y, area.w, area.h, a, fns]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <SvgRoot {...root} className="el-plot">
        <PlotDrawing id={p.item.id} box={area} x={a.x} y={a.y} fns={fns} geo={geo} />
      </SvgRoot>
      <PlotKids plot={p.item} kids={kids} area={area} labels={labels} index={p.index} selectedId={selectedId} onSelect={p.onSelect} animOf={animOf} struck={struckKids} />
    </>
  )
}
