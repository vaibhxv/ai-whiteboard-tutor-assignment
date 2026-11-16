import type { Action } from '../actions'
import type { Box, Placed } from '../layout/types'
import { describeAction } from './describe'
import { ExploreControls, ExploreFigure } from './elements/Explore'
import type { ParamValues } from './elements/Explore'
import { Mark } from './elements/Mark'
import { MathLine } from './elements/MathLine'
import { NumberLine } from './elements/NumberLine'
import { Plot } from './elements/Plot'
import { Step } from './elements/Step'
import { Table } from './elements/Table'
import { Write } from './elements/Write'

const HTML = new Set<Action['t']>(['write', 'math', 'step', 'solutions', 'table', 'explore'])
const SVG = new Set<Action['t']>(['plot', 'numberline', 'mark', 'explore'])
/** Points, lines and guides are drawn by their plot. */
export const isInplot = (p: Placed): boolean => p.region === 'inplot'
export const inHtmlLayer = (p: Placed): boolean => !isInplot(p) && HTML.has(p.action.t)
export const inSvgLayer = (p: Placed): boolean => !isInplot(p) && SVG.has(p.action.t)

export type ViewCtx = {
  index: ReadonlyMap<string, Action>
  selected?: string
  onSelect(id: string): void
  boardW: number
  kidsOf(plotId: string): Placed[]
  /** Note boxes of visible marks, which point labels steer clear of. */
  avoid: Box[]
  params(id: string): ParamValues
  setParam(id: string, name: string, v: number): void
}

export function HtmlElement({ item, ctx }: { item: Placed; ctx: ViewCtx }) {
  const p = { item, index: ctx.index, selected: ctx.selected === item.id, onSelect: ctx.onSelect, label: describeAction(item.action, ctx.index) }
  switch (item.action.t) {
    case 'write': return <Write {...p} />
    case 'math':
    case 'solutions': return <MathLine {...p} />
    case 'step': return <Step {...p} />
    case 'table': return <Table {...p} />
    case 'explore':
      return <ExploreControls {...p} values={ctx.params(item.id)} onParam={(n, v) => ctx.setParam(item.id, n, v)} />
    default: return null
  }
}

export function SvgElement({ item, ctx }: { item: Placed; ctx: ViewCtx }) {
  const p = { item, index: ctx.index, selected: ctx.selected === item.id, onSelect: ctx.onSelect, label: describeAction(item.action, ctx.index) }
  switch (item.action.t) {
    case 'plot': return <Plot {...p} kids={ctx.kidsOf(item.id)} avoid={ctx.avoid} selectedId={ctx.selected} />
    case 'numberline': return <NumberLine {...p} />
    case 'mark': return <Mark {...p} boardW={ctx.boardW} />
    case 'explore':
      return <ExploreFigure item={item} values={ctx.params(item.id)} kids={ctx.kidsOf(item.id)} avoid={ctx.avoid} index={ctx.index} selectedId={ctx.selected} onSelect={ctx.onSelect} />
    default: return null
  }
}
