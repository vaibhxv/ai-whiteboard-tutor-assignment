import type { Action, AskAction, CheckAction } from '../actions'
import { verifyAction } from '../maths/verify'
import type { Checked } from '../maths/verify'
import { createBeatAssembler } from './beats'
import type { Beat, Ink } from './beats'
import type { StopReason } from './lines'
import { createRecordStream } from './record-stream'
import { checkRefs } from './refs'

export type PipelineSummary = {
  accepted: number
  rejected: number
  failed: Checked[]
  hasCheck: boolean
  truncated: boolean
}

export interface BoardPipelineOpts {
  segKey: string
  mode: 'board' | 'answer'
  ink: Ink
  index: Map<string, Action>
  onBeat(b: Beat): void
  onCheck(c: Checked<CheckAction>): void
  onAsk(a: AskAction): void
  onReject(line: string, reason: string): void
}

export function createBoardPipeline(opts: BoardPipelineOpts): {
  push(chunk: string): void
  end(stop: StopReason): PipelineSummary
} {
  const beats = createBeatAssembler(opts.segKey, opts.ink)
  const local = new Set<string>()
  const failed: Checked[] = []
  let lastMathId: string | undefined
  let hasCheck = false
  let accepted = 0
  let rejected = 0

  const reject = (line: string, reason: string) => {
    rejected++
    opts.onReject(line, reason)
  }
  const emit = (b: Beat | null) => {
    if (b) opts.onBeat(b)
  }

  const stream = createRecordStream({
    mode: opts.mode,
    onReject: (line, reason) => reject(line, reason),
    onRecord(rec, line) {
      const a = rec as Action
      if (hasCheck) return reject(line, 'after check')
      const refs = checkRefs(a, opts.index, local)
      if (!refs.ok) return reject(line, refs.reason)
      const verify = verifyAction(a, { index: opts.index, lastMathId })
      const checked = { ...a, verify } as Checked
      if ('id' in a && typeof a.id === 'string') {
        opts.index.set(a.id, a)
        local.add(a.id)
      }
      if ((a.t === 'math' || a.t === 'step') && a.expr !== undefined) lastMathId = a.id
      accepted++
      if (verify.status === 'fail') failed.push(checked)
      if (a.t === 'check') {
        hasCheck = true
        emit(beats.end())
        opts.onCheck(checked as Checked<CheckAction>)
      } else if (a.t === 'ask') {
        emit(beats.end())
        opts.onAsk(a)
      } else {
        emit(beats.add(checked))
      }
    },
  })

  return {
    push(chunk) {
      stream.push(chunk)
    },
    end(stop) {
      stream.end(stop)
      emit(beats.end())
      return { accepted, rejected, failed, hasCheck, truncated: stop !== 'end' }
    },
  }
}
