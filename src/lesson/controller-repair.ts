/**
 * Repair policy for the lesson controller: one `repair` call per action that failed verification.
 * A replacement counts only if it parses in board mode, keeps the same `t` and id, resolves its
 * references, and now passes verification. Failed checks that cannot be repaired become self-rating.
 */
import { parseLine } from '../actions'
import type { Action, CheckAction } from '../actions'
import { selfRatingCheck } from '../checkpoint/grade-check'
import { verifyAction } from '../maths/verify'
import type { Checked } from '../maths/verify'
import type { StopReason } from '../pipeline/lines'
import { checkRefs } from '../pipeline/refs'
import { idOf, lastMathBefore, request, streamText } from './controller-support'
import type { Flight, Runtime } from './controller-support'
import { intents } from './intents'

/** One repair call; returns the verified replacement, or null (the action stays flagged). */
export async function repairAction(rt: Runtime, f: Flight, a: Checked): Promise<Checked | null> {
  const id = idOf(a)
  const s = rt.state()
  if (!id || !s) return null
  const { verify, ...action } = a
  const req = request('repair', intents.repair(id), { action: action as Action, evidence: verify.evidence ?? 'failed verification', state: s })
  try {
    await rt.limiter.acquire(f.ctrl.signal) // repairs count toward the concurrency limit
  } catch {
    return null
  }
  let text = ''
  let stop: StopReason
  try {
    stop = await streamText(rt.source, req, f.ctrl.signal, (t) => (text += t))
  } catch {
    return null // a failed repair call leaves the action flagged; no problem overlay
  } finally {
    rt.limiter.release()
  }
  if (!rt.alive(f) || stop === 'aborted') return null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const parsed = line.startsWith('{') ? parseLine(line, 'board') : null
    if (!parsed?.ok) continue
    const fix = parsed.record as Action
    if (fix.t !== a.t || idOf(fix) !== id) continue
    const others = new Map(rt.index)
    others.delete(id)
    if (!checkRefs(fix, others, new Set()).ok) return null
    const v = verifyAction(fix, { index: others, lastMathId: lastMathBefore(rt.state() ?? s, id) })
    return v.status === 'pass' ? ({ ...fix, verify: v } as Checked) : null
  }
  return null
}

/** Repairs a failed board action in the background; a passing replacement is dispatched as `beat/patch`. */
export async function repairStep(rt: Runtime, f: Flight, a: Checked): Promise<void> {
  const fixed = await repairAction(rt, f, a)
  const id = idOf(a)
  if (!fixed || !id || !rt.alive(f)) return
  const { verify: _v, ...plain } = fixed
  rt.index.set(id, plain as Action)
  rt.dispatch({ type: 'beat/patch', actionId: id, action: fixed })
}

/** A failed check gets one repair; if that does not pass, it becomes the self-rating check `<id>-rate`. */
export async function repairCheck(rt: Runtime, f: Flight, c: Checked<CheckAction>): Promise<Checked<CheckAction>> {
  const fixed = await repairAction(rt, f, c)
  if (!fixed || fixed.t !== 'check') return selfRatingCheck(c.id)
  const { verify: _v, ...plain } = fixed
  rt.index.set(c.id, plain as Action)
  return fixed as Checked<CheckAction>
}
