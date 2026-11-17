import type { AskAction, CheckAction, PlanRecord, RecapRecord } from '../actions'
import type { Checked } from '../maths/verify'
import type { Beat } from '../pipeline/beats'
import type { PipelineSummary } from '../pipeline/board-pipeline'
import type { Badge } from '../sources/types'
import type { Cursor, RetryTarget, SegKey, SourceErrorData, ThreadOutcome } from './types'

/** `branch` is an option id, `a<i>` (an anticipated answer) or `other`. */
export type CheckGrade = { result: 'correct' | 'wrong'; branch: string; misconception?: string }

/**
 * Every event is plain JSON data (Task 17 persists the log).
 * Additions beyond the brief: `practice/start`, `recap/stream`, `recap/failed`, `thread/stream`,
 * and `'cancel'` as an `interrupt/close` outcome.
 */
export type LessonEvent =
  | { type: 'lesson/start'; id: string; topic: string; badge: Badge; at: string }
  | { type: 'plan/record'; record: PlanRecord }
  | { type: 'plan/done' }
  | { type: 'warmup/answer'; optionId: string }
  | { type: 'warmup/skip' }
  | { type: 'seg/stream'; key: SegKey }
  | { type: 'seg/beat'; key: SegKey; beat: Beat }
  | { type: 'seg/check'; key: SegKey; check: Checked<CheckAction> }
  | { type: 'seg/ask'; key: SegKey; ask: AskAction }
  | { type: 'seg/done'; key: SegKey; summary: PipelineSummary }
  | { type: 'seg/regenerate'; key: SegKey }
  | { type: 'seg/failed'; key: SegKey; error: SourceErrorData }
  | { type: 'beat/patch'; actionId: string; action: Checked }
  | { type: 'player/advance' }
  | { type: 'player/seek'; cursor: Cursor }
  | { type: 'check/answer'; checkId: string; grade: CheckGrade }
  | { type: 'check/unsure'; checkId: string }
  | { type: 'check/skip'; checkId: string }
  | { type: 'lost/request' }
  | { type: 'interrupt/open' }
  | { type: 'interrupt/ask'; threadId: string; question: string; targets: string[]; askId?: string }
  | { type: 'thread/stream'; threadId: string }
  | { type: 'thread/beat'; threadId: string; beat: Beat }
  | { type: 'thread/done'; threadId: string }
  | { type: 'thread/failed'; threadId: string; error: SourceErrorData }
  | { type: 'interrupt/close'; outcome: ThreadOutcome | 'cancel' }
  | { type: 'element/strike'; id: string }
  | { type: 'recap/stream' }
  | { type: 'recap/record'; record: RecapRecord | Checked }
  | { type: 'recap/done' }
  | { type: 'recap/failed'; error: SourceErrorData }
  | { type: 'practice/start' }
  | { type: 'practice/answer'; checkId: string; grade: CheckGrade }
  | { type: 'practice/skip'; checkId: string }
  | { type: 'error'; error: SourceErrorData; retry: RetryTarget }
  | { type: 'error/clear' }
  | { type: 'lesson/done' }
  /** Appended when a saved lesson is reopened after a refresh: whatever was mid-generation restarts. */
  | { type: 'lesson/resumed' }

export type LessonEventType = LessonEvent['type']
export type EventOf<T extends LessonEventType> = Extract<LessonEvent, { type: T }>
