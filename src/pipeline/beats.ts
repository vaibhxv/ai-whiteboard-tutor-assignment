import type { Action } from '../actions'
import type { Checked } from '../maths/verify'

export type Ink = 'lesson' | 'answer'
export type Beat = { id: string; say: string; actions: Checked[]; ink: Ink }

export const MAX_BEAT_ACTIONS = 3

export function createBeatAssembler(segKey: string, ink: Ink): {
  add(a: Checked): Beat | null
  end(): Beat | null
} {
  let n = 0
  let cur: Beat | null = null
  const open = (say: string): Beat => ({ id: `${segKey}#${n++}`, say, actions: [], ink })
  return {
    add(a) {
      if (a.t === 'say') {
        const closed = cur
        cur = open(a.text)
        return closed
      }
      let closed: Beat | null = null
      if (cur && cur.actions.length >= MAX_BEAT_ACTIONS) {
        closed = cur
        cur = null
      }
      if (!cur) cur = open('')
      cur.actions.push(a as Checked<Action>)
      return closed
    },
    end() {
      const c = cur
      cur = null
      return c
    },
  }
}
