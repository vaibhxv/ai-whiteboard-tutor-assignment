import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { Board } from '../../../src/board/Board'
import { paginate } from '../../../src/layout/engine'
import type { Page } from '../../../src/layout/types'
import type { Beat } from '../../../src/pipeline/beats'
import { createBoardPipeline } from '../../../src/pipeline/board-pipeline'
import { fake } from '../layout/fake'

type Fixture = { responses: { 'segment:1': { text: string } } }
const fixture = JSON.parse(readFileSync('tests/fixtures/lessons/vertex.fixture.json', 'utf8')) as Fixture

function build(text: string) {
  const index = new Map<string, Action>()
  const beats: Beat[] = []
  const p = createBoardPipeline({
    segKey: 'segment:1', mode: 'board', ink: 'lesson', index,
    onBeat: (b) => beats.push(b), onCheck: () => {}, onAsk: () => {}, onReject: () => {},
  })
  p.push(text)
  p.end('end')
  const pages = paginate([{ segKey: 'segment:1', template: 'split', beats }], fake, 'wide')
  return { index, beats, pages }
}

const props = (pages: Page[], index: Map<string, Action>, visible: Set<string>, pageIndex = 0) => ({
  pages, pageIndex, visibleBeats: visible, speed: 1, onSelect: () => {}, index, viewport: 'wide' as const,
})

describe('Board', () => {
  const { index, beats, pages } = build(fixture.responses['segment:1'].text)
  const all = new Set(beats.map((b) => b.id))

  test('renders every element of the vertex fixture with an aria-label and data-el', () => {
    const { container } = render(<Board {...props(pages, index, all)} />)
    const ids = pages[0]!.items.map((i) => i.id)
    expect(ids.length).toBeGreaterThan(8)
    for (const id of ids) {
      const el = container.querySelector(`[data-el="${id}"]`)
      expect(el, id).not.toBeNull()
      expect(el?.getAttribute('aria-label') ?? '', id).not.toBe('')
      expect(el?.getAttribute('tabindex')).toBe('0')
    }
    expect(container.querySelector('path[d*="NaN"]')).toBeNull()
  })

  test('hidden beats render nothing', () => {
    const { container } = render(<Board {...props(pages, index, new Set())} />)
    expect(container.querySelectorAll('[data-el]')).toHaveLength(0)
    const first = new Set([beats[0]!.id])
    const r = render(<Board {...props(pages, index, first)} />)
    expect(r.container.querySelectorAll('[data-el]').length).toBe(1)
  })

  test('a passed maths line shows a checked-by-code badge; unchecked maths shows "not checked"', () => {
    const { container } = render(<Board {...props(pages, index, all)} />)
    const badge = container.querySelector('[data-el="roots"] [title="Checked by code"]')
    expect(badge?.textContent).toContain('✓')
    expect(badge?.getAttribute('aria-label')?.toLowerCase()).toContain('checked by code')
    expect(container.querySelector('[data-el="eq1"]')?.textContent).toContain('not checked')
    // a plot and a verified point have no badge
    expect(container.querySelector('[data-el="r1"] .badge')).toBeNull()
    expect(container.querySelector('[data-el="p1"] [title="Checked by code"]')).toBeNull()
  })

  test('a failed step shows "May be wrong" with evidence', () => {
    const idx = new Map<string, Action>()
    const bs: Beat[] = []
    const p = createBoardPipeline({
      segKey: 's', mode: 'board', ink: 'lesson', index: idx,
      onBeat: (b) => bs.push(b), onCheck: () => {}, onAsk: () => {}, onReject: () => {},
    })
    p.push([
      '{"t":"say","text":"Factor it."}',
      '{"t":"math","id":"m1","latex":"x^2-4x+3","expr":"x^2-4*x+3"}',
      '{"t":"step","id":"s1","latex":"(x-1)(x+3)","expr":"(x-1)*(x+3)","why":"factor","from":"m1"}',
    ].join('\n'))
    p.end('end')
    const pg = paginate([{ segKey: 's', template: 'notes', beats: bs }], fake, 'wide')
    render(<Board {...props(pg, idx, new Set(bs.map((b) => b.id)))} />)
    expect(screen.getByText(/May be wrong/)).toBeInTheDocument()
    expect(screen.getByText(/May be wrong/).closest('[title]')?.getAttribute('title')?.length).toBeGreaterThan(5)
  })

  test('model text with markup renders as literal text', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const a: Action = { t: 'write', id: 'w1', text: evil }
    const idx = new Map<string, Action>([['w1', a]])
    const b: Beat = { id: 'b#0', say: '', ink: 'lesson', actions: [{ ...a, verify: { status: 'unchecked' } }] }
    const pg = paginate([{ segKey: 'b', template: 'notes', beats: [b] }], fake, 'wide')
    const { container } = render(<Board {...props(pg, idx, new Set(['b#0']))} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain(evil)
  })
})
