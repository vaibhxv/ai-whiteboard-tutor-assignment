import { readFileSync } from 'node:fs'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Action } from '../../../src/actions'
import { animStyle } from '../../../src/board/anim'
import { Board } from '../../../src/board/Board'
import type { BoardProps } from '../../../src/board/Board'
import { paginate } from '../../../src/layout/engine'
import type { BeatTiming } from '../../../src/player/durations'
import type { Beat } from '../../../src/pipeline/beats'
import { createBoardPipeline } from '../../../src/pipeline/board-pipeline'
import { fake } from '../layout/fake'

const fixture = JSON.parse(readFileSync('tests/fixtures/lessons/vertex.fixture.json', 'utf8')) as { responses: { 'segment:1': { text: string } } }
const index = new Map<string, Action>()
const beats: Beat[] = []
const pl = createBoardPipeline({
  segKey: 'segment:1', mode: 'board', ink: 'lesson', index,
  onBeat: (b) => beats.push(b), onCheck: () => {}, onAsk: () => {}, onReject: () => {},
})
pl.push(fixture.responses['segment:1'].text)
pl.end('end')
const pages = paginate([{ segKey: 'segment:1', template: 'split', beats }], fake, 'wide')
const all = new Set(beats.map((b) => b.id))
const timing = (n: number): BeatTiming => ({
  actionDelays: Array.from({ length: n }, (_, i) => 100 + i * 600),
  actionDurations: Array.from({ length: n }, () => 600),
  total: 100 + n * 600,
})
const base = (over: Partial<BoardProps> = {}): BoardProps => ({
  pages, pageIndex: 0, visibleBeats: all, speed: 1, onSelect: () => {}, index, viewport: 'wide', paused: false, ...over,
})
const mm = (matches: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))

afterEach(() => vi.unstubAllGlobals())

describe('draw-on animation', () => {
  const target = beats.find((b) => b.actions.length >= 2 && pages[0]!.items.some((i) => i.beatId === b.id && !i.reprise))!
  const upto = new Set(beats.slice(0, beats.indexOf(target) + 1).map((b) => b.id))

  test('animating beat elements get anim classes with --delay from timing; earlier beats are static', () => {
    const t = timing(target.actions.length)
    const { container } = render(<Board {...base({ visibleBeats: upto, animating: { beatId: target.id, timing: t }, playToken: 1 })} />)
    const mine = pages[0]!.items.filter((i) => i.beatId === target.id && !i.reprise && i.region !== 'inplot')
    expect(mine.length).toBeGreaterThan(0)
    mine.forEach((it, n) => {
      const el = container.querySelector(`[data-el="${it.id}"]`)!
      const cls = el.getAttribute('class') ?? ''
      expect(cls, it.id).toMatch(/anim-(wipe|stroke|plot|fade)/)
      const k = it.action.t === 'mark' ? Number(it.id.split('~m')[1]) : n
      expect((el as HTMLElement | SVGElement).style.getPropertyValue('--delay'), it.id).toBe(`${t.actionDelays[k]}ms`)
    })
    const earlier = pages[0]!.items.filter((i) => upto.has(i.beatId) && i.beatId !== target.id && i.region !== 'inplot')
    expect(earlier.length).toBeGreaterThan(0)
    for (const it of earlier) expect(container.querySelector(`[data-el="${it.id}"]`)!.getAttribute('class')).not.toMatch(/anim-/)
  })

  test('animStyle returns --delay and --d', () => {
    const s = animStyle(1, { actionDelays: [0, 700], actionDurations: [500, 900], total: 1600 }) as Record<string, string>
    expect(s['--delay']).toBe('700ms')
    expect(s['--d']).toBe('900ms')
  })

  test('reduced motion: every animation is a 150ms fade', () => {
    mm(true)
    const { container } = render(<Board {...base({ visibleBeats: upto, animating: { beatId: target.id, timing: timing(target.actions.length) }, playToken: 1 })} />)
    const animated = container.querySelectorAll('[class*="anim-"]')
    expect(animated.length).toBeGreaterThan(0)
    for (const el of animated) {
      expect(el.getAttribute('class')).toContain('anim-fade')
      expect((el as HTMLElement).style.getPropertyValue('--d')).toBe('150ms')
    }
  })

  test('paused prop sets the paused class; playToken restarts by remounting', () => {
    const t = timing(target.actions.length)
    const a = { beatId: target.id, timing: t }
    const { container, rerender } = render(<Board {...base({ visibleBeats: upto, animating: a, playToken: 1, paused: true })} />)
    expect(container.querySelector('.board-outer')!.classList.contains('paused')).toBe(true)
    const id = pages[0]!.items.find((i) => i.beatId === target.id && i.region !== 'inplot')!.id
    const before = container.querySelector(`[data-el="${id}"]`)
    rerender(<Board {...base({ visibleBeats: upto, animating: a, playToken: 2 })} />)
    expect(container.querySelector(`[data-el="${id}"]`)).not.toBe(before)
    expect(container.querySelector('.board-outer')!.classList.contains('paused')).toBe(false)
  })
})

