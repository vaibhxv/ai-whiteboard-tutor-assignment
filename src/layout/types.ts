import type { Action } from '../actions'
import type { Checked } from '../maths/verify'

export type Viewport = 'wide' | 'narrow'
export type Template = 'notes' | 'split'
export type Box = { x: number; y: number; w: number; h: number }
export type Region = 'notes' | 'figure' | 'inplot' | 'overlay'
export type MarkKind = Extract<Action, { t: 'mark' }>['kind']

export interface Measurer {
  measure(a: Action, maxWidth: number): { w: number; h: number }
}

export type Placed = {
  id: string
  /** The beat's action as accepted by the pipeline, including its `verify` result. */
  action: Checked
  box: Box
  beatId: string
  /** Position of this item's action within its beat's `actions` (unplaced and dropped actions leave gaps). */
  actionIndex: number
  ink: 'lesson' | 'answer'
  region: Region
  parent?: string
  reprise?: boolean
  /**
   * Set (0.25 ≤ fit < 1) only when a beat too tall for an empty page was shrunk to fit:
   * the box is the measured size × fit, so the Board renders the content with a CSS scale(fit).
   */
  fit?: number
}

export type Page = {
  index: number
  segKey: string
  template: Template
  items: Placed[]
  beatIds: string[]
  dropped: string[]
}
