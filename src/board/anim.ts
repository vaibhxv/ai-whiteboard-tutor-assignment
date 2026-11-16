import type { CSSProperties } from 'react'
import type { Action } from '../actions'
import type { BeatTiming } from '../player/durations'

/** Duration of every animation under reduced motion. */
export const REDUCED_MS = 150

export type AnimKind = 'wipe' | 'stroke' | 'plot' | 'fade'
/** What one element needs to draw itself on: a CSS class, the `--delay`/`--d` variables, and a key that restarts it. */
export type Anim = { cls: string; style: CSSProperties; key: string }

/** `--delay` (start offset within the beat) and `--d` (duration) of the beat's `actionIndex`-th action. */
export function animStyle(actionIndex: number, timing: BeatTiming): CSSProperties {
  const delay = timing.actionDelays[actionIndex] ?? 0
  const d = timing.actionDurations[actionIndex] ?? 0
  return { '--delay': `${delay}ms`, '--d': `${d}ms` } as CSSProperties
}

export function makeAnim(kind: AnimKind, actionIndex: number, timing: BeatTiming, reduced: boolean, token: number): Anim {
  const style = animStyle(actionIndex, timing)
  if (reduced) (style as Record<string, string>)['--d'] = `${REDUCED_MS}ms`
  return { cls: reduced ? 'anim-fade' : `anim-${kind}`, style, key: String(token) }
}

/** Which draw-on an action gets. `dashed` lines would lose their dashes to a stroke animation, so they fade. */
export function kindOf(a: Action, layer: 'html' | 'svg' = 'svg'): AnimKind {
  switch (a.t) {
    case 'plot': return 'plot'
    case 'explore': return layer === 'html' ? 'wipe' : 'plot'
    case 'numberline':
    case 'mark': return 'stroke'
    case 'line': return a.dashed ? 'fade' : 'stroke'
    case 'point':
    case 'guide': return 'fade'
    default: return 'wipe'
  }
}

/** True when the user asks for reduced motion (false where matchMedia is missing, e.g. jsdom). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
