import type { CheckAction } from '../actions'
import { markId } from '../layout/engine'
import type { Template } from '../layout/types'
import type { Checked } from '../maths/verify'
import type { Beat } from '../pipeline/beats'
import type { AnswerThread, LessonState, Need, SegKey, SegmentState } from './types'

export const currentSegment = (s: LessonState): SegmentState | null => s.segments[s.cursor.seg] ?? null

/** The check on show at a checkpoint (always the main segment's check). */
export function activeCheck(s: LessonState): Checked<CheckAction> | null {
  if (s.phase !== 'checkpoint' || !s.currentCheck) return null
  const id = s.currentCheck
  return Object.values(s.segments).find((g) => g.kind === 'main' && g.check?.id === id)?.check ?? null
}

export const activeThread = (s: LessonState): AnswerThread | null =>
  s.playback.track === 'answer' ? (s.threads.find((t) => t.id === (s.playback as { threadId: string }).threadId) ?? null) : null

/** What the controller must generate next: pending segments in play order, pending threads, then the recap. */
export function needs(s: LessonState): Need[] {
  const out: Need[] = []
  for (const key of s.order) if (s.segments[key]?.status === 'pending') out.push({ kind: 'segment', key })
  for (const t of s.threads) if (t.status === 'pending') out.push({ kind: 'thread', id: t.id })
  if (s.recap?.status === 'pending') out.push({ kind: 'recap' })
  return out
}

/** Segments on the board: those in play order that the cursor has visited, plus the cursor's own. */
function onBoard(s: LessonState): SegmentState[] {
  const keys: SegKey[] = s.order.filter((k) => k === s.cursor.seg || s.visited.includes(k))
  return keys.flatMap((k) => s.segments[k] ?? [])
}

/**
 * True when the lesson is parked at the end of a segment that has since completed: the player should
 * dispatch `player/advance` to apply the end-of-segment rule.
 */
export function stalledAtEnd(s: LessonState): boolean {
  const g = s.segments[s.cursor.seg]
  return s.phase === 'teaching' && s.playback.track === 'lesson' && g?.status === 'complete' && s.cursor.beat >= g.beats.length
}

function patched(s: LessonState, b: Beat): Beat {
  if (Object.keys(s.patches).length === 0) return b
  let changed = false
  const actions = b.actions.map((a, i) => {
    const id = 'id' in a && typeof a.id === 'string' ? a.id : markId(b.id, i)
    const p = s.patches[id]
    if (!p) return a
    changed = true
    return p
  })
  return changed ? { ...b, actions } : b
}

export function pagesInput(s: LessonState): { segKey: SegKey; template: Template; beats: Beat[] }[] {
  return onBoard(s).map((g) => ({ segKey: g.key, template: g.template, beats: g.beats.map((b) => patched(s, b)) }))
}

/** Beats already drawn: all beats of visited segments, plus the cursor segment's beats before the cursor (and the current one if asked). */
export function visibleBeatIds(s: LessonState, opts: { includeCurrent?: boolean } = {}): string[] {
  const limit = s.cursor.beat + (opts.includeCurrent ? 1 : 0)
  return onBoard(s).flatMap((g) => (g.key === s.cursor.seg ? g.beats.slice(0, limit) : g.beats).map((b) => b.id))
}
