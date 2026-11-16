import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Board, NARROW_MIN_H } from '../../../src/board/Board'
import type { Page, Placed } from '../../../src/layout/types'
import { chk } from '../layout/fake'

const item = (id: string, beatId: string, y: number, h = 40): Placed => ({
  id, action: chk({ t: 'write', id, text: id }), box: { x: 20, y, w: 300, h }, beatId, actionIndex: 0, ink: 'lesson', region: 'notes',
})
const page = (index: number, items: Placed[]): Page => ({
  index, segKey: 'seg:1', template: 'notes', items, beatIds: [...new Set(items.map((i) => i.beatId))], dropped: [],
})
const outerH = (c: HTMLElement) => (c.querySelector('.board-outer') as HTMLElement).style.height

describe('Board rendered height', () => {
  const pages = [page(0, [item('a', 'b0', 20), item('b', 'b1', 500), item('c', 'b2', 860, 100)]), page(1, [item('d', 'b3', 20)])]
  const props = { speed: 1, index: new Map(), onSelect: () => {} }

  test('narrow: as tall as the content drawn so far (min 360), growing beat by beat, capped at 1000', () => {
    const { container, rerender } = render(<Board {...props} viewport="narrow" pages={pages} pageIndex={0} visibleBeats={new Set(['b0'])} />)
    expect(outerH(container)).toBe(`${NARROW_MIN_H}px`) // one line: the minimum
    rerender(<Board {...props} viewport="narrow" pages={pages} pageIndex={0} visibleBeats={new Set(['b0', 'b1'])} />)
    expect(outerH(container)).toBe('560px') // 500 + 40 + 20 margin
    rerender(<Board {...props} viewport="narrow" pages={pages} pageIndex={0} visibleBeats={new Set(['b0', 'b1', 'b2'])} />)
    expect(outerH(container)).toBe('980px')
    // A future beat is not counted, and the height never shrinks within the page.
    rerender(<Board {...props} viewport="narrow" pages={pages} pageIndex={0} visibleBeats={new Set(['b0'])} />)
    expect(outerH(container)).toBe('980px')
    // A new page starts over.
    rerender(<Board {...props} viewport="narrow" pages={pages} pageIndex={1} visibleBeats={new Set(['b0', 'b1', 'b2', 'b3'])} />)
    expect(outerH(container)).toBe(`${NARROW_MIN_H}px`)
  })

  test('wide: full height; maxHeight scales the board down keeping its aspect', () => {
    const { container, rerender } = render(<Board {...props} viewport="wide" pages={pages} pageIndex={0} visibleBeats={new Set(['b0'])} />)
    expect(outerH(container)).toBe('750px')
    rerender(<Board {...props} viewport="wide" pages={pages} pageIndex={0} visibleBeats={new Set(['b0'])} maxHeight={300} />)
    const outer = container.querySelector('.board-outer') as HTMLElement
    expect(outer.style.height).toBe('300px')
    expect(outer.style.width).toBe('480px') // 1200 × 0.4
  })
})
