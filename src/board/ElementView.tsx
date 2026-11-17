import type { Action } from '../actions'
import type { Box, Placed } from '../layout/types'
import type { Anim } from './anim'
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
  /** Ids of elements found wrong. */
  struck: ReadonlySet<string>
  onSelect(id: string): void
  /** Draw-on animation of an item (undefined for static ones); `layer` picks the explore half. */
  animOf(item: Placed, layer?: 'html' | 'svg'): Anim | undefined
  noteOf(markId: string): Box
  kidsOf(plotId: string): Placed[]
  /** Laid-out label boxes of points, lines and guides, by element id. */
  labels: ReadonlyMap<string, Box>
  params(id: string): ParamValues
  setParam(id: string, name: string, v: number): void
}

export function HtmlElement({ item, ctx }: { item: Placed; ctx: ViewCtx }) {
  const p = { item, index: ctx.index, selected: ctx.selected === item.id, struck: ctx.struck.has(item.id), onSelect: ctx.onSelect, label: describeAction(item.action, ctx.index), anim: ctx.animOf(item, 'html') }
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
  const p = { item, index: ctx.index, selected: ctx.selected === item.id, struck: ctx.struck.has(item.id), onSelect: ctx.onSelect, label: describeAction(item.action, ctx.index), anim: ctx.animOf(item, 'svg') }
  switch (item.action.t) {
    case 'plot': return <Plot {...p} kids={ctx.kidsOf(item.id)} labels={ctx.labels} selectedId={ctx.selected} animOf={ctx.animOf} />
    case 'numberline': return <NumberLine {...p} />
    case 'mark': return <Mark {...p} note={ctx.noteOf(item.id)} />
    case 'explore':
      return <ExploreFigure item={item} values={ctx.params(item.id)} kids={ctx.kidsOf(item.id)} labels={ctx.labels} index={ctx.index} selectedId={ctx.selected} onSelect={ctx.onSelect} anim={p.anim} animOf={ctx.animOf} />
    default: return null
  }
}
