import type { AskAction, CheckAction, IdeaRecord, PlanRecord, SegmentPlan, WarmupRecord } from '../actions'
import type { Template } from '../layout/types'
import type { Checked } from '../maths/verify'
import type { Beat } from '../pipeline/beats'
import type { ErrorKind } from '../sources/errors'
import type { Badge } from '../sources/types'

/** Play-order key of a segment. `n` is always the main segment it belongs to. */
export type SegKey =
  | `seg:${number}`
  | `reteach:${string}:${number}`
  | `solution:${string}`
  | `lost:${number}:${number}`

export type Cursor = { seg: SegKey; beat: number }

export type SegmentKind = 'main' | 'reteach' | 'solution' | 'lost'
export type GenStatus = 'pending' | 'streaming' | 'complete' | 'failed'

export type SegmentState = {
  key: SegKey
  kind: SegmentKind
  n: number
  status: GenStatus
  beats: Beat[]
  check?: Checked<CheckAction>
  asks: AskAction[]
  template: Template
  regenerated: boolean
  /** reteach: `{checkpoint}`; lost: the cursor it interrupted, or `{checkpoint}` if raised at a checkpoint. */
  returnTo?: Cursor | { checkpoint: string }
}

export type CheckOutcome = 'first-try' | 'after-reteach' | 'solution' | 'skipped'

export type CheckRecord = {
  id: string
  attempts: number
  outcome?: CheckOutcome
  branches: string[]
  unsure: number
}

export type ThreadOutcome = 'clear' | 'not-quite' | 'differently'

export type AnswerThread = {
  id: string
  question: string
  targets: string[]
  askId?: string
  status: GenStatus
  beats: Beat[]
  outcome?: ThreadOutcome
}

/** Plain-data form of a `SourceError`, so the log stays JSON-serialisable. */
export type SourceErrorData = { kind: ErrorKind; message: string }

export type Need = { kind: 'segment'; key: SegKey } | { kind: 'thread'; id: string } | { kind: 'recap' }
export type RetryTarget = { kind: 'plan' } | Need

export type InterruptOverlay = { kind: 'interrupt'; threadId?: string }
export type ProblemOverlay = {
  kind: 'problem'
  error: SourceErrorData
  retry: RetryTarget
  /** The interrupt overlay the problem covered; `error/clear` restores it. */
  prev?: InterruptOverlay
}
export type Overlay = null | InterruptOverlay | ProblemOverlay

export type Playback = { track: 'lesson' } | { track: 'answer'; threadId: string; beat: number }

export type Phase = 'planning' | 'warmup' | 'teaching' | 'checkpoint' | 'recap' | 'practice' | 'done'

export type ScopeRecord = Extract<PlanRecord, { t: 'scope' }>

export type Recap = {
  ideas: IdeaRecord[]
  say?: string
  practice: Checked<CheckAction>[]
  status: GenStatus
}

export type PracticeResult = { result: 'correct' | 'wrong' | 'skipped' }

export type LearnerModel = {
  answers: { checkId: string; branch: string; correct: boolean }[]
  /** `checkId` (extension) records which check surfaced it, so a later correct answer resolves it. */
  misconceptions: { text: string; resolved: boolean; checkId?: string }[]
  unsure: number
  /** Keyed by main segment n: how many "I'm lost" segments were inserted for it. */
  lostCount: Record<number, number>
  questions: string[]
  pace: 'normal'
}

export type LessonState = {
  id: string
  topic: string
  createdAt: string
  badge: Badge
  phase: Phase
  scope?: ScopeRecord
  objective?: string
  plan: SegmentPlan[]
  warmup?: { record: WarmupRecord; answer?: string; skipped?: boolean }
  segments: Record<SegKey, SegmentState>
  order: SegKey[]
  cursor: Cursor
  /** Segments the cursor has entered, in first-visit order; their pages stay on the board. */
  visited: SegKey[]
  /** The check shown while `phase === 'checkpoint'`. */
  currentCheck?: string
  checks: Record<string, CheckRecord>
  threads: AnswerThread[]
  overlay: Overlay
  playback: Playback
  struck: string[]
  patches: Record<string, Checked>
  recap?: Recap
  practice: Record<string, PracticeResult>
  learner: LearnerModel
}
