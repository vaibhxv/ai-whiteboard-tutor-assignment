import type { Action, AnyRecord, Mode, PlanRecord } from '../../../src/actions'
import { parseLine } from '../../../src/actions'
import type { LessonEvent } from '../../../src/lesson/events'
import type { LessonState, SegKey } from '../../../src/lesson/types'
import { createBoardPipeline } from '../../../src/pipeline/board-pipeline'
import type { PipelineSummary } from '../../../src/pipeline/board-pipeline'
import type { Beat } from '../../../src/pipeline/beats'
import { run, start } from '../lesson/helpers'

/** Pull the first complete JSON object (brace-matched, string-aware) out of a line, if it starts with {"t": */
export function jsonOnLine(line: string): string | null {
  const i = line.indexOf('{"t":')
  if (i < 0) return null
  let depth = 0
  let inStr = false
  for (let j = i; j < line.length; j++) {
    const c = line[j]
    if (inStr) {
      if (c === '\\') j++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return line.slice(i, j + 1)
    }
  }
  return null
}

export function modeFor(t: string): Mode {
  if (['scope', 'objective', 'warmup', 'segment'].includes(t)) return 'plan'
  if (t === 'idea') return 'recap'
  if (t === 'verdict') return 'review'
  return 'board'
}

export function parseAll(text: string, mode: Mode): AnyRecord[] {
  return text.split('\n').filter((l) => l.trim()).map((l) => {
    const r = parseLine(l, mode)
    if (!r.ok) throw new Error(`${r.reason}: ${l}`)
    return r.record
  })
}

export type Streamed = {
  summary: PipelineSummary
  beats: Beat[]
  rejects: { line: string; reason: string }[]
  events: LessonEvent[]
}

/** Stream text through the real board pipeline; collect beats/rejects and the seg/* events a controller would dispatch. */
export function stream(text: string, key: SegKey, mode: 'board' | 'answer', index: Map<string, Action>): Streamed {
  const beats: Beat[] = []
  const rejects: { line: string; reason: string }[] = []
  const events: LessonEvent[] = [{ type: 'seg/stream', key }]
  const p = createBoardPipeline({
    segKey: key, mode, ink: mode === 'answer' ? 'answer' : 'lesson', index,
    onBeat: (beat) => { beats.push(beat); events.push({ type: 'seg/beat', key, beat }) },
    onCheck: (check) => events.push({ type: 'seg/check', key, check }),
    onAsk: (ask) => events.push({ type: 'seg/ask', key, ask }),
    onReject: (line, reason) => rejects.push({ line, reason }),
  })
  p.push(text)
  const summary = p.end('end')
  events.push({ type: 'seg/done', key, summary })
  return { summary, beats, rejects, events }
}

export const PLAN_TEXT = [
  '{"t":"scope","verdict":"in","reason":"Quadratic graphs are school algebra."}',
  '{"t":"warmup","id":"w1","prompt":"A curve crosses the x-axis at 1 and 3. Where is its lowest point?","options":[{"id":"a","text":"x = 2","correct":true},{"id":"b","text":"x = 3","correct":false},{"id":"c","text":"x = -2","correct":false}]}',
  '{"t":"objective","text":"See why the vertex sits halfway between the roots."}',
  '{"t":"segment","n":1,"title":"Roots and symmetry","goal":"Use the roots to find the mirror line and the vertex.","representation":"graph","misconception":"Halving b without the sign in -b/2a","check":"choice"}',
  '{"t":"segment","n":2,"title":"The height of the vertex","goal":"Find the minimum value by substituting.","representation":"worked","misconception":"Height versus position","check":"number"}',
].join('\n')

/** A lesson planned with PLAN_TEXT, warm-up answered "b", seg:1 streamed from `segText`, cursor at the start of seg:1. */
export function lessonWith(segText: string): { state: LessonState; index: Map<string, Action> } {
  const plan = parseAll(PLAN_TEXT, 'plan') as PlanRecord[]
  let state = run([
    { ...(start as Extract<LessonEvent, { type: 'lesson/start' }>), topic: 'Why is the vertex halfway between the roots?' },
    ...plan.map((record): LessonEvent => ({ type: 'plan/record', record })),
    { type: 'plan/done' },
    { type: 'warmup/answer', optionId: 'b' },
  ])
  const index = new Map<string, Action>()
  const s = stream(segText, 'seg:1', 'board', index)
  state = run(s.events, state)
  return { state, index }
}
