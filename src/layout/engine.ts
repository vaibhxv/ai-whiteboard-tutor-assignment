import type { Action, PlanRecord } from '../actions'
import type { Beat } from '../pipeline/beats'
import { boardBox, EXPLORE_PARAM_H, GAP, geometry } from './constants'
import type { Geometry } from './constants'
import { markGeometry, markTargetBox } from './marks'
import type { Box, Measurer, Page, Placed, Template, Viewport } from './types'

type Representation = Extract<PlanRecord, { t: 'segment' }>['representation']
type Ink = Placed['ink']
/** What placement needs from a beat; reprises reuse it with the figure and its inplot children. */
type BeatLike = { id: string; ink: Ink; actions: readonly Action[] }

export function templateFor(representation: Representation): Template {
  return representation === 'graph' || representation === 'table' || representation === 'numberline' ? 'split' : 'notes'
}

/** Marks carry no id of their own; this one is deterministic and unique per beat action. */
export const markId = (beatId: string, actionIndex: number): string => `${beatId}~m${actionIndex}`

const isPlotLike = (a: Action) => a.t === 'plot' || a.t === 'explore'
const isFigure = (a: Action) => isPlotLike(a) || a.t === 'table' || a.t === 'numberline'
/** Not drawn by the layout: `say` is speech, `page` only breaks pages, `check`/`ask` live in the side panel. */
const UNPLACED = new Set<Action['t']>(['say', 'page', 'check', 'ask'])

type Build = { page: Page; geo: Geometry; cursor: number; figureTaken: boolean }
type Trial = { ok: boolean; items: Placed[]; dropped: string[]; cursor: number; figureTaken: boolean }
type Slot = { a: Action; i: number; kind: 'flow' | 'figure' | 'inplot' | 'mark'; x: number; w: number; h: number }

function newBuild(index: number, segKey: string, template: Template, vp: Viewport): Build {
  const geo = geometry(template, vp)
  return { page: { index, segKey, template, items: [], beatIds: [], dropped: [] }, geo, cursor: geo.top, figureTaken: false }
}

/** Decides where each action goes and its natural size; null when the beat needs a second figure region. */
function plan(b: Build, actions: readonly Action[], m: Measurer, force: boolean): Slot[] | null {
  const { geo } = b
  const slots: Slot[] = []
  let taken = b.figureTaken
  const flowFigW = Math.min(geo.flowFigW, geo.colW)
  const flowFigX = geo.colX + (geo.colW - flowFigW) / 2
  for (const [i, a] of actions.entries()) {
    if (UNPLACED.has(a.t)) continue
    if (a.t === 'point' || a.t === 'line' || a.t === 'guide') { slots.push({ a, i, kind: 'inplot', x: 0, w: 0, h: 0 }); continue }
    if (a.t === 'mark') { slots.push({ a, i, kind: 'mark', x: 0, w: 0, h: 0 }); continue }
    if (isFigure(a)) {
      const fig = geo.figure
      if (fig && !taken) {
        taken = true
        const h = isPlotLike(a) ? fig.h : Math.min(m.measure(a, fig.w).h, fig.h)
        slots.push({ a, i, kind: 'figure', x: fig.x, w: fig.w, h })
        continue
      }
      // Split page whose figure region is used: a second plot/explore needs a new page.
      if (fig && isPlotLike(a) && !force) return null
      const h = a.t === 'plot' ? geo.flowPlotH
        : a.t === 'explore' ? geo.flowPlotH + EXPLORE_PARAM_H * a.params.length
        : m.measure(a, flowFigW).h
      slots.push({ a, i, kind: 'flow', x: flowFigX, w: flowFigW, h })
      continue
    }
    const size = m.measure(a, geo.colW)
    slots.push({ a, i, kind: 'flow', x: geo.colX, w: Math.min(size.w, geo.colW), h: size.h })
  }
  return slots
}

/**
 * Tries to place a whole beat on the page without mutating it. With `force` (an otherwise empty
 * page) it always succeeds: a second plot goes into the flow and flow heights shrink to fit.
 */
