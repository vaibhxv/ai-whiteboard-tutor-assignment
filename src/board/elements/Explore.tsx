import { useId, useMemo } from 'react'
import type { Action } from '../../actions'
import { EXPLORE_PARAM_H } from '../../layout/constants'
import { plotArea } from '../../layout/plot-transform'
import type { Box, Placed } from '../../layout/types'
import { fmtNum } from '../../maths/format'
import { compileFn, PlotDrawing, PlotKids } from './Plot'
import type { PlotFn } from './Plot'
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
export function ExploreFigure({ item, values, kids, avoid, index, selectedId, onSelect }: {
  item: Placed; avoid: Box[]; values: ParamValues; kids: Placed[]; index: ElProps['index']; selectedId?: string; onSelect(id: string): void
}) {
  const a = item.action as Exp
  const fns = useMemo<PlotFn[]>(() => [{ id: a.id, f: compileFn(a.expr, values) }], [a, values])
  const area = plotArea(a, item.box)
  return (
    <>
      <g className={`explore-figure ink-${item.ink}`} aria-hidden="true">
        <PlotDrawing id={item.id} box={area} x={a.x} y={a.y} fns={fns} />
      </g>
      <PlotKids plot={item} kids={kids} area={area} avoid={avoid} index={index} selectedId={selectedId} onSelect={onSelect} />
    </>
  )
}
