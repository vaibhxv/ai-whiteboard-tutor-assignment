import type { Beat } from '../pipeline/beats'
import { ANSWER_PANEL, GAP } from './constants'
import type { Box, Measurer, Placed, Viewport } from './types'

/**
 * Lays answer beats out top-to-bottom inside the answer panel, with the notes rules (one column,
 * GAP between items, inset by GAP inside the panel). Items past the panel's bottom keep their
 * positions: the panel scrolls in the UI. Lesson items are never touched.
 *
 * Only `write`, `math`, `step` and `solutions` are placed here. `mark`, `point`, `line` and `guide`
 * in an answer refer to lesson elements and are drawn on the lesson page, so they are ignored:
 * the Board (Task 16) resolves them against the lesson page with `markGeometry`/`plotTransform`.
 */
export function layoutAnswer(beats: Beat[], m: Measurer, vp: Viewport): { panel: Box; items: Placed[] } {
  const panel = { ...ANSWER_PANEL[vp] }
  const x = panel.x + GAP
  const colW = panel.w - 2 * GAP
  const items: Placed[] = []
  let y = panel.y + GAP
  for (const beat of beats) {
    for (const a of beat.actions) {
      if (a.t !== 'write' && a.t !== 'math' && a.t !== 'step' && a.t !== 'solutions') continue
      const size = m.measure(a, colW)
      const box = { x, y, w: Math.min(Math.max(0, size.w), colW), h: size.h }
      items.push({ id: a.id, action: a, box, beatId: beat.id, ink: beat.ink, region: 'notes' })
      y += size.h + GAP
    }
  }
  return { panel, items }
}