function placeBeat(b: Build, beat: BeatLike, m: Measurer, vp: Viewport, force: boolean): Trial {
  const fail: Trial = { ok: false, items: [], dropped: [], cursor: b.cursor, figureTaken: b.figureTaken }
  const slots = plan(b, beat.actions, m, force)
  if (!slots) return fail
  const flow = slots.filter((s) => s.kind === 'flow')
  const need = flow.reduce((sum, s) => sum + s.h, 0)
  const room = b.geo.bottom - b.cursor - GAP * Math.max(0, flow.length - 1)
  let scale = 1
  if (flow.length > 0 && need > room) {
    if (!force) return fail
    scale = Math.max(0, room) / need
  }

  const items: Placed[] = []
  const dropped: string[] = []
  const bounds = boardBox(vp)
  const find = (id: string): Placed | undefined =>
    items.find((p) => p.id === id && p.region !== 'overlay') ??
    b.page.items.find((p) => p.id === id && p.region !== 'overlay')
  const put = (a: Action, id: string, box: Box, region: Placed['region'], parent?: string) =>
    items.push({ id, action: a, box, beatId: beat.id, ink: beat.ink, region, ...(parent === undefined ? {} : { parent }) })

  let cursor = b.cursor
  let figureTaken = b.figureTaken
  for (const s of slots) {
    const a = s.a
    if (s.kind === 'figure' && b.geo.figure && 'id' in a) {
      figureTaken = true
      put(a, a.id, { x: s.x, y: b.geo.figure.y, w: s.w, h: s.h }, 'figure')
    } else if (s.kind === 'flow' && 'id' in a) {
      const h = s.h * scale
      put(a, a.id, { x: s.x, y: cursor, w: s.w, h }, 'notes')
      cursor += h + GAP
    } else if ((a.t === 'point' || a.t === 'line' || a.t === 'guide')) {
      const parent = find(a.plot)
      if (parent && isPlotLike(parent.action)) put(a, a.id, parent.box, 'inplot', a.plot)
      else dropped.push(a.id)
    } else if (a.t === 'mark') {
      const id = markId(beat.id, s.i)
      const target = find(a.target)
      if (!target) { dropped.push(id); continue }
      const parent = target.region === 'inplot' && target.parent !== undefined ? find(target.parent) : undefined
      put(a, id, markGeometry(a.kind, markTargetBox(target, parent), bounds).shape, 'overlay')
    }
  }
  return { ok: true, items, dropped, cursor, figureTaken }
}

function commit(b: Build, t: Trial, beatId?: string, reprise = false): void {
  b.page.items.push(...(reprise ? t.items.map((p) => ({ ...p, reprise: true })) : t.items))
  b.page.dropped.push(...t.dropped)
  if (beatId !== undefined) b.page.beatIds.push(beatId)
  b.cursor = t.cursor
  b.figureTaken = t.figureTaken
}

/**
 * Lays out segments onto pages. Each segment starts a new page. A beat is never split: when it does
 * not fit (or needs a second figure region on a split page) it moves to a new page, which first
 * shows a reprise of the most recent figure of the segment, with that figure's inplot items.
 * A `page` action starts a new page (no reprise), with `page.layout` as its template if given.
 */
export function paginate(segs: { segKey: string; template: Template; beats: Beat[] }[], m: Measurer, vp: Viewport): Page[] {
  const pages: Page[] = []
  for (const seg of segs) {
    let cur = newBuild(pages.length, seg.segKey, seg.template, vp)
    pages.push(cur.page)
    let lastFig: Placed | undefined
    const children = new Map<string, Placed[]>()
    const replaceCur = (next: Build) => { cur = next; pages[pages.length - 1] = next.page }

    for (const beat of seg.beats) {
      const pageAct = beat.actions.filter((a) => a.t === 'page').pop()
      if (pageAct) {
        const tpl = pageAct.layout ?? cur.page.template
        if (cur.page.beatIds.length > 0) { cur = newBuild(pages.length, seg.segKey, tpl, vp); pages.push(cur.page) }
        else replaceCur(newBuild(cur.page.index, seg.segKey, tpl, vp))
        lastFig = undefined
      }
      let t = placeBeat(cur, beat, m, vp, false)
      if (!t.ok && cur.page.beatIds.length > 0) {
        const tpl = cur.page.template
        const fig = lastFig
        // On a split page a beat bringing its own plot needs the figure region, so no reprise.
        const reprise = fig !== undefined && !(geometry(tpl, vp).figure && beat.actions.some(isPlotLike))
        let next = newBuild(pages.length, seg.segKey, tpl, vp)
        if (reprise && fig) {
          const kids = children.get(fig.id) ?? []
          const shown = { id: beat.id, ink: fig.ink, actions: [fig.action, ...kids.map((k) => k.action)] }
          commit(next, placeBeat(next, shown, m, vp, true), undefined, true)
          t = placeBeat(next, beat, m, vp, false)
          if (!t.ok) next = newBuild(pages.length, seg.segKey, tpl, vp)
        }
        if (!reprise || !t.ok) t = placeBeat(next, beat, m, vp, false)
        cur = next
        pages.push(cur.page)
      }
      if (!t.ok) t = placeBeat(cur, beat, m, vp, true)
      commit(cur, t, beat.id)
      for (const it of t.items) {
        if (isFigure(it.action)) lastFig = it
        if (it.region === 'inplot' && it.parent !== undefined) {
          const list = children.get(it.parent) ?? []
          list.push(it)
          children.set(it.parent, list)
        }
      }
    }
  }
  return pages
}
