/**
 * Live smoke check for the prompts (Task 13, step 4). Uses the owner's own `claude` CLI and subscription:
 *   npx tsx scripts/smoke-prompt.ts [outDir]
 * Runs three real calls through the real pipelines:
 *   1. plan    "Why is the vertex of a parabola halfway between its roots?"  → createRecordStream('plan')
 *   2. segment n = 1, built from that plan                                   → createBoardPipeline('board')
 *   3. answer  "why halfway?" against segment 1's board                      → createBoardPipeline('answer')
 *   4. segment n = 2 (and the plan's first "worked" segment if different), after segment 1's checkpoint
 *      is answered right                                                     → createBoardPipeline('board')
 * and prints a summary per call. Raw outputs are written to outDir (default: a fresh temp dir).
 * With --extended it also runs reteach (a wrong answer at the segment 1 checkpoint) and recap.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCli } from '../bridge/spawn'
import type { Action, PlanRecord } from '../src/actions'
import type { LessonEvent } from '../src/lesson/events'
import { reduce } from '../src/lesson/machine'
import type { LessonState, SegKey } from '../src/lesson/types'
import type { Beat } from '../src/pipeline/beats'
import { createBoardPipeline } from '../src/pipeline/board-pipeline'
import type { StopReason } from '../src/pipeline/lines'
import { createRecordStream } from '../src/pipeline/record-stream'
import { verifyAction } from '../src/maths/verify'
import { buildUserMessage } from '../src/prompts/context'
import { ROLE_CAPS } from '../src/prompts/roles'
import { SYSTEM_PROMPT } from '../src/prompts/system'
import type { Role } from '../src/sources/types'

const TOPIC = 'Why is the vertex of a parabola halfway between its roots?'
const QUESTION = 'why halfway?'
const CALL_TIMEOUT_MS = 240_000

type CallResult = { text: string; raw: string; stop: StopReason; ttfMs: number | null; totalMs: number; usage?: unknown; stderr: string }

/**
 * One `claude -p` call through the bridge's runner (bridge/spawn.ts → bridge/claude.ts `claudeArgs`):
 * argument array, prompt on stdin, allowlisted env, fresh temp cwd removed afterwards.
 */
async function runClaude(user: string, onText: (t: string) => void): Promise<CallResult> {
  const t0 = Date.now()
  let raw = ''
  let text = ''
  let stderr = ''
  let ttfMs: number | null = null
  let usage: unknown
  let stop: StopReason = 'aborted'
  const onLine = (line: string) => {
    raw += line + '\n'
    try {
      const o = JSON.parse(line) as { type?: string; usage?: unknown }
      if (o.type === 'result') usage = o.usage // raw usage keeps the thinking-token split
    } catch { /* not JSON */ }
  }
  for await (const e of runCli('claude', { system: SYSTEM_PROMPT, user, model: 'sonnet' }, new AbortController().signal, { timeoutMs: CALL_TIMEOUT_MS, onLine })) {
    if (e.type === 'text') {
      if (ttfMs === null) ttfMs = Date.now() - t0
      text += e.text
      onText(e.text)
    } else if (e.type === 'done') {
      stop = e.stop
    } else if (e.type === 'error') {
      stop = 'aborted'
      stderr = `${e.kind}: ${e.detail ?? ''}`
    }
  }
  return { text, raw, stop, ttfMs, totalMs: Date.now() - t0, usage, stderr }
}

type Summary = Record<string, unknown>

/** math/step lines that carry expr: how many verified pass, unchecked or fail. */
function mathShare(beats: Beat[]): string {
  const ms = beats.flatMap((b) => b.actions).filter((a) => (a.t === 'math' || a.t === 'step') && a.expr !== undefined)
  const n = (st: string) => ms.filter((a) => a.verify.status === st).length
  const noExpr = beats.flatMap((b) => b.actions).filter((a) => a.t === 'math' && a.expr === undefined).length
  return `${ms.length} with expr: ${n('pass')} pass, ${n('unchecked')} unchecked, ${n('fail')} fail; ${noExpr} math without expr`
}

