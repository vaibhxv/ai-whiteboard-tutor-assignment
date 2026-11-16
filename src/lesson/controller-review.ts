/**
 * "Something looks wrong" for the lesson controller. Code re-runs `verifyAction` first. A recorded
 * lesson answers with one local beat; a live one asks the `review` role for a verdict and, when the
 * element is wrong, strikes it and shows the verdict's say and fix (validated by the answer pipeline).
 */
import type { Action, VerdictRecord } from '../actions'
import { verifyAction } from '../maths/verify'
import type { Checked, Verification } from '../maths/verify'
import { createBoardPipeline } from '../pipeline/board-pipeline'
import type { Beat } from '../pipeline/beats'
import { createRecordStream } from '../pipeline/record-stream'
import { capWords, findElement, idOf, lastMathBefore, request, streamText, threadOwner } from './controller-support'
import type { Job, Runtime } from './controller-support'
import { intents } from './intents'
import type { LessonState } from './types'

export const REPORT_QUESTION = 'Something looks wrong here.'
export const REPLAY_UNCHECKED = "I can't recheck this live in a recorded lesson."

export type ReviewJob = Extract<Job, { kind: 'review' }>

/** The element (patched) and code's own verification of it now. */
export function localVerification(
  s: LessonState, index: ReadonlyMap<string, Action>, elementId: string,
): { el: Checked; v: Verification } | null {
  const el = findElement(s, elementId)
  if (!el) return null
  const { verify: _v, ...action } = el
  return { el, v: verifyAction(action as Action, { index, lastMathId: lastMathBefore(s, elementId) }) }
}

/** Recorded lessons: one beat saying what code found, circling the element (verify = the local result). */
export function localBeat(threadId: string, el: Checked, elementId: string, v: Verification): Beat {
  const say = v.status === 'unchecked' ? REPLAY_UNCHECKED : capWords(`Checked by code: ${v.evidence ?? 'this step checks out'}`)
  const actions = idOf(el) ? [{ t: 'mark', kind: 'circle', target: elementId, verify: v } as Checked] : []
  return { id: `${threadId}#0`, say, actions, ink: 'answer' }
}

/** Live review into the (already opened) thread `job.threadId`. */
export async function runReview(rt: Runtime, job: ReviewJob): Promise<void> {
  const f = rt.begin(job)
  try {
    await rt.limiter.acquire(f.ctrl.signal)
  } catch {
    rt.end(f)
    return
  }
  await rt.withSlot(f, async (free) => {
    const { threadId, elementId } = job
    rt.dispatch({ type: 'thread/stream', threadId })
    const s = rt.state()
    const local = s ? localVerification(s, rt.index, elementId) : null
    if (!s || !local) return rt.fail(f, { kind: 'unknown', message: `No element ${elementId} on the board.` })
    const req = request('review', intents.review(elementId), { state: s, elementId, localVerification: local.v })
    let text = ''
    const stop = await streamText(rt.source, req, f.ctrl.signal, (t) => (text += t))
    free()
    if (!rt.alive(f)) return
    let verdict: VerdictRecord | undefined
    const rs = createRecordStream({
      mode: 'review',
      onRecord: (r) => {
        if (!verdict && r.t === 'verdict') verdict = r as VerdictRecord
      },
      onReject: () => {},
    })
    rs.push(text)
    rs.end(stop)
    if (!verdict) return rt.fail(f, { kind: 'bad-output', message: 'The review came back without a verdict.' })
    // Code owns truth: a local failure counts as wrong whatever the verdict says.
    const wrong = !verdict.ok || local.v.status === 'fail'
    if (wrong) rt.dispatch({ type: 'element/strike', id: elementId })
    const lines = [JSON.stringify({ t: 'say', text: capWords(verdict.say) })]
    const fix = verdict.fix
    if (wrong && fix) {
      // The fix keeps the element's id in the verdict; on the board it needs its own (ids are unique).
      const fid = idOf(fix)
      lines.push(JSON.stringify(fid ? { ...fix, id: `${fid.slice(0, 20)}-fix` } : fix))
    }
    const pipe = createBoardPipeline({
      segKey: threadId, mode: 'answer', ink: 'answer', index: rt.claim(threadOwner(threadId)),
      onBeat: (beat) => {
        if (rt.alive(f)) rt.dispatch({ type: 'thread/beat', threadId, beat })
      },
      onCheck: () => {},
      onAsk: () => {},
      onReject: () => {},
    })
    pipe.push(lines.join('\n') + '\n')
    pipe.end('end')
    rt.dispatch({ type: 'thread/done', threadId })
  })
}
