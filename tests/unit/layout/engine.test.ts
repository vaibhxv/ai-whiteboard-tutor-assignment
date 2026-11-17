import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { BOARD } from '../../../src/layout/constants'
import { paginate, templateFor } from '../../../src/layout/engine'
import type { Box, Page, Placed } from '../../../src/layout/types'
import type { Beat } from '../../../src/pipeline/beats'
import {
  allItems, beat, fake, inside, mark, noOverlap, plot, pt, spikeBeats, w,
} from './fake'

const WIDE: Box = { x: 0, y: 0, w: BOARD.wide.w, h: BOARD.wide.h }
const NARROW: Box = { x: 0, y: 0, w: BOARD.narrow.w, h: BOARD.narrow.h }
const find = (p: Page | undefined, id: string): Placed | undefined => p?.items.find((i) => i.id === id)

describe('templateFor', () => {
  test('graph/table/numberline → split; worked/analogy → notes', () => {
    expect(templateFor('graph')).toBe('split')
    expect(templateFor('table')).toBe('split')
    expect(templateFor('numberline')).toBe('split')
    expect(templateFor('worked')).toBe('notes')
    expect(templateFor('analogy')).toBe('notes')
  })
})

describe('paginate', () => {
  test('spike segment, split, wide: one page; no two notes/figure boxes intersect; all boxes inside 1200×750', () => {
    const pages = paginate([{ segKey: 'seg:1', template: 'split', beats: spikeBeats() }], fake, 'wide')
    expect(pages).toHaveLength(1)
    const p = pages[0] as Page
    expect(p.beatIds).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => `seg:1#${n}`))
    expect(p.dropped).toEqual([])
    expect(noOverlap(p.items)).toBe(true)
    for (const it of p.items) expect(inside(it.box, WIDE)).toBe(true)
    expect(find(p, 'p1')).toMatchObject({ region: 'figure', box: { x: 640, y: 40, w: 520, h: 670 } })
    for (const id of ['eq1', 'fac', 'roots', 'axis', 'sub']) {
      const b = find(p, id)?.box as Box
      expect(b.x).toBeGreaterThanOrEqual(40)
      expect(b.x + b.w).toBeLessThanOrEqual(600)
    }
    expect(find(p, 'r1')).toMatchObject({ region: 'inplot', parent: 'p1', box: find(p, 'p1')?.box })
  })

  test('mark on a point circles the point, not the plot; mark on notes underlines the target', () => {
    const [p] = paginate([{ segKey: 'seg:1', template: 'split', beats: spikeBeats() }], fake, 'wide')
    const marks = (p as Page).items.filter((i) => i.region === 'overlay')
    expect(marks).toHaveLength(2)
    const circle = marks.find((i) => i.action.t === 'mark' && i.action.kind === 'circle') as Placed
    expect(circle.box.w).toBeLessThan(60)
    expect(circle.box.h).toBeLessThan(60)
    const under = marks.find((i) => i.action.t === 'mark' && i.action.kind === 'underline') as Placed
    const roots = find(p, 'roots')?.box as Box
    expect(under.box.h).toBe(6)
    expect(under.box.y).toBeGreaterThanOrEqual(roots.y + roots.h)
    expect(new Set(marks.map((i) => i.id)).size).toBe(2)
  })

  test('a mark on a curve id sits on the curve inside the plot; a curve with no visible point drops the mark', () => {
    const empty: Action = { t: 'plot', id: 'pe', x: [0, 4], y: [10, 20], fns: [{ id: 'pef', expr: 'x' }] }
    const [p] = paginate([{ segKey: 'seg:1', template: 'split', beats: [beat('seg:1#0', [plot('p1')]), beat('seg:1#1', [mark('p1f')])] }], fake, 'wide')
    const plotBox = find(p, 'p1')?.box as Box
    const marks = (p as Page).items.filter((i) => i.region === 'overlay')
    expect(marks).toHaveLength(1)
    const circle = marks[0] as Placed
    expect(circle.box.w).toBeLessThan(60)
    expect(inside(circle.box, plotBox)).toBe(true)
    const [q] = paginate([{ segKey: 'seg:1', template: 'split', beats: [beat('seg:1#0', [empty, mark('pef')])] }], fake, 'wide')
    expect((q as Page).items.filter((i) => i.region === 'overlay')).toHaveLength(0)
    expect((q as Page).dropped).toHaveLength(1)
  })

  test('same at narrow: everything in one column inside 600×1000', () => {
    const pages = paginate([{ segKey: 'seg:1', template: 'split', beats: spikeBeats() }], fake, 'narrow')
    for (const p of pages) {
      expect(noOverlap(p.items)).toBe(true)
      for (const it of p.items) {
        expect(inside(it.box, NARROW)).toBe(true)
        if (it.region === 'notes' || it.region === 'figure') {
          expect(it.region).toBe('notes')
          expect(it.box.x).toBeGreaterThanOrEqual(20)
          expect(it.box.x + it.box.w).toBeLessThanOrEqual(580)
        }
      }
    }
    const plotItem = allItems(pages).find((i) => i.id === 'p1') as Placed
    expect(plotItem.box).toMatchObject({ x: 20, w: 560, h: 340 })
  })

  test('40 write actions overflow → ≥2 pages, page 2 starts with a reprise of the plot, beats never split across pages', () => {
    const beats: Beat[] = [beat('s#0', [plot('p1'), pt('a1', 'p1', [1, 1])])]
    for (let i = 0; i < 40; i++) beats.push(beat(`s#${i + 1}`, [w(`w${i}`)]))
    const pages = paginate([{ segKey: 's', template: 'split', beats }], fake, 'wide')
    expect(pages.length).toBeGreaterThanOrEqual(2)
    const p2 = pages[1] as Page
    expect(p2.items[0]).toMatchObject({ id: 'p1', reprise: true, region: 'figure', beatId: p2.beatIds[0] })
    expect(find(p2, 'a1')).toMatchObject({ reprise: true, region: 'inplot', parent: 'p1' })
    // every beat on exactly one page, and every non-reprise item lives on its beat's page
    const seen = pages.flatMap((p) => p.beatIds)
    expect(seen).toEqual(beats.map((b) => b.id))
    for (const p of pages) {
      expect(noOverlap(p.items)).toBe(true)
      for (const it of p.items) {
        expect(p.beatIds).toContain(it.beatId)
        expect(inside(it.box, WIDE)).toBe(true)
      }
      expect(p.index).toBe(pages.indexOf(p))
    }
    const ids = pages.flatMap((p) => p.items.filter((i) => !i.reprise).map((i) => i.id))
    expect(ids.filter((id) => id.startsWith('w'))).toHaveLength(40)
  })

  test('overflow in notes template reprises the figure at the top of the flow', () => {
    const beats: Beat[] = [beat('s#0', [plot('p1')])]
    for (let i = 0; i < 30; i++) beats.push(beat(`s#${i + 1}`, [w(`w${i}`)]))
    const pages = paginate([{ segKey: 's', template: 'notes', beats }], fake, 'wide')
    expect(pages.length).toBeGreaterThanOrEqual(2)
    const p2 = pages[1] as Page
    expect(p2.items[0]).toMatchObject({ id: 'p1', reprise: true, region: 'notes', box: { x: 280, y: 40, w: 640, h: 360 } })
    for (const p of pages) expect(noOverlap(p.items)).toBe(true)
  })

  test('a mark on a page-2 beat can circle a reprised point', () => {
    const beats: Beat[] = [beat('s#0', [plot('p1'), pt('a1', 'p1', [1, 1])])]
    for (let i = 0; i < 14; i++) beats.push(beat(`s#${i + 1}`, [w(`w${i}`)]))
    beats.push(beat('s#99', [w('late'), mark('a1')]))
    const pages = paginate([{ segKey: 's', template: 'split', beats }], fake, 'wide')
    const last = pages[pages.length - 1] as Page
    expect(last.beatIds).toContain('s#99')
    const circle = last.items.find((i) => i.region === 'overlay') as Placed
    expect(circle).toBeDefined()
    expect(circle.box.w).toBeLessThan(60)
    expect(last.dropped).toEqual([])
  })

  test('explore in the flow adds 56 px per param', () => {
    const ex = { t: 'explore' as const, id: 'e1', x: [-5, 5] as [number, number], y: [-5, 5] as [number, number], expr: 'a*x', prompt: 'p',
      params: [{ name: 'a', min: 0, max: 2, start: 1 }, { name: 'b', min: 0, max: 2, start: 1 }] }
    const narrow = paginate([{ segKey: 's', template: 'notes', beats: [beat('s#0', [ex])] }], fake, 'narrow')
    expect(find(narrow[0], 'e1')?.box.h).toBe(340 + 112)
    const wide = paginate([{ segKey: 's', template: 'notes', beats: [beat('s#0', [ex])] }], fake, 'wide')
    expect(find(wide[0], 'e1')?.box).toEqual({ x: 280, y: 40, w: 640, h: 360 + 112 })
  })

  test('second plot on a split page starts a new page', () => {
    const beats = [beat('s#0', [plot('p1'), w('a')]), beat('s#1', [plot('p2'), pt('q', 'p2', [0, 0])])]
    const pages = paginate([{ segKey: 's', template: 'split', beats }], fake, 'wide')
    expect(pages).toHaveLength(2)
    expect(pages[0]?.beatIds).toEqual(['s#0'])
    expect(pages[1]?.beatIds).toEqual(['s#1'])
    expect(find(pages[1], 'p2')).toMatchObject({ region: 'figure', box: { x: 640, y: 40, w: 520, h: 670 } })
    expect(pages[1]?.items.some((i) => i.reprise)).toBe(false)
  })

  test('a table goes to the figure region when empty, else into the notes flow', () => {
    const table = (id: string) => ({ t: 'table' as const, id, head: ['x', 'y'], rows: [['1', '2']] })
    const pages = paginate([{ segKey: 's', template: 'split', beats: [beat('s#0', [plot('p1')]), beat('s#1', [table('t1')])] }], fake, 'wide')
    expect(pages).toHaveLength(1)
    expect(find(pages[0], 't1')?.region).toBe('notes')
    const solo = paginate([{ segKey: 's', template: 'split', beats: [beat('s#0', [table('t1')])] }], fake, 'wide')
    expect(find(solo[0], 't1')).toMatchObject({ region: 'figure', box: { x: 640, y: 40, w: 520 } })
  })

  test('page action forces a new page with its layout; page itself is not placed', () => {
    const beats = [beat('s#0', [w('a')]), beat('s#1', [{ t: 'page', layout: 'notes' }, w('b')])]
    const pages = paginate([{ segKey: 's', template: 'split', beats }], fake, 'wide')
    expect(pages.map((p) => p.template)).toEqual(['split', 'notes'])
    expect(pages[1]?.items.map((i) => i.id)).toEqual(['b'])
  })

  test('each segment starts a new page; say-only beats belong to the page; unresolved refs are dropped', () => {
    const pages = paginate([
      { segKey: 'a', template: 'split', beats: [beat('a#0', [plot('p1')])] },
      { segKey: 'b', template: 'notes', beats: [beat('b#0', []), beat('b#1', [pt('z', 'p1', [1, 1]), mark('nope')])] },
    ], fake, 'wide')
    expect(pages.map((p) => p.segKey)).toEqual(['a', 'b'])
    expect(pages[1]?.beatIds).toEqual(['b#0', 'b#1'])
    expect(pages[1]?.items).toEqual([])
    expect(pages[1]?.dropped).toHaveLength(2)
    expect(pages[1]?.dropped).toContain('z')
  })

  test('a beat with no flow items stays on a page whose flow is exactly full', () => {
    const full = { measure: () => ({ w: 500, h: 670 }) }
    const beats = [beat('s#0', [w('a')]), beat('s#1', []), beat('s#2', [mark('a', 'box')])]
    const pages = paginate([{ segKey: 's', template: 'notes', beats }], full, 'wide')
    expect(pages).toHaveLength(1)
    expect(pages[0]?.beatIds).toEqual(['s#0', 's#1', 's#2'])
  })

  test('paginate is pure: same input → deep-equal output', () => {
    const beats: Beat[] = [...spikeBeats()]
    for (let i = 0; i < 25; i++) beats.push(beat(`seg:1#${i + 7}`, [w(`w${i}`), mark(`w${i}`, 'box')]))
    const segs = [{ segKey: 'seg:1', template: 'split' as const, beats }]
    const before = JSON.stringify(segs)
    const a = paginate(segs, fake, 'wide')
    const b = paginate(segs, fake, 'wide')
    expect(a).toEqual(b)
    expect(JSON.stringify(segs)).toBe(before)
  })

  test('a beat too tall for an empty page still stays inside the board', () => {
    const long = 'word '.repeat(24)
    const beats = [beat('s#0', [w('a', long.repeat(1)), w('b', long), w('c', long)])]
    const tall = { measure: () => ({ w: 500, h: 400 }) }
    const pages = paginate([{ segKey: 's', template: 'notes', beats }], tall, 'wide')
    expect(pages).toHaveLength(1)
    for (const it of allItems(pages)) {
      expect(inside(it.box, { x: 40, y: 40, w: 1120, h: 670 })).toBe(true)
      // content is scaled to its box, preserving aspect: box = measured size × fit
      expect(it.fit).toBeDefined()
      expect(it.fit as number).toBeGreaterThanOrEqual(0.25)
      expect(it.fit as number).toBeLessThan(1)
      expect(it.box.h).toBeCloseTo(400 * (it.fit as number))
      expect(it.box.w).toBeCloseTo(500 * (it.fit as number))
    }
    expect(noOverlap(allItems(pages))).toBe(true)
  })

  test('fit never drops below 0.25; normal beats carry no fit', () => {
    const huge = { measure: () => ({ w: 500, h: 5000 }) }
    const pages = paginate([{ segKey: 's', template: 'notes', beats: [beat('s#0', [w('a')])] }], huge, 'wide')
    expect(find(pages[0], 'a')?.fit).toBe(0.25)
    const normal = paginate([{ segKey: 'seg:1', template: 'split', beats: spikeBeats() }], fake, 'wide')
    for (const it of allItems(normal)) expect('fit' in it).toBe(false)
  })

  test('a point or mark that precedes its plot in the same beat is dropped, without throwing', () => {
    const beats = [beat('s#0', [pt('early', 'p1', [1, 1]), mark('p1'), plot('p1')])]
    const pages = paginate([{ segKey: 's', template: 'split', beats }], fake, 'wide')
    expect(pages[0]?.dropped).toEqual(['early', 's#0~m1'])
    expect(pages[0]?.items.map((i) => i.id)).toEqual(['p1'])
  })

  test('placed actions keep their verification', () => {
    const [p] = paginate([{ segKey: 'seg:1', template: 'split', beats: spikeBeats() }], fake, 'wide')
    expect(find(p, 'eq1')?.action.verify).toEqual({ status: 'unchecked' })
  })
})
