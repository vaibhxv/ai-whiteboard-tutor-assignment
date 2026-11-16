import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Action } from '../actions'
import { BOARD } from '../layout/constants'
import { markTargetBox } from '../layout/marks'
import type { Box, Page, Placed, Viewport } from '../layout/types'
import type { BeatTiming } from '../player/durations'
import '../styles/board.css'
import { kindOf, makeAnim, prefersReducedMotion } from './anim'
import { Popover } from './Popover'
import { HtmlElement, inHtmlLayer, inSvgLayer, isInplot, SvgElement } from './ElementView'
import type { ViewCtx } from './ElementView'
import { layoutNotes } from './notes'
import { startValues } from './elements/Explore'
import type { ParamValues } from './elements/Explore'

export type BoardProps = {
  pages: Page[]
  pageIndex: number
  visibleBeats: ReadonlySet<string>
  /** Task 10: animation of the beat being spoken. Static rendering ignores it. */
  animating?: { beatId: string; timing: BeatTiming }
  /** Bumped by the player on replay/resume: re-keys the animating beat's elements so their animations restart. */
  playToken?: number
  /** Freezes running animations (CSS animation-play-state). */
  paused?: boolean
  speed: number
  selected?: string
  /** Controlled explore slider values by explore id; when given, `onParamChange` reports edits instead of Board keeping them. */
  params?: Record<string, ParamValues>
  onParamChange?(id: string, name: string, v: number): void
  onSelect(id: string | undefined): void
  onAskAbout?(id: string): void
  onReport?(id: string): void
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

/** Order of the board's tab stops: reading order (y, then x); popover buttons right after their element. */
function readingOrder(root: HTMLElement): HTMLElement[] {
  const stops = Array.from(root.querySelectorAll<HTMLElement>('[data-el], .popover button, [data-el] input'))
  const key = (e: HTMLElement) => {
    const own = e.closest<HTMLElement>('[data-ox]')!
    return { y: Number(own.dataset.oy), x: Number(own.dataset.ox), seq: Number(e.dataset.seq ?? 0) }
  }
  return stops
    .map((e, i) => ({ e, i, k: key(e) }))
    .sort((a, b) => a.k.y - b.k.y || a.k.x - b.k.x || a.k.seq - b.k.seq || a.i - b.i)
    .map((o) => o.e)
}

export function Board(props: BoardProps) {
  const { pages, pageIndex, visibleBeats, selected, onSelect, index, viewport, answer, animating, playToken = 0, paused, onAskAbout, onReport } = props
  const { w: lw, h: lh } = BOARD[viewport]
  const outer = useRef<HTMLDivElement>(null)
  const width = useWidth(outer)
  const s = width > 0 ? width / lw : 1
  const [localEdits, setEdits] = useState<Record<string, ParamValues>>({})
  const edits = props.params ?? localEdits
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
  const { notes, labels } = useMemo(() => layoutNotes(shown, lw, lh, params), [shown, lw, lh, params])
  const reduced = useMemo(prefersReducedMotion, [])

  const animIndex = useMemo(() => {
    const m = new Map<string, number>()
    if (!animating) return m
    for (const it of shown) if (it.beatId === animating.beatId && !it.reprise) m.set(it.id, it.actionIndex)
    return m
  }, [shown, animating])
  const animOf = useCallback(
    (it: Placed, layer: 'html' | 'svg' = 'svg') => {
      const i = animIndex.get(it.id)
      if (!animating || i === undefined) return undefined
      return makeAnim(kindOf(it.action, layer), i, animating.timing, reduced, playToken)
    },
    [animIndex, animating, reduced, playToken],
  )
  const keyOf = (it: Placed) => (animIndex.has(it.id) ? `${it.id}:${playToken}` : it.id)

  const ctx: ViewCtx = {
    index, selected, onSelect, animOf,
    noteOf: (id) => notes.get(id) ?? { x: 0, y: 0, w: 160, h: 50 },
    labels,
    kidsOf: (id) => shown.filter((i) => isInplot(i) && i.parent === id),
    params,
    setParam: (id, name, v) => {
      if (props.params) props.onParamChange?.(id, name, v)
      else setEdits((e) => ({ ...e, [id]: { ...e[id], [name]: v } }))
    },
  }
  const html = shown.filter(inHtmlLayer)
  const svg = shown.filter(inSvgLayer)

  const selItem = selected ? shown.find((i) => i.id === selected) : undefined
  const anchor = useMemo<Box | undefined>(() => {
    if (!selItem) return undefined
    const parent = selItem.parent ? shown.find((i) => i.id === selItem.parent) : undefined
    return selItem.region === 'inplot' && parent ? markTargetBox(selItem, parent) : selItem.box
  }, [selItem, shown])

  // A pointer press focuses an element from outside; that must not be redirected like a Tab entry.
  const pointer = useRef(false)
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const root = outer.current
    if (!root || pointer.current || (e.relatedTarget && root.contains(e.relatedTarget as Node))) return
    const stops = readingOrder(root)
    const from = e.relatedTarget as Node | null
    const backwards = from ? !!(root.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING) : false
    const want = backwards ? stops[stops.length - 1] : stops[0]
    if (want && want !== e.target) want.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && selected) {
      e.preventDefault()
      onSelect(undefined)
      const el = Array.from(outer.current?.querySelectorAll<HTMLElement>('[data-el]') ?? []).find((n) => n.dataset.el === selected)
      el?.focus()
      return
    }
    if (e.key !== 'Tab' || !outer.current) return
    const stops = readingOrder(outer.current)
    const at = stops.indexOf(e.target as HTMLElement)
    const next = stops[at + (e.shiftKey ? -1 : 1)]
    if (at < 0 || !next) return // at either end Tab leaves the board
    e.preventDefault()
    next.focus()
  }

  return (
    <div
      ref={outer}
      className={`board-outer${paused ? ' paused' : ''}`}
      style={{ height: lh * s }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onPointerDown={() => { pointer.current = true; setTimeout(() => { pointer.current = false }, 0) }}
    >
      <div className={`board board-${viewport}`} style={{ width: lw, height: lh, transform: `scale(${s})`, ['--board-scale' as string]: s }}>
        {answer && <div className="answer-panel" style={{ left: answer.panel.x, top: answer.panel.y, width: answer.panel.w, height: answer.panel.h }} />}
        <div className="layer layer-html">
          {html.map((it) => <HtmlElement key={keyOf(it)} item={it} ctx={ctx} />)}
        </div>
        <svg className="layer layer-svg" viewBox={`0 0 ${lw} ${lh}`} width={lw} height={lh}>
          {svg.map((it) => <SvgElement key={keyOf(it)} item={it} ctx={ctx} />)}
        </svg>
        {selected && anchor && (
          <Popover id={selected} anchor={anchor} board={{ w: lw, h: lh }} scale={s} onAskAbout={onAskAbout} onReport={onReport} />
        )}
      </div>
    </div>
  )
}
