import type { Action } from '../actions'
import { EXPLORE_PARAM_H, PLOT_INSET } from './constants'
import type { Box } from './types'

/** Maps maths coordinates to board pixels inside `box` inset by 36 px for the axes (y grows upward). */
export function plotTransform(
  box: Box,
  x: [number, number],
  y: [number, number],
): { toPx(p: [number, number]): [number, number]; inner: Box } {
  const inner: Box = {
    x: box.x + PLOT_INSET,
    y: box.y + PLOT_INSET,
    w: Math.max(0, box.w - 2 * PLOT_INSET),
    h: Math.max(0, box.h - 2 * PLOT_INSET),
  }
  const sx = inner.w / (x[1] - x[0])
  const sy = inner.h / (y[1] - y[0])
  return {
    inner,
    toPx: ([px, py]) => [inner.x + (px - x[0]) * sx, inner.y + inner.h - (py - y[0]) * sy],
  }
}

/** The part of a figure's box that holds the plot: an explore's box also holds its slider controls underneath. */
export function plotArea(a: Action, box: Box): Box {
  if (a.t !== 'explore') return box
  return { ...box, h: Math.max(0, box.h - EXPLORE_PARAM_H * a.params.length) }
}
