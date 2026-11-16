import { parseLine } from '../actions'
import type { AnyRecord, Mode } from '../actions'
import { createLineAssembler } from './lines'
import type { StopReason } from './lines'

export interface RecordStreamOpts {
  mode: Mode
  onRecord(r: AnyRecord, line: string): void
  onReject(line: string, reason: string): void
}

function normalise(reason: string): string {
  const m = /^"([^"]*)" not allowed in (\w+) mode$/.exec(reason)
  return m ? `not allowed in ${m[2]}: ${m[1]}` : reason
}

export function createRecordStream(opts: RecordStreamOpts): {
  push(chunk: string): void
  end(stop: StopReason): { accepted: number; rejected: number }
} {
  const asm = createLineAssembler()
  let accepted = 0
  let rejected = 0
  const handle = (line: string) => {
    const res = parseLine(line, opts.mode)
    if (res.ok) {
      accepted++
      opts.onRecord(res.record, line)
    } else {
      rejected++
      opts.onReject(line, normalise(res.reason))
    }
  }
  return {
    push(chunk) {
      for (const l of asm.push(chunk)) handle(l)
    },
    end(stop) {
      for (const l of asm.end(stop)) handle(l)
      return { accepted, rejected }
    },
  }
}