function fmtMs(ms: number | null): string {
  return ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`
}

function printSummary(name: string, s: Summary, rejects: { line: string; reason: string }[], failed: { id?: string; t: string; evidence?: string }[]) {
  console.log(`\n=== ${name} ===`)
  for (const [k, v] of Object.entries(s)) console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  for (const r of rejects) console.log(`  REJECT ${r.reason} :: ${r.line.slice(0, 160)}`)
  for (const f of failed) console.log(`  FAILED ${f.t} ${f.id ?? ''} :: ${f.evidence ?? ''}`)
}

async function main() {
  const argv = process.argv.slice(2)
  const extended = argv.includes('--extended')
  const outArg = argv.find((a) => !a.startsWith('--'))
  const outDir = resolve(outArg ?? mkdtempSync(join(tmpdir(), 'whyboard-smoke-out-')))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'system.txt'), SYSTEM_PROMPT)
  const save = (name: string, user: string, r: CallResult) => {
    writeFileSync(join(outDir, `${name}.user.txt`), user)
    writeFileSync(join(outDir, `${name}.out.txt`), r.text)
    writeFileSync(join(outDir, `${name}.stream.jsonl`), r.raw)
    if (r.stderr) writeFileSync(join(outDir, `${name}.stderr.txt`), r.stderr)
  }
  const summaries: Record<string, Summary> = {}
  const usageOf = (r: CallResult, role: Role) => {
    const u = r.usage as { output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } } | undefined
    if (u?.output_tokens === undefined) return 'n/a'
    const thinking = u.output_tokens_details?.thinking_tokens ?? 0
    return `${u.output_tokens - thinking} text + ${thinking} thinking / cap ${ROLE_CAPS[role]}`
  }

  // 1. plan ------------------------------------------------------------------------------------------
  const planUser = buildUserMessage('plan', { topic: TOPIC })
  const planRecords: PlanRecord[] = []
  const planRejects: { line: string; reason: string }[] = []
  const planStream = createRecordStream({
    mode: 'plan',
    onRecord: (r) => planRecords.push(r as PlanRecord),
    onReject: (line, reason) => planRejects.push({ line, reason }),
  })
  const plan = await runClaude(planUser, (t) => planStream.push(t))
  const planCounts = planStream.end(plan.stop)
  save('plan', planUser, plan)
  const jsonLines = plan.text.split('\n').map((l) => l.trim()).filter(Boolean)
  const secondT = (() => {
    try {
      return (JSON.parse(jsonLines[1] ?? '') as { t?: string }).t
    } catch {
      return undefined
    }
  })()
  summaries.plan = {
    records: planCounts.accepted + planCounts.rejected, accepted: planCounts.accepted, rejected: planCounts.rejected,
    order: planRecords.map((r) => r.t).join(','), warmupOnLine2: secondT === 'warmup',
    segments: planRecords.filter((r) => r.t === 'segment').length, stop: plan.stop,
    timeToFirstText: fmtMs(plan.ttfMs), total: fmtMs(plan.totalMs), outputTokens: usageOf(plan, 'plan'),
  }
  printSummary('plan', summaries.plan, planRejects, [])

  // lesson state from the plan --------------------------------------------------------------------------
  let state = reduce(null, { type: 'lesson/start', id: 'smoke', topic: TOPIC, at: new Date(0).toISOString(),
    badge: { mode: 'live', text: 'LIVE · Claude Code on this computer', model: 'claude', billedTo: 'subscription' } })
  const apply = (es: LessonEvent[]) => { for (const e of es) state = reduce(state, e) }
  apply(planRecords.map((record): LessonEvent => ({ type: 'plan/record', record })))
  apply([{ type: 'plan/done' }])
  const warm = state.warmup?.record.options.find((o) => !o.correct)
  if (warm) apply([{ type: 'warmup/answer', optionId: warm.id }])
  if (state.plan.length === 0) {
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2))
    console.log('\nNo segments planned; stopping.')
    return
  }

  // 2. segment 1 -----------------------------------------------------------------------------------------
  const index = new Map<string, Action>()
  const board = (key: SegKey, mode: 'board' | 'answer', events: LessonEvent[]) => {
    const beats: Beat[] = []
    const rejects: { line: string; reason: string }[] = []
    const asks: string[] = []
    const p = createBoardPipeline({
      segKey: key, mode, ink: mode === 'answer' ? 'answer' : 'lesson', index,
      onBeat: (beat) => { beats.push(beat); events.push({ type: 'seg/beat', key, beat }) },
      onCheck: (check) => events.push({ type: 'seg/check', key, check }),
      onAsk: (ask) => { asks.push(ask.text); events.push({ type: 'seg/ask', key, ask }) },
      onReject: (line, reason) => rejects.push({ line, reason }),
    })
    return { p, beats, rejects, asks }
  }
  const segUser = buildUserMessage('segment', { state, n: 1 })
  const segEvents: LessonEvent[] = [{ type: 'seg/stream', key: 'seg:1' }]
  const seg = board('seg:1', 'board', segEvents)
  const segRun = await runClaude(segUser, (t) => seg.p.push(t))
  const segSum = seg.p.end(segRun.stop)
  segEvents.push({ type: 'seg/done', key: 'seg:1', summary: segSum })
  save('segment-1', segUser, segRun)
  apply(segEvents)
  const longSays = seg.beats.filter((b) => b.say.trim().split(/\s+/).length > 22).length
  const segMath = mathShare(seg.beats)
  summaries.segment = {
    records: segSum.accepted + segSum.rejected, accepted: segSum.accepted, rejected: segSum.rejected,
    failed: segSum.failed.length, hasCheck: segSum.hasCheck, beats: seg.beats.length, asks: seg.asks.length,
    passed: seg.beats.flatMap((b) => b.actions).filter((a) => a.verify.status === 'pass').length,
    unchecked: seg.beats.flatMap((b) => b.actions).filter((a) => a.verify.status === 'unchecked').length,
    checkKind: state.segments['seg:1']?.check?.kind, checkVerify: state.segments['seg:1']?.check?.verify.status,
    mathStep: segMath, saysOver22: longSays, stop: segRun.stop, truncated: segSum.truncated,
    timeToFirstText: fmtMs(segRun.ttfMs), total: fmtMs(segRun.totalMs), outputTokens: usageOf(segRun, 'segment'),
  }
  printSummary('segment 1', summaries.segment, seg.rejects,
    segSum.failed.map((f) => ({ id: 'id' in f ? String(f.id) : undefined, t: f.t, evidence: f.verify.evidence })))

  // 3. answer --------------------------------------------------------------------------------------------
  const atSegEnd = state
  // Ask once the first figure has been drawn (or at the end of the segment if there is none).
  const plotId = [...index.values()].find((a) => a.t === 'plot')?.id
  const plotBeat = seg.beats.findIndex((b) => b.actions.some((a) => a.t === 'plot'))
  const until = plotBeat >= 0 ? plotBeat + 1 : seg.beats.length
  for (let i = 0; i < until && state.phase === 'teaching'; i++) apply([{ type: 'player/advance' }])
  const targets = plotId ? [plotId] : []
  apply([{ type: 'interrupt/ask', threadId: 't1', question: QUESTION, targets }])
  const ansUser = buildUserMessage('answer', { state, question: QUESTION, targets })
  const ans = board('answer:t1' as SegKey, 'answer', [])
  const ansRun = await runClaude(ansUser, (t) => ans.p.push(t))
  const ansSum = ans.p.end(ansRun.stop)
  save('answer', ansUser, ansRun)
  const lastLine = ansRun.text.trim().split('\n').pop() ?? ''
  summaries.answer = {
    records: ansSum.accepted + ansSum.rejected, accepted: ansSum.accepted, rejected: ansSum.rejected,
    failed: ansSum.failed.length, beats: ans.beats.length, endsWithSay: /"t"\s*:\s*"say"/.test(lastLine),
    marksLessonIds: ans.beats.flatMap((b) => b.actions).filter((a) => a.t === 'mark' && !a.target.startsWith('a')).length,
    stop: ansRun.stop, timeToFirstText: fmtMs(ansRun.ttfMs), total: fmtMs(ansRun.totalMs), outputTokens: usageOf(ansRun, 'answer'),
  }
  printSummary('answer', summaries.answer, ans.rejects,
    ansSum.failed.map((f) => ({ id: 'id' in f ? String(f.id) : undefined, t: f.t, evidence: f.verify.evidence })))

  // 4. segment 2 (and the first worked segment): seg 1 answered right at its checkpoint first -------------
  const extraRejects: Record<string, { line: string; reason: string }[]> = {}
  if (state.plan.length >= 2) {
    state = atSegEnd
    for (let i = 0; i < 40 && state.phase !== 'checkpoint'; i++) apply([{ type: 'player/advance' }])
    const c1 = state.segments['seg:1']?.check
    if (state.phase === 'checkpoint' && c1) {
      apply([{ type: 'check/answer', checkId: c1.id, grade: { result: 'correct', branch: 'correct' } }])
    }
    // Segment 2, plus the plan's first "worked" (algebra) segment if that is not segment 2.
    const workedN = state.plan.find((p) => p.representation === 'worked')?.n
    for (const n of workedN !== undefined && workedN !== 2 ? [2, workedN] : [2]) {
      const key: SegKey = `seg:${n}`
      const user = buildUserMessage('segment', { state, n })
      const events: LessonEvent[] = [{ type: 'seg/stream', key }]
      const g = board(key, 'board', events)
      const r = await runClaude(user, (t) => g.p.push(t))
      const sum = g.p.end(r.stop)
      events.push({ type: 'seg/done', key, summary: sum })
      save(`segment-${n}`, user, r)
      apply(events)
      extraRejects[`segment${n}`] = g.rejects
      const sk = `segment${n}`
      summaries[sk] = {
        representation: state.plan[n - 1]?.representation, records: sum.accepted + sum.rejected, accepted: sum.accepted,
        rejected: sum.rejected, failed: sum.failed.length, hasCheck: sum.hasCheck, beats: g.beats.length, asks: g.asks.length,
        checkKind: state.segments[key]?.check?.kind, checkVerify: state.segments[key]?.check?.verify.status,
        mathStep: mathShare(g.beats), stop: r.stop,
        timeToFirstText: fmtMs(r.ttfMs), total: fmtMs(r.totalMs), outputTokens: usageOf(r, 'segment'),
      }
      printSummary(`segment ${n}`, summaries[sk] as Summary, g.rejects,
        sum.failed.map((f) => ({ id: 'id' in f ? String(f.id) : undefined, t: f.t, evidence: f.verify.evidence })))
    }
  }

  if (extended) {
    // 4. reteach: a wrong answer at the segment 1 checkpoint -------------------------------------------
    state = atSegEnd
    for (let i = 0; i < 40 && state.phase !== 'checkpoint'; i++) apply([{ type: 'player/advance' }])
    const chk = state.segments['seg:1']?.check
    if (state.phase === 'checkpoint' && chk) {
      const wrong = chk.kind === 'choice' ? chk.options.find((o) => !o.correct) : undefined
      const anticipated = chk.kind === 'number' || chk.kind === 'expr' ? chk.anticipated?.[0] : undefined
      const branch = wrong?.id ?? (anticipated ? 'a0' : 'other')
      const misconception = wrong?.misconception ?? anticipated?.misconception
      apply([{ type: 'check/answer', checkId: chk.id, grade: { result: 'wrong', branch, ...(misconception ? { misconception } : {}) } }])
      const key = state.cursor.seg
      const rtUser = buildUserMessage('reteach', { state, checkId: chk.id, branch, ...(misconception ? { misconception } : {}) })
      const rtEvents: LessonEvent[] = [{ type: 'seg/stream', key }]
      const rt = board(key, 'board', rtEvents)
      const rtRun = await runClaude(rtUser, (t) => rt.p.push(t))
      const rtSum = rt.p.end(rtRun.stop)
      rtEvents.push({ type: 'seg/done', key, summary: rtSum })
      save('reteach', rtUser, rtRun)
      apply(rtEvents)
      extraRejects.reteach = rt.rejects
      summaries.reteach = {
        records: rtSum.accepted + rtSum.rejected, accepted: rtSum.accepted, rejected: rtSum.rejected, failed: rtSum.failed.length,
        hasCheck: rtSum.hasCheck, beats: rt.beats.length, branch, stop: rtRun.stop,
        timeToFirstText: fmtMs(rtRun.ttfMs), total: fmtMs(rtRun.totalMs), outputTokens: usageOf(rtRun, 'reteach'),
      }
      printSummary('reteach', summaries.reteach, rt.rejects,
        rtSum.failed.map((f) => ({ id: 'id' in f ? String(f.id) : undefined, t: f.t, evidence: f.verify.evidence })))
    }

    // 5. recap -----------------------------------------------------------------------------------------
    const rcUser = buildUserMessage('recap', { state })
    const recs: { t: string; id?: string; idea?: string }[] = []
    const rcRejects: { line: string; reason: string }[] = []
    const rcFailed: { id?: string; t: string; evidence?: string }[] = []
    const rcStream = createRecordStream({
      mode: 'recap',
      onRecord: (r) => {
        recs.push(r as { t: string; id?: string })
        if (r.t === 'check') {
          const v = verifyAction(r, { index })
          if (v.status === 'fail') rcFailed.push({ id: r.id, t: r.t, ...(v.evidence ? { evidence: v.evidence } : {}) })
        }
      },
      onReject: (line, reason) => rcRejects.push({ line, reason }),
    })
    const rcRun = await runClaude(rcUser, (t) => rcStream.push(t))
    const rcCounts = rcStream.end(rcRun.stop)
    save('recap', rcUser, rcRun)
    extraRejects.recap = rcRejects
    const checks = recs.filter((r) => r.t === 'check')
    const ideaIds = new Set(recs.filter((r) => r.t === 'idea').map((r) => r.id))
    summaries.recap = {
      records: rcCounts.accepted + rcCounts.rejected, accepted: rcCounts.accepted, rejected: rcCounts.rejected, failed: rcFailed.length,
      order: recs.map((r) => r.t).join(','), ideas: ideaIds.size, says: recs.filter((r) => r.t === 'say').length,
      checks: checks.map((c) => c.id).join(','), checksLinkIdeas: checks.every((c) => c.idea !== undefined && ideaIds.has(c.idea)),
      stop: rcRun.stop, timeToFirstText: fmtMs(rcRun.ttfMs), total: fmtMs(rcRun.totalMs), outputTokens: usageOf(rcRun, 'recap'),
    }
    printSummary('recap', summaries.recap, rcRejects, rcFailed)
  }

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ summaries, rejects: { plan: planRejects, segment: seg.rejects, answer: ans.rejects, ...extraRejects } }, null, 2))
  console.log(`\nRaw outputs: ${outDir}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
