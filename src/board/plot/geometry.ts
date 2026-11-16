import { intersects, placeLabel, within } from '../../layout/labels'
import { plotTransform } from '../../layout/plot-transform'
import type { Box } from '../../layout/types'
import { samplePath } from './sample'

export type PlotFn = { id: string; f: (x: number) => number; label?: string }
export type PlotGeo = {
  /** Axis lines and tick-label bands: nothing else should be drawn on them. */
  structure: Box[]
  /** Small boxes along each computed curve. */
  curve: Box[]
  legend: { fn: PlotFn; box: Box }[]
}

export const LABEL_H = 20
export const labelSize = (s: string) => ({ w: s.length * 9.2 + 8, h: LABEL_H })
const CURVE_STEP = 6
const CURVE_BOX = 6

/** Where the axes sit (clamped to the plot area, so a range that excludes 0 puts them on the edge). */
export function axisPos(area: Box, x: [number, number], y: [number, number]) {
  const { toPx, inner } = plotTransform(area, x, y)
  const [ox, oy] = toPx([0, 0])
  return {
    inner, toPx,
    ax: Math.min(Math.max(ox, inner.x), inner.x + inner.w),
    ay: Math.min(Math.max(oy, inner.y), inner.y + inner.h),
  }
}

/** Obstacles of a drawn plot (axes, tick labels, curve samples) and its legend placement. */
export function plotGeometry(area: Box, x: [number, number], y: [number, number], fns: PlotFn[]): PlotGeo {
  const { inner, toPx, ax, ay } = axisPos(area, x, y)
  const structure: Box[] = [
    { x: inner.x, y: ay - 6, w: inner.w, h: 12 },
    { x: ax - 6, y: inner.y, w: 12, h: inner.h },
    { x: inner.x, y: ay + 6, w: inner.w, h: 26 },
    { x: ax - 50, y: inner.y, w: 42, h: inner.h },
  ]
  const curve: Box[] = []
  for (const fn of fns) {
    const d = samplePath(fn.f, x, y, toPx, 480)
    const pts = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)]
    for (let i = 0; i < pts.length; i += CURVE_STEP) {
      const px = Number(pts[i]?.[1])
      const py = Number(pts[i]?.[2])
      if (py >= inner.y && py <= inner.y + inner.h) curve.push({ x: px - CURVE_BOX / 2, y: py - CURVE_BOX / 2, w: CURVE_BOX, h: CURVE_BOX })
    }
  }
  const legend: PlotGeo['legend'] = []
  const taken = [...structure, ...curve]
  const labelled = fns.filter((f) => f.label)
  for (const fn of labelled) {
    const { w, h } = labelSize(fn.label ?? '')
    const m = 8
    const corners: Box[] = [
      { x: inner.x + inner.w - w - m, y: inner.y + m, w, h },
      { x: inner.x + m, y: inner.y + m, w, h },
      { x: inner.x + (inner.w - w) / 2, y: inner.y + m, w, h },
      { x: inner.x + inner.w - w - m, y: inner.y + inner.h - h - m, w, h },
      { x: inner.x + m, y: inner.y + inner.h - h - m, w, h },
      { x: inner.x + (inner.w - w) / 2, y: inner.y + inner.h - h - m, w, h },
    ]
    const within = (b: Box) => b.x >= inner.x && b.x + b.w <= inner.x + inner.w
    const box = corners.find((c) => within(c) && !taken.some((t) => intersects(c, t)))
      ?? placeLabel([inner.x + inner.w / 2, inner.y + inner.h / 2], { w, h }, taken, inner)
    taken.push(box)
    legend.push({ fn, box })
  }
  return { structure, curve, legend }
}

const ANGLES = [0, 45, -45, 90, -90, 135, -135, 180].map((d) => (d * Math.PI) / 180)

/**
 * Places a box of `size` near `anchor`. First the eight-way placeLabel search at each margin (a margin
 * pushes the box away from the anchor, clearing a mark shape of that radius); if nothing is free, a ring
 * search at growing radii (box centred on the ring). Returns the first fully free placement, else the
 * one for the first margin.
 */
export function placeAround(
  anchor: [number, number], size: { w: number; h: number }, others: Box[], bounds: Box, margins: number[],
): Box {
  let first: Box | undefined
  for (const m of margins.slice(0, 2)) {
    const big = placeLabel(anchor, { w: size.w + 2 * m, h: size.h + 2 * m }, others, bounds)
    const b = { x: big.x + m, y: big.y + m, w: size.w, h: size.h }
    first ??= b
    if (!others.some((o) => intersects(big, o))) return b
  }
  const base = Math.max(...margins.slice(0, 1), 0) + 6
  for (let r = base + Math.min(size.w, size.h) / 2; r <= 160; r += 10) {
    for (const a of ANGLES) {
      // Centre on the ring, pushed outward by half the box so the nearest edge sits on the ring.
      const cx = anchor[0] + r * Math.cos(a)
      const cy = anchor[1] - r * Math.sin(a)
      const b = { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h }
      if (within(b, bounds) && !others.some((o) => intersects(b, o))) return b
    }
  }
  return first as Box
}
