import { useId, useMemo } from 'react'
import type { Action } from '../../actions'
import { EXPLORE_PARAM_H } from '../../layout/constants'
import { plotArea } from '../../layout/plot-transform'
import type { Box, Placed } from '../../layout/types'
import { fmtNum } from '../../maths/format'
import { PlotDrawing, plotFns, PlotKids } from './Plot'
import { plotGeometry } from '../plot/geometry'
import type { Anim } from '../anim'
import { HtmlRoot } from './shared'
import type { ElProps } from './shared'

export type ParamValues = Record<string, number>
type Exp = Extract<Action, { t: 'explore' }>

export const startValues = (a: Exp): ParamValues => Object.fromEntries(a.params.map((p) => [p.name, p.start]))

/** HTML half of an explore figure: the prompt and one slider per param, under the plot area. */
export function ExploreControls(p: ElProps & { values: ParamValues; onParam(name: string, v: number): void }) {
  const a = p.item.action as Exp
  const uid = useId().replace(/:/g, '')
  const { values, onParam, ...rest } = p
  return (
    <HtmlRoot {...rest} role="group" className="el-explore">
      <div className="explore-prompt">{a.prompt}</div>
      <div className="explore-controls" style={{ height: EXPLORE_PARAM_H * a.params.length }}>
        {a.params.map((q) => {
          const v = values[q.name] ?? q.start
          return (
            <label key={q.name} className="explore-param" style={{ height: EXPLORE_PARAM_H }}>
              <span className="explore-name" id={`${uid}-${q.name}`}>{q.name} = {fmtNum(v)}</span>
              <input
                type="range" min={q.min} max={q.max} step={(q.max - q.min) / 200} value={v}
                aria-labelledby={`${uid}-${q.name}`}
                aria-valuetext={`${q.name} = ${fmtNum(v)}`}
                onKeyDown={(e) => {
                  const step = (q.max - q.min) / 200
                  const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
                  if (dir === 0) return
                  e.preventDefault()
                  e.stopPropagation()
                  onParam(q.name, Math.min(q.max, Math.max(q.min, v + dir * step)))
                }}
                onChange={(e) => onParam(q.name, Number(e.target.value))}
                onClick={(e) => e.stopPropagation()}
              />
            </label>
          )
        })}
      </div>
    </HtmlRoot>
  )
}

/** SVG half: the live curve for the current params, plus points on it. Decorative (the HTML half is the labelled root). */
export function ExploreFigure({ item, values, kids, labels, index, selectedId, onSelect, anim, animOf }: {
  item: Placed; labels: ReadonlyMap<string, Box>; values: ParamValues; kids: Placed[]; index: ElProps['index']; selectedId?: string; onSelect(id: string): void
  anim?: Anim; animOf?: (item: Placed) => Anim | undefined
}) {
  const a = item.action as Exp
  const fns = useMemo(() => plotFns(a, values), [a, values])
  const area = plotArea(a, item.box)
  const geo = useMemo(() => plotGeometry(area, a.x, a.y, fns), [area.x, area.y, area.w, area.h, a, fns]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <g className={`explore-figure ink-${item.ink}${anim ? ` ${anim.cls}` : ''}`} style={anim?.style} aria-hidden="true">
        <PlotDrawing id={item.id} box={area} x={a.x} y={a.y} fns={fns} geo={geo} />
      </g>
      <PlotKids plot={item} kids={kids} area={area} labels={labels} index={index} selectedId={selectedId} onSelect={onSelect} animOf={animOf} />
    </>
  )
}
