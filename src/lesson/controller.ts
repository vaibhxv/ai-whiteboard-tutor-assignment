/**
 * The lesson controller: glue between the lesson store and an `AiSource`. It watches `needs()` and
 * fulfils each one (segments, answer threads, the recap) by generating with the right role, intent and
 * context, streams the output through the validation pipelines into lesson events, and applies the
 * regenerate, repair and error policies. It also runs the plan, report-a-mistake reviews, and
 * retry / cancel / dispose. Pure TypeScript; helpers live in controller-support.ts.
 */
import type { StoreApi } from 'zustand/vanilla'
import type { CheckAction, PlanRecord, RecapRecord } from '../actions'
import { selfRatingCheck } from '../checkpoint/grade-check'
import { verifyAction } from '../maths/verify'
import type { Checked } from '../maths/verify'
import { createBoardPipeline } from '../pipeline/board-pipeline'
import { createRecordStream } from '../pipeline/record-stream'
import { QUESTION_MAX, TOPIC_MAX } from '../prompts/context'
import type { Action } from '../actions'
import type { AiSource } from '../sources/types'
import { repairCheck, repairStep } from './controller-repair'
import { REPORT_QUESTION, localBeat, localVerification, runReview } from './controller-review'
import {
  Limiter, MAX_CONCURRENT, badOutput, capChars, elementsByOwner, errorData, idOf, isAbort, jobKey, request, retryTarget,
  segOwner, segmentRequest, streamText, threadOwner, trackingIndex,
} from './controller-support'
import type { Flight, Job, Runtime } from './controller-support'
import type { LessonEvent } from './events'
import { intents } from './intents'
import { needs } from './selectors'
import type { LessonStore } from './store'
import type { LessonState, Need, SegKey, SourceErrorData } from './types'

export type FollowUpKind = 'not-quite' | 'differently'

export interface LessonController {
  /** Starts a new lesson and runs the plan; resolves once the plan is done (or failed). */
  start(opts: { topic: string }): Promise<void>
  /** Opens an answer thread and generates the answer. Returns the new thread id. */
  ask(q: { question: string; targets: string[]; askId?: string }): string
  /** "Not quite" / "Show me differently": records the outcome and asks the same question again. */
  followUp(threadId: string, kind: FollowUpKind): void
  /** "Something looks wrong" on a board element. */
  report(elementId: string): void
  /** Re-issues what failed (after `error/clear`). */
  retry(): void
  /** Stops everything in flight; the items show as failed with an `aborted` problem. */
  cancel(): void
  dispose(): void
}

export type ControllerDeps = { store: StoreApi<LessonStore>; source: AiSource; now(): number }

const ABORTED: SourceErrorData = { kind: 'aborted', message: 'Stopped' }

