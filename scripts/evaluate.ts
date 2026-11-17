/**
 * Evaluation (Task 20): runs the plan and segment 1 for each topic in scripts/eval-topics.json through the
 * owner's Claude Code, with no retries, and writes docs/evaluation.md with the raw counts.
 *   npm run evaluate [-- --n 20] [-- --model sonnet]
 * One repair call is made per step that fails verification (as the app does), so "after repair" is what a
 * learner would see. Nothing here is cherry-picked: every run is counted.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseLine } from '../src/actions'
import type { Action, CheckAction, PlanRecord } from '../src/actions'
import type { LessonEvent } from '../src/lesson/events'
import { request, segmentRequest, idOf } from '../src/lesson/controller-support'
import { intents } from '../src/lesson/intents'
import { reduce } from '../src/lesson/machine'
import type { LessonState } from '../src/lesson/types'
import { verifyAction } from '../src/maths/verify'
import type { Checked } from '../src/maths/verify'
import type { Beat } from '../src/pipeline/beats'
import { createBoardPipeline } from '../src/pipeline/board-pipeline'
import type { StopReason } from '../src/pipeline/lines'
import { createRecordStream } from '../src/pipeline/record-stream'
import { checkRefs } from '../src/pipeline/refs'
import { SourceError } from '../src/sources/errors'
import { SYSTEM_PROMPT } from '../src/prompts/system'
import { runCli } from '../bridge/spawn'
import topics from './eval-topics.json'

type Run = { text: string; stop: StopReason; model: string; secs: number }

async function claude(user: string, model: string): Promise<Run> {
  const t0 = Date.now()
  let text = ''
  let stop: StopReason = 'aborted'
  let seen = ''
  for await (const e of runCli('claude', { system: SYSTEM_PROMPT, user, model }, new AbortController().signal, { timeoutMs: 300_000 })) {
    if (e.type === 'meta') seen = e.model
    else if (e.type === 'text') text += e.text
    else if (e.type === 'done') stop = e.stop
    else if (e.type === 'error') throw new SourceError(e.kind, e.detail)
  }
  return { text, stop, model: seen, secs: (Date.now() - t0) / 1000 }
}

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }

type Row = {
  topic: string; probe: boolean; verdict: string; planOk: boolean; planRecords: number; planRejected: number; segments: number
  ran: boolean; accepted: number; rejected: number; failedBefore: number; failedAfter: number; repaired: number
  firstTime: boolean; mathStep: number; withExpr: number; checkValid: boolean; hasCheck: boolean; unflagged: number
  secs: number; leaked: boolean; note: string
}

const start = (topic: string): LessonEvent => ({ type: 'lesson/start', id: 'eval', topic, at: new Date(0).toISOString(),
  badge: { mode: 'live', text: 'eval', model: 'eval', billedTo: 'subscription' } })

function checkStructure(c: Checked<CheckAction> | undefined, index: Map<string, Action>): boolean {
  if (!c || c.verify.status === 'fail') return false
  if (c.kind === 'choice') return c.options.filter((o) => o.correct).length === 1
  if (c.kind === 'number' || c.kind === 'expr') return (c.anticipated?.length ?? 0) >= 1
  const others = new Map(index)
  others.delete(c.id)
  return checkRefs(c, others, new Set()).ok
}

async function repair(a: Checked, state: LessonState, index: Map<string, Action>, model: string): Promise<{ fixed: Checked | null; secs: number }> {
  const id = idOf(a)
  if (!id) return { fixed: null, secs: 0 }
  const { verify, ...action } = a
  const req = request('repair', intents.repair(id), { action: action as Action, evidence: verify.evidence ?? 'failed verification', state })
  let run: Run
  try { run = await claude(req.user, model) } catch (e) { if (e instanceof SourceError && e.kind === 'usage-limit') throw e; return { fixed: null, secs: 0 } }
  for (const raw of run.text.split(/\r?\n/)) {
    const line = raw.trim()
    const p = line.startsWith('{') ? parseLine(line, 'board') : null
    if (!p?.ok) continue
    const fix = p.record as Action
    if (fix.t !== a.t || idOf(fix) !== id) continue
    const others = new Map(index)
    others.delete(id)
    if (!checkRefs(fix, others, new Set()).ok) return { fixed: null, secs: run.secs }
    const v = verifyAction(fix, { index: others })
    return { fixed: v.status === 'pass' ? ({ ...fix, verify: v } as Checked) : null, secs: run.secs }
  }
  return { fixed: null, secs: run.secs }
}

async function evalTopic(topic: string, probe: boolean, model: string, modelSeen: { v: string }): Promise<Row> {
  const row: Row = { topic, probe, verdict: '?', planOk: false, planRecords: 0, planRejected: 0, segments: 0, ran: false, accepted: 0, rejected: 0,
    failedBefore: 0, failedAfter: 0, repaired: 0, firstTime: false, mathStep: 0, withExpr: 0, checkValid: false, hasCheck: false, unflagged: 0, secs: 0, leaked: false, note: '' }
  const plan = await claude(request('plan', intents.plan, { topic }).user, model)
  if (plan.model) modelSeen.v = plan.model
  row.secs += plan.secs
  const recs: PlanRecord[] = []
  let planRejected = 0
  const rs = createRecordStream({ mode: 'plan', onRecord: (r) => recs.push(r as PlanRecord), onReject: () => { planRejected++ } })
  rs.push(plan.text)
  rs.end(plan.stop)
  row.planRecords = recs.length
  row.planRejected = planRejected
  const scope = recs.find((r) => r.t === 'scope')
  row.verdict = scope?.t === 'scope' ? scope.verdict : 'none'
  row.segments = recs.filter((r) => r.t === 'segment').length
  row.planOk = planRejected === 0 && plan.stop === 'end' && scope !== undefined
  row.leaked = /Role: plan|<learner_text>|output JSON Lines only|You are Whyboard/i.test(plan.text) || plan.text.includes(SYSTEM_PROMPT.slice(0, 60))
  if (row.verdict === 'declined' || row.segments === 0) { row.note = row.verdict === 'declined' ? 'declined, no lesson' : 'no segments'; return row }

  let state = reduce(null, start(topic))
  for (const record of recs) state = reduce(state, { type: 'plan/record', record })
  state = reduce(state, { type: 'plan/done' })
  const right = state.warmup?.record.options.find((o) => o.correct)
  if (state.warmup && right) state = reduce(state, { type: 'warmup/answer', optionId: right.id })

  const req = segmentRequest(state, 'seg:1')
  const seg = await claude(req.user, model)
  row.secs += seg.secs
  row.ran = true
  const index = new Map<string, Action>()
  const beats: Beat[] = []
  let check: Checked<CheckAction> | undefined
  const pipe = createBoardPipeline({
    segKey: 'seg:1', mode: 'board', ink: 'lesson', index,
    onBeat: (b) => beats.push(b), onCheck: (c) => { check = c }, onAsk: () => {}, onReject: () => {},
  })
  pipe.push(seg.text)
  const sum = pipe.end(seg.stop)
  row.accepted = sum.accepted + 0
  row.rejected = sum.rejected
  row.hasCheck = sum.hasCheck
  row.failedBefore = sum.failed.length
  row.firstTime = sum.failed.length === 0 && sum.rejected === 0 && sum.hasCheck && !sum.truncated
  const actions = beats.flatMap((b) => b.actions)
  const ms = actions.filter((a) => a.t === 'math' || a.t === 'step')
  row.mathStep = ms.length
  row.withExpr = ms.filter((a) => (a.t === 'math' || a.t === 'step') && a.expr !== undefined).length
  // repair: one call per failed step or check, as the app does
  let remaining = sum.failed.length
  const patched = new Map<string, Checked>()
  for (const f of sum.failed) {
    const r = await repair(f, state, index, model)
    row.secs += r.secs
    if (r.fixed) { patched.set(idOf(f) as string, r.fixed); row.repaired++; remaining-- }
  }
  row.failedAfter = remaining
  // independent re-verification: any failing step whose stored status is not 'fail' would show unflagged
  for (const a of [...actions, ...(check ? [check] : [])]) {
    const id = idOf(a)
    if (id && patched.has(id)) continue
    const { verify, ...bare } = a
    const again = verifyAction(bare as Action, { index })
    if (again.status === 'fail' && verify.status !== 'fail') row.unflagged++
  }
  const finalCheck = check && patched.get(check.id) ? (patched.get(check.id) as Checked<CheckAction>) : check
  row.hasCheck = !!finalCheck
  row.checkValid = checkStructure(finalCheck, index)
  return row
}

async function main() {
  const model = arg('model') ?? 'sonnet'
  const n = Number(arg('n') ?? 20)
  const list = [...topics.inScope.map((t) => ({ t, probe: false })), ...topics.probes.map((p) => ({ t: p.topic, probe: true }))].slice(0, n)
  const modelSeen = { v: '' }
  const rows: Row[] = new Array(list.length)
  let next = 0
  let fatal: unknown
  const worker = async () => {
    while (next < list.length && !fatal) {
      const i = next++
      const item = list[i] as (typeof list)[number]
      try {
        rows[i] = await evalTopic(item.t, item.probe, model, modelSeen)
        console.log(`[${i + 1}/${list.length}] ${item.t.slice(0, 60)} -> ${rows[i]?.verdict}`)
      } catch (e) {
        fatal ??= e
      }
    }
  }
  await Promise.all([worker(), worker()])
  if (fatal) {
    console.error(`stopped: ${fatal instanceof Error ? fatal.message : String(fatal)} (done ${rows.filter(Boolean).length}/${list.length}); nothing written`)
    process.exit(1)
  }
  const cli = (() => { try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim() } catch { return 'unknown' } })()
  const date = new Date().toISOString().slice(0, 10)
  const sc = rows.filter((r) => !r.probe)
  const ran = sc.filter((r) => r.ran)
  const sum = (f: (r: Row) => number, rs = ran) => rs.reduce((a, r) => a + f(r), 0)
  const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`)
  const lines = sum((r) => r.accepted + r.rejected)
  const validBefore = sum((r) => r.accepted - r.failedBefore)
  const validAfter = sum((r) => r.accepted - r.failedAfter)
  const accepted = sum((r) => r.accepted)
  const mathStep = sum((r) => r.mathStep)
  const withExpr = sum((r) => r.withExpr)
  const unflagged = rows.reduce((a, r) => a + r.unflagged, 0)
  const md: string[] = []
  md.push('# Evaluation', '')
  md.push(`- Date: ${date}`, `- Model: ${modelSeen.v || model} (via Claude Code, ${cli})`, `- Topics: ${sc.length} in scope + ${rows.length - sc.length} probes. Each runs \`plan\` and, when not declined, \`segment:1\`, once, with no retries. One repair call is made per step that fails verification, as the app does.`, '')
  md.push('- How the recorded starter lessons were made: see [recordings.md](recordings.md).', '', '## Per topic', '')
  md.push('| Topic | Scope | Plan segs | Plan lines rejected | Seg-1 lines (ok / rejected) | Failed steps before / after repair | math+step with expr | Checkpoint valid | First time clean | Seconds |')
  md.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rows.filter((x) => !x.probe)) {
    md.push(`| ${r.topic.replace(/\|/g, '/')} | ${r.verdict} | ${r.segments} | ${r.planRejected} | ${r.ran ? `${r.accepted} / ${r.rejected}` : '-'} | ${r.ran ? `${r.failedBefore} / ${r.failedAfter}` : '-'} | ${r.ran ? `${r.withExpr}/${r.mathStep}` : '-'} | ${r.ran ? (r.checkValid ? 'yes' : 'no') : '-'} | ${r.ran ? (r.firstTime ? 'yes' : 'no') : '-'} | ${r.secs.toFixed(0)} |`)
  }
  md.push('', '## Totals (in-scope topics where segment 1 ran)', '')
  md.push(`- Topics with a segment 1: ${ran.length} of ${sc.length}`)
  md.push(`- Valid lines before repair: ${validBefore} of ${lines} (${pct(validBefore, lines)}); after repair: ${validAfter} of ${lines} (${pct(validAfter, lines)}). A line is valid if it parses, its references resolve and code's check does not fail. Plan lines are excluded here; plan lines rejected: ${sum((r) => r.planRejected, sc)} of ${sum((r) => r.planRecords + r.planRejected, sc)}.`)
  md.push(`- Segments passing verification first time (no rejected line, no failed step, has its check, not truncated): ${ran.filter((r) => r.firstTime).length} of ${ran.length} (${pct(ran.filter((r) => r.firstTime).length, ran.length)})`)
  md.push(`- Failed steps: ${sum((r) => r.failedBefore)} before repair, ${sum((r) => r.repaired)} repaired, ${sum((r) => r.failedAfter)} left flagged`)
  md.push(`- unflagged failed steps: ${unflagged}`)
  md.push(`- Share of math/step lines with expr (so code can check them): ${withExpr} of ${mathStep} (${pct(withExpr, mathStep)})`)
  md.push(`- Checkpoint structure valid (one correct option for choice, anticipated answers for number/expr, resolvable figure for tap/set, verification not failed): ${ran.filter((r) => r.checkValid).length} of ${ran.length} (${pct(ran.filter((r) => r.checkValid).length, ran.length)})`)
  md.push(`- Accepted lines in total: ${accepted}`, '')
  md.push('## Probes', '')
  md.push('| Input | Expected | Scope verdict | Lesson produced | System prompt echoed |', '|---|---|---|---|---|')
  for (const r of rows.filter((x) => x.probe)) {
    const exp = topics.probes.find((p) => p.topic === r.topic)?.expect ?? ''
    md.push(`| ${r.topic} | ${exp} | ${r.verdict} | ${r.ran ? `yes (${r.segments} segments)` : 'no'} | ${r.leaked ? 'YES' : 'no'} |`)
  }
  md.push('', '## What this does and does not show', '')
  md.push(`This is one run of ${rows.length} inputs against one model, so it is a snapshot, not a benchmark: the numbers will move from run to run. It shows how often the model's first output survives the app's own validators and how often code's check catches an error, and that every step that fails is flagged rather than hidden (the independent re-check above found ${unflagged} that were not). It does not show that the maths is right where code could not check it: lines without \`expr\`, figures, and the wording of explanations are not verified. It covers the plan and the first segment only, not reteach, later segments or the recap, and it does not measure whether a learner learns anything. The topics are mine, so they are probably easier than a stranger's; the failures are reported as they came.`, '')
  const out = resolve('docs/evaluation.md')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, md.join('\n'))
  console.log(`wrote ${out}\nunflagged failed steps: ${unflagged}`)
}

void main()
