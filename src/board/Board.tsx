import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Action } from '../actions'
import { BOARD } from '../layout/constants'
import type { Box, Page, Placed, Viewport } from '../layout/types'
import type { BeatTiming } from '../player/durations'
import '../styles/board.css'
import { HtmlElement, inHtmlLayer, inSvgLayer, isInplot, SvgElement } from './ElementView'
import type { ViewCtx } from './ElementView'
import { noteBox } from './elements/Mark'
import { startValues } from './elements/Explore'
import type { ParamValues } from './elements/Explore'

export type BoardProps = {
  pages: Page[]
  pageIndex: number
  visibleBeats: ReadonlySet<string>
  /** Task 10: animation of the beat being spoken. Static rendering ignores it. */
  animating?: { beatId: string; timing: BeatTiming }
  speed: number
  selected?: string
  onSelect(id: string): void
  index: ReadonlyMap<string, Action>
  viewport: Viewport
  answer?: { panel: Box; items: Placed[]; visibleBeats: ReadonlySet<string> }
}

/** Width of the container, kept up to date; 0 when the environment has no layout (jsdom). */
function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export function Board(props: BoardProps) {
  const { pages, pageIndex, visibleBeats, selected, onSelect, index, viewport, answer } = props
  const { w: lw, h: lh } = BOARD[viewport]
  const outer = useRef<HTMLDivElement>(null)
  const width = useWidth(outer)
  const s = width > 0 ? width / lw : 1
  const [edits, setEdits] = useState<Record<string, ParamValues>>({})
  const page = pages[pageIndex]

  const shown = useMemo<Placed[]>(() => {
    const own = (page?.items ?? []).filter((i) => visibleBeats.has(i.beatId))
    const ans = answer ? answer.items.filter((i) => answer.visibleBeats.has(i.beatId)) : []
    return [...own, ...ans]
  }, [page, visibleBeats, answer])

  const params = useCallback(
    (id: string): ParamValues => {
      const a = index.get(id)
      const base = a?.t === 'explore' ? startValues(a) : {}
      return { ...base, ...edits[id] }
    },
    [index, edits],
  )
  const avoid = useMemo(() => shown.filter((i) => i.action.t === 'mark').map((i) => noteBox(i.box, lw)).map((b) => ({ ...b, y: b.y + 12, h: 34 })), [shown, lw])
  const ctx: ViewCtx = {
    index, selected, onSelect, boardW: lw,
    avoid,
    kidsOf: (id) => shown.filter((i) => isInplot(i) && i.parent === id),
    params,
    setParam: (id, name, v) => setEdits((e) => ({ ...e, [id]: { ...e[id], [name]: v } })),
  }
  const html = shown.filter(inHtmlLayer)
  const svg = shown.filter(inSvgLayer)

  return (
    <div ref={outer} className="board-outer" style={{ height: lh * s }}>
      <div className={`board board-${viewport}`} style={{ width: lw, height: lh, transform: `scale(${s})` }}>
        {answer && <div className="answer-panel" style={{ left: answer.panel.x, top: answer.panel.y, width: answer.panel.w, height: answer.panel.h }} />}
        <div className="layer layer-html">
          {html.map((it) => <HtmlElement key={it.id} item={it} ctx={ctx} />)}
        </div>
        <svg className="layer layer-svg" viewBox={`0 0 ${lw} ${lh}`} width={lw} height={lh}>
          {svg.map((it) => <SvgElement key={it.id} item={it} ctx={ctx} />)}
        </svg>
      </div>
    </div>
  )
}
