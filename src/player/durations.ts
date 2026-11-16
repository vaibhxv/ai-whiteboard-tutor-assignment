import type { Action } from '../actions'
import type { Beat } from '../pipeline/beats'

export type BeatTiming = { actionDelays: number[]; actionDurations: number[]; total: number }

type Of<T extends Action['t']> = Extract<Action, { t: T }>

const clamp = (lo: number, hi: number, n: number) => Math.min(hi, Math.max(lo, n))
const math = (a: { latex: string }) => Math.min(2500, 900 + 30 * a.latex.length)

/** Draw-on time of each action at speed 1, in ms. */
export const ACTION_MS = {
  write: (a: Of<'write'>) => clamp(600, 2500, 40 * a.text.length),
  math: (a: Of<'math'>) => math(a),
  step: (a: Of<'step'>) => math(a) + 400,
  solutions: () => 900,
  plot: () => 1800,
  point: () => 350,
  line: () => 500,
  guide: () => 400,
  numberline: () => 900,
  table: (a: Of<'table'>) => Math.min(1800, 300 * a.rows.length),
  mark: () => 500,
  explore: () => 1800,
  page: () => 0,
} as const

function actionMs(a: Action): number {
  const f = (ACTION_MS as Record<string, ((a: Action) => number) | undefined>)[a.t]
  return f ? f(a) : 0
}

export function estimateSpeechMs(text: string, rate: number): number {
  if (!text) return 0
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return ((words / 2.6) * 1000) / rate + 250
}

export function timeBeat(beat: Beat, speed: number): BeatTiming {
  const actionDurations = beat.actions.map((a) => actionMs(a) / speed)
  const actionDelays: number[] = []
  let t = 0
  for (const d of actionDurations) {
    actionDelays.push(t)
    t += d
  }
  return { actionDelays, actionDurations, total: Math.max(t, estimateSpeechMs(beat.say, speed)) }
}