export function createController(deps: ControllerDeps): LessonController {
  const { store, source } = deps
  const replayMode = source.id === 'replay'
  const index = new Map<string, Action>()
  /** Ids each generation (segment key or `thread:<id>`) added to the index. */
  const owned = new Map<string, Set<string>>()
  const flights = new Map<string, Flight>()
  const failed = new Map<string, Job>()
  const retrying = new Set<string>()
  /** Threads the controller fills itself (reviews), never generated as answers. */
  const localThreads = new Set<string>()
  const threadIntent = new Map<string, { base: string; followUp?: FollowUpKind }>()
  let freeCount = 0
  let planArgs: Extract<LessonEvent, { type: 'lesson/start' }> | undefined
  let disposed = false
  let pumpScheduled = false

  const limiter = new Limiter(MAX_CONCURRENT, () => schedulePump())
  const state = (): LessonState | null => store.getState().state
  const dispatch = (e: LessonEvent) => {
    if (!disposed) store.getState().dispatch(e)
  }

  // ------------------------------------------------------------------------------ index and flights

  function rebuild(s: LessonState | null) {
    index.clear()
    owned.clear()
    if (!s) return
    for (const [owner, acts] of elementsByOwner(s)) {
      const ids = new Set<string>()
      for (const a of acts) {
        const id = idOf(a)
        if (id) {
          index.set(id, a)
          ids.add(id)
        }
      }
      owned.set(owner, ids)
    }
    freeCount = s.threads.filter((t) => !t.askId).length
  }

  /** Forgets an owner's ids (before it is regenerated or retried) and returns a fresh tracking view. */
  function claim(owner: string): Map<string, Action> {
    for (const id of owned.get(owner) ?? []) index.delete(id)
    const ids = new Set<string>()
    owned.set(owner, ids)
    return trackingIndex(index, ids)
  }

  function begin(job: Job): Flight {
    const key = jobKey(job)
    flights.get(key)?.ctrl.abort()
    const f: Flight = { key, job, ctrl: new AbortController() }
    flights.set(key, f)
    return f
  }
  const alive = (f: Flight) => !disposed && flights.get(f.key) === f && !f.ctrl.signal.aborted
  const end = (f: Flight) => {
    if (flights.get(f.key) === f) flights.delete(f.key)
  }

  function abortAll() {
    for (const f of flights.values()) f.ctrl.abort()
    flights.clear()
  }

  function markFailed(job: Job, error: SourceErrorData) {
    if (job.kind === 'segment') dispatch({ type: 'seg/failed', key: job.key, error })
    else if (job.kind === 'thread') dispatch({ type: 'thread/failed', threadId: job.id, error })
    else if (job.kind === 'review') dispatch({ type: 'thread/failed', threadId: job.threadId, error })
    else if (job.kind === 'recap') dispatch({ type: 'recap/failed', error })
    failed.set(jobKey(job), job)
  }

  function fail(f: Flight, error: SourceErrorData) {
    if (!alive(f)) return
    markFailed(f.job, error)
    dispatch({ type: 'error', error, retry: retryTarget(f.job) })
  }

  /** Runs `body` holding a slot already taken by the caller; `free()` may hand it back early. */
  async function withSlot(f: Flight, body: (free: () => void) => Promise<void>) {
    let held = true
    const free = () => {
      if (held) {
        held = false
        limiter.release()
      }
    }
    try {
      await body(free)
    } catch (e) {
      if (!isAbort(e)) fail(f, errorData(e))
    } finally {
      free()
      end(f)
    }
  }

  const rt: Runtime = { source, index, limiter, state, dispatch, alive, fail, claim, begin, end, withSlot }

  // ------------------------------------------------------------------------------------------ pump

  function schedulePump() {
    if (pumpScheduled || disposed) return
    pumpScheduled = true
    queueMicrotask(() => {
      pumpScheduled = false
      pump()
    })
  }

  function retryNeeds(s: LessonState): Need[] {
    const out: Need[] = []
    for (const key of [...retrying]) {
      if (key === 'recap' && s.recap?.status === 'failed') out.push({ kind: 'recap' })
      else if (key.startsWith('thread:') && s.threads.find((t) => threadOwner(t.id) === key)?.status === 'failed') {
        out.push({ kind: 'thread', id: key.slice('thread:'.length) })
      } else if (s.segments[key as SegKey]?.status === 'failed') out.push({ kind: 'segment', key: key as SegKey })
      else retrying.delete(key)
    }
    return out
  }

  function pump() {
    const s = state()
    if (!s || disposed || s.overlay?.kind === 'problem') return
    const noSegments = s.phase === 'planning' || s.scope?.verdict === 'declined'
    for (const need of [...retryNeeds(s), ...needs(s)]) {
      if (need.kind === 'segment' && noSegments) continue
      if (need.kind === 'thread' && localThreads.has(need.id)) continue
      // A flight for a pending item is stale (the item was reset under it); begin() aborts it.
      if (!limiter.tryAcquire()) break
      const job: Job = need
      retrying.delete(jobKey(job))
      const f = begin(job)
      if (job.kind === 'segment') void runSegment(f, job.key)
      else if (job.kind === 'thread') void runThread(f, job.id)
      else void runRecap(f)
    }
  }

  // -------------------------------------------------------------------------------------- the plan

  function resetLesson() {
    abortAll()
    failed.clear()
    retrying.clear()
    localThreads.clear()
    threadIntent.clear()
    rebuild(null)
    freeCount = 0
  }

  async function runPlan(): Promise<void> {
    if (!planArgs) return
    resetLesson()
    dispatch(planArgs)
    const f = begin({ kind: 'plan' })
    try {
      await limiter.acquire(f.ctrl.signal)
    } catch {
      end(f)
      return
    }
    await withSlot(f, async (free) => {
      const rs = createRecordStream({
        mode: 'plan',
        onRecord: (r) => {
          if (alive(f)) dispatch({ type: 'plan/record', record: r as PlanRecord })
        },
        onReject: () => {},
      })
      const req = request('plan', intents.plan, { topic: planArgs?.topic ?? '' })
      const stop = await streamText(source, req, f.ctrl.signal, (t) => rs.push(t))
      free()
      if (!alive(f)) return
      rs.end(stop)
      const s = state()
      if (!s || (s.plan.length === 0 && s.scope?.verdict !== 'declined')) {
        fail(f, { kind: 'bad-output', message: 'The plan came back without any segments.' })
        return
      }
      dispatch({ type: 'plan/done' })
    })
  }

  // -------------------------------------------------------------------------------------- segments

  function runSegment(f: Flight, key: SegKey) {
    return withSlot(f, async (free) => {
      const view = claim(segOwner(key))
      dispatch({ type: 'seg/stream', key })
      const s0 = state()
      const g0 = s0?.segments[key]
      if (!s0 || !g0) return
      const main = g0.kind === 'main'
      let check: Checked<CheckAction> | undefined
      const pipe = createBoardPipeline({
        segKey: key, mode: 'board', ink: 'lesson', index: view,
        onBeat: (beat) => {
          if (alive(f)) dispatch({ type: 'seg/beat', key, beat })
        },
        onCheck: (c) => {
          check = c // held until any repair resolves
        },
        onAsk: (ask) => {
          if (alive(f)) dispatch({ type: 'seg/ask', key, ask })
        },
        onReject: () => {},
      })
      const stop = await streamText(source, segmentRequest(s0, key), f.ctrl.signal, (t) => pipe.push(t))
      free()
      if (!alive(f)) return // aborted: the trailing partial beat is never dispatched
      const summary = pipe.end(stop)
      if (!alive(f)) return
      if (!replayMode) {
        const bad = badOutput(summary, main)
        if (bad && !state()?.segments[key]?.regenerated) {
          end(f)
          claim(segOwner(key))
          dispatch({ type: 'seg/regenerate', key }) // the pump generates it again
          return
        }
        if (bad) return fail(f, { kind: 'bad-output', message: bad })
      }
      let final = main ? check : undefined
      const repairs: Promise<void>[] = []
      if (!replayMode) {
        for (const a of summary.failed) if (a.t !== 'check') repairs.push(repairStep(rt, f, a))
        if (final && final.verify.status === 'fail') final = await repairCheck(rt, f, final)
      }
      if (!alive(f)) return
      if (final) dispatch({ type: 'seg/check', key, check: final })
      dispatch({ type: 'seg/done', key, summary })
      f.settled = true
      await Promise.all(repairs)
    })
  }

  // --------------------------------------------------------------------------------------- threads

  function runThread(f: Flight, id: string) {
    return withSlot(f, async (free) => {
      const view = claim(threadOwner(id))
      dispatch({ type: 'thread/stream', threadId: id })
      const s0 = state()
      const t = s0?.threads.find((x) => x.id === id)
      if (!s0 || !t) return
      const info = threadIntent.get(id)
      const freeN = s0.threads.filter((x) => !x.askId).findIndex((x) => x.id === id) + 1
      const intent = info ? (info.followUp ? `${info.base}:${info.followUp}` : info.base) : t.askId ? intents.answer(t.askId) : intents.freeAnswer(freeN)
      const req = request('answer', intent, {
        state: s0, question: t.question, targets: t.targets, ...(info?.followUp ? { followUp: info.followUp } : {}),
      })
      const pipe = createBoardPipeline({
        segKey: id, mode: 'answer', ink: 'answer', index: view,
        onBeat: (beat) => {
          if (alive(f)) dispatch({ type: 'thread/beat', threadId: id, beat })
        },
        onCheck: () => {},
        onAsk: () => {},
        onReject: () => {},
      })
      const stop = await streamText(source, req, f.ctrl.signal, (x) => pipe.push(x))
      free()
      if (!alive(f)) return
      const sum = pipe.end(stop)
      if (!alive(f)) return
      if (sum.accepted === 0) return fail(f, { kind: 'bad-output', message: 'The answer came back empty.' })
      dispatch({ type: 'thread/done', threadId: id })
    })
  }

  function newThreadId(s: LessonState): string {
    let n = s.threads.length + 1
    while (s.threads.some((t) => t.id === `t${n}`)) n++
    return `t${n}`
  }

  function openThread(question: string, targets: string[], askId: string | undefined, base: string, followUp?: FollowUpKind): string {
    const s = state()
    if (!s || disposed) return ''
    const threadId = newThreadId(s)
    threadIntent.set(threadId, { base, ...(followUp ? { followUp } : {}) })
    dispatch({ type: 'interrupt/ask', threadId, question: capChars(question, QUESTION_MAX), targets, ...(askId ? { askId } : {}) })
    return threadId
  }

  // -------------------------------------------------------------------------------------- recap

  function runRecap(f: Flight) {
    return withSlot(f, async (free) => {
      dispatch({ type: 'recap/stream' })
      const s0 = state()
      if (!s0) return
      const practice = new Map<string, Action>()
      const rs = createRecordStream({
        mode: 'recap',
        onRecord: (r) => {
          if (!alive(f)) return
          const rec = r as RecapRecord
          if (rec.t !== 'check') return dispatch({ type: 'recap/record', record: rec })
          const v = verifyAction(rec, { index: practice })
          practice.set(rec.id, rec)
          dispatch({ type: 'recap/record', record: v.status === 'fail' ? selfRatingCheck(rec.id) : { ...rec, verify: v } })
        },
        onReject: () => {},
      })
      const stop = await streamText(source, request('recap', intents.recap, { state: s0 }), f.ctrl.signal, (t) => rs.push(t))
      free()
      if (!alive(f)) return
      const { accepted } = rs.end(stop)
      if (accepted === 0) return fail(f, { kind: 'bad-output', message: 'The recap came back empty.' })
      dispatch({ type: 'recap/done' })
    })
  }

  // --------------------------------------------------------------------------------------- public

  function start({ topic }: { topic: string }): Promise<void> {
    if (disposed) return Promise.resolve()
    const id = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `L${deps.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    planArgs = { type: 'lesson/start', id, topic: capChars(topic, TOPIC_MAX), badge: source.badge(), at: new Date(deps.now()).toISOString() }
    return runPlan()
  }

  function ask(q: { question: string; targets: string[]; askId?: string }): string {
    const base = q.askId ? intents.answer(q.askId) : intents.freeAnswer(++freeCount)
    return openThread(q.question, q.targets, q.askId, base)
  }

  function followUp(threadId: string, kind: FollowUpKind) {
    const s = state()
    const t = s?.threads.find((x) => x.id === threadId)
    if (!s || !t) return
    const ov = s.overlay?.kind === 'problem' ? s.overlay.prev : s.overlay
    // interrupt/close records the outcome on the thread on screen, so only close if that is this one.
    if (ov?.threadId === threadId && t.outcome !== kind) dispatch({ type: 'interrupt/close', outcome: kind })
    const base = threadIntent.get(threadId)?.base ?? (t.askId ? intents.answer(t.askId) : intents.freeAnswer(Math.max(1, freeCount)))
    openThread(t.question, t.targets, t.askId, base, kind)
  }

  function report(elementId: string) {
    const s = state()
    const local = s ? localVerification(s, index, elementId) : null
    if (!s || !local || disposed) return
    const threadId = newThreadId(s)
    localThreads.add(threadId)
    dispatch({ type: 'interrupt/ask', threadId, question: REPORT_QUESTION, targets: [elementId] })
    if (replayMode) {
      dispatch({ type: 'thread/beat', threadId, beat: localBeat(threadId, local.el, elementId, local.v) })
      dispatch({ type: 'thread/done', threadId })
      return
    }
    void runReview(rt, { kind: 'review', threadId, elementId })
  }

  function retry() {
    const s = state()
    if (!s || disposed) return
    const jobs = [...failed.values()]
    failed.clear()
    const ov = s.overlay
    if (ov?.kind === 'problem') {
      // After a refresh the controller may not remember the failure; the overlay does.
      const t = ov.retry
      if (!jobs.some((j) => jobKey(j) === jobKey(t))) jobs.unshift(t)
      dispatch({ type: 'error/clear' })
    }
    if (jobs.some((j) => j.kind === 'plan')) {
      planArgs ??= { type: 'lesson/start', id: s.id, topic: s.topic, badge: source.badge(), at: s.createdAt }
      void runPlan()
      return
    }
    for (const j of jobs) {
      if (j.kind === 'review') void runReview(rt, j)
      else retrying.add(jobKey(j))
    }
    schedulePump()
  }

  function cancel() {
    const s = state()
    if (!s || disposed) return
    // Settled flights only have background repairs left: stop those, but the item stays complete.
    const all = [...flights.values()].filter((f) => !f.settled)
    abortAll()
    for (const f of all) markFailed(f.job, ABORTED)
    const waited = all.find((f) => f.job.kind === 'segment' && f.job.key === s.cursor.seg) ??
      all.find((f) => f.job.kind === 'thread' || f.job.kind === 'review') ?? all[0]
    if (waited) dispatch({ type: 'error', error: ABORTED, retry: retryTarget(waited.job) })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    unsubscribe()
    for (const f of flights.values()) f.ctrl.abort()
    flights.clear()
  }

  // --------------------------------------------------------------------------------- subscription

  let last = state()
  rebuild(last)
  const unsubscribe = store.subscribe((st) => {
    const s = st.state
    if (s !== last && (!s || !last || s.id !== last.id || s.createdAt !== last.createdAt)) {
      // A different lesson (or none) is in the store: nothing in flight belongs to it.
      abortAll()
      failed.clear()
      retrying.clear()
      rebuild(s)
    }
    last = s
    schedulePump() // never dispatch from inside a listener: the pump runs in a microtask
  })
  schedulePump()

  return { start, ask, followUp, report, retry, cancel, dispose }
}
