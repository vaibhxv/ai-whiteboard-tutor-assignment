import type { Box } from '../layout/types'

const GAP = 10
const MARGIN = 8
/** On-screen target size in CSS px; converted to board units with the board scale so it stays tappable. */
const SCREEN_W = 210
const SCREEN_H = 100

/** Floating "Ask about this" / "Something looks wrong" menu anchored under (or above) the selected element, clamped inside the board. */
export function Popover({ id, anchor, board, scale, onAskAbout, onReport }: {
  id: string
  anchor: Box
  board: { w: number; h: number }
  scale: number
  onAskAbout?(id: string): void
  onReport?(id: string): void
}) {
  const s = scale > 0 ? scale : 1
  const w = Math.min(SCREEN_W / s, board.w - 2 * MARGIN)
  const h = SCREEN_H / s
  const x = Math.max(MARGIN, Math.min(anchor.x, board.w - w - MARGIN))
  const below = anchor.y + anchor.h + GAP / s
  const y = below + h <= board.h - MARGIN ? below : Math.max(MARGIN, anchor.y - h - GAP / s)
  return (
    <div className="popover" role="group" aria-label="Actions for the selected item" data-oy={anchor.y} data-ox={anchor.x} style={{ left: x, top: y, width: w }}>
      <button type="button" data-seq="1" onClick={() => onAskAbout?.(id)}>Ask about this</button>
      <button type="button" data-seq="2" onClick={() => onReport?.(id)}>Something looks wrong</button>
    </div>
  )
}
