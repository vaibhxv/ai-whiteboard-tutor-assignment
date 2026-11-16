import type { Box } from './types'

const OFFSET = 6

export const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export const within = (a: Box, o: Box): boolean =>
  a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h

/** Shrink to fit `bounds`, then shift inside it. */
export function clampBox(b: Box, bounds: Box): Box {
  const w = Math.min(Math.max(0, b.w), bounds.w)
  const h = Math.min(Math.max(0, b.h), bounds.h)
  const x = Math.min(Math.max(b.x, bounds.x), bounds.x + bounds.w - w)
  const y = Math.min(Math.max(b.y, bounds.y), bounds.y + bounds.h - h)
  return { x, y, w, h }
}

/**
 * Places a label of `size` next to `anchor`, trying E, NE, N, NW, W, SW, S, SE.
 * Returns the first candidate inside `bounds` that overlaps no `taken` box; else the first
 * in-bounds candidate; else the E candidate clamped into bounds.
 */
export function placeLabel(anchor: [number, number], size: { w: number; h: number }, taken: Box[], bounds: Box): Box {
  const [ax, ay] = anchor
  const { w, h } = size
  const right = ax + OFFSET
  const left = ax - OFFSET - w
  const midX = ax - w / 2
  const above = ay - OFFSET - h
  const below = ay + OFFSET
  const midY = ay - h / 2
  const candidates: Box[] = [
    [right, midY], [right, above], [midX, above], [left, above],
    [left, midY], [left, below], [midX, below], [right, below],
  ].map(([x, y]) => ({ x: x as number, y: y as number, w, h }))
  const inBounds = candidates.filter((c) => within(c, bounds))
  const free = inBounds.find((c) => !taken.some((t) => intersects(c, t)))
  return free ?? inBounds[0] ?? clampBox(candidates[0] as Box, bounds)
}
