import type { Action } from '../actions'

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
  action: Action
  box: Box
  beatId: string
  ink: 'lesson' | 'answer'
  region: Region
  parent?: string
  reprise?: boolean
}

export type Page = {
  index: number
  segKey: string
  template: Template
  items: Placed[]
  beatIds: string[]
  dropped: string[]
}
