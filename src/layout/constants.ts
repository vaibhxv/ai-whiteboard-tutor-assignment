import type { Box, Template, Viewport } from './types'

export const BOARD = { wide: { w: 1200, h: 750 }, narrow: { w: 600, h: 1000 } } as const
export const MARGIN = 40
export const GAP = 16
/** Narrow boards use a 20-px margin on every side (column x 20–580). */
export const NARROW_MARGIN = 20

/** Inset of a plot's axes area inside its box. */
export const PLOT_INSET = 36
/** Slider controls under an explore plot, per param. */
export const EXPLORE_PARAM_H = 56
export const FIGURE_REGION: Box = { x: 640, y: 40, w: 520, h: 670 }

export const ANSWER_PANEL: Record<Viewport, Box> = {
  wide: { x: 780, y: 420, w: 380, h: 300 },
  narrow: { x: 20, y: 660, w: 560, h: 320 },
}

/** Page geometry for one template at one viewport. */
export type Geometry = {
  colX: number
  colW: number
  top: number
  bottom: number
  /** The split template's figure region (wide only). */
  figure?: Box
  /** Width of a figure placed in the flow, centred in the column. */
  flowFigW: number
  /** Height of a plot/explore placed in the flow (before explore controls). */
  flowPlotH: number
}

export function geometry(t: Template, vp: Viewport): Geometry {
  if (vp === 'narrow') {
    const n = NARROW_MARGIN
    return { colX: n, colW: BOARD.narrow.w - 2 * n, top: n, bottom: BOARD.narrow.h - n, flowFigW: 560, flowPlotH: 340 }
  }
  const top = MARGIN
  const bottom = BOARD.wide.h - MARGIN
  if (t === 'split') return { colX: 40, colW: 560, top, bottom, figure: FIGURE_REGION, flowFigW: 560, flowPlotH: 360 }
  return { colX: MARGIN, colW: BOARD.wide.w - 2 * MARGIN, top, bottom, flowFigW: 640, flowPlotH: 360 }
}

export const boardBox = (vp: Viewport): Box => ({ x: 0, y: 0, w: BOARD[vp].w, h: BOARD[vp].h })