describe('selection', () => {
  test('Enter and Space select; click selects; aria-pressed reflects selection', async () => {
    const onSelect = vi.fn()
    const first = pages[0]!.items.find((i) => ['write', 'math', 'step'].includes(i.action.t) && !i.reprise)!
    const { container, rerender } = render(<Board {...base({ onSelect })} />)
    const el = container.querySelector(`[data-el="${first.id}"]`) as HTMLElement
    expect(el.getAttribute('role')).toBe('button')
    expect(el.getAttribute('aria-pressed')).toBe('false')
    expect(el.getAttribute('aria-label')).toBeTruthy()
    el.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    fireEvent.click(el)
    expect(onSelect).toHaveBeenCalledTimes(3)
    expect(onSelect).toHaveBeenCalledWith(first.id)
    rerender(<Board {...base({ onSelect, selected: first.id })} />)
    expect(container.querySelector(`[data-el="${first.id}"]`)!.getAttribute('aria-pressed')).toBe('true')
  })

  test('marks are not selectable', () => {
    const mark = pages[0]!.items.find((i) => i.action.t === 'mark')
    if (!mark) return
    const onSelect = vi.fn()
    const { container } = render(<Board {...base({ onSelect })} />)
    fireEvent.click(container.querySelector(`[data-el="${mark.id}"]`)!)
    expect(onSelect).not.toHaveBeenCalled()
    expect(container.querySelector(`[data-el="${mark.id}"]`)!.hasAttribute('aria-pressed')).toBe(false)
  })

  test('selected element shows a popover with both actions; Escape closes it', async () => {
    const onAskAbout = vi.fn(), onReport = vi.fn(), onSelect = vi.fn()
    const first = pages[0]!.items.find((i) => ['write', 'math', 'step'].includes(i.action.t) && !i.reprise)!
    render(<Board {...base({ selected: first.id, onAskAbout, onReport, onSelect })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ask about this' }))
    expect(onAskAbout).toHaveBeenCalledWith(first.id)
    await userEvent.click(screen.getByRole('button', { name: 'Something looks wrong' }))
    expect(onReport).toHaveBeenCalledWith(first.id)
    await userEvent.keyboard('{Escape}')
    expect(onSelect).toHaveBeenCalledWith(undefined)
  })

  test('no popover without a selection', () => {
    render(<Board {...base()} />)
    expect(screen.queryByRole('button', { name: 'Ask about this' })).toBeNull()
  })
})

describe('keyboard order', () => {
  test('tab order follows y then x across both layers; popover follows its element', async () => {
    const sel = pages[0]!.items.find((i) => ['write', 'math', 'step'].includes(i.action.t) && !i.reprise)!
    const { container } = render(<Board {...base({ selected: sel.id })} />)
    const els = Array.from(container.querySelectorAll<HTMLElement>('[data-el]'))
    const expected = els
      .map((e, i) => ({ id: e.dataset.el!, y: Number(e.dataset.oy), x: Number(e.dataset.ox), i }))
      .sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i)
      .map((e) => e.id)
    // DOM order is not reading order (HTML layer first), so the test is meaningful
    expect(els.map((e) => e.dataset.el)).not.toEqual(expected)
    ;(container.querySelector('.board-outer') as HTMLElement).focus?.()
    const seen: string[] = []
    await userEvent.tab()
    for (let n = 0; n < 60; n++) {
      const a = document.activeElement as HTMLElement
      if (!container.contains(a)) break
      const name = a.dataset.el ?? `#${a.textContent}`
      if (seen.includes(name)) break // Tab wrapped round to the start
      seen.push(name)
      await userEvent.tab()
    }
    const withPopover: string[] = []
    for (const id of expected) { withPopover.push(id); if (id === sel.id) withPopover.push('#Ask about this', '#Something looks wrong') }
    expect(seen.filter((s) => !s.startsWith('#') || s.startsWith('#Ask') || s.startsWith('#Something'))).toEqual(withPopover.filter((s) => seen.includes(s)))
    expect(seen.indexOf('#Ask about this')).toBe(seen.indexOf(sel.id) + 1)
    expect(seen.length).toBeGreaterThanOrEqual(expected.length)
  })
})

