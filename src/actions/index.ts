import { ACTION_TYPES, ANSWER_ACTIONS, ActionSchema } from './schema'
import { IdeaSchema, PlanRecordSchema, VerdictSchema } from './records'
import type { AnyRecord } from './records'
import type { ZodType } from 'zod'

export * from './schema'
export * from './records'

export type Mode = 'plan' | 'board' | 'answer' | 'recap' | 'review'
export type ParseResult = { ok: true; record: AnyRecord } | { ok: false; reason: string }

const PLAN_TYPES = ['scope', 'objective', 'warmup', 'segment']
const RECAP_ACTIONS = ['say', 'check']

function allowed(mode: Mode, t: string): boolean {
  switch (mode) {
    case 'plan': return PLAN_TYPES.includes(t)
    case 'board': return (ACTION_TYPES as readonly string[]).includes(t)
    case 'answer': return (ANSWER_ACTIONS as readonly string[]).includes(t)
    case 'recap': return t === 'idea' || RECAP_ACTIONS.includes(t)
    case 'review': return t === 'verdict'
  }
}

function schemaFor(t: string): ZodType {
  if (PLAN_TYPES.includes(t)) return PlanRecordSchema
  if (t === 'idea') return IdeaSchema
  if (t === 'verdict') return VerdictSchema
  return ActionSchema
}

export function parseLine(line: string, mode: Mode): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { ok: false, reason: 'invalid JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'not a JSON object' }
  }
  const t = (raw as { t?: unknown }).t
  const known = typeof t === 'string' &&
    ((ACTION_TYPES as readonly string[]).includes(t) || PLAN_TYPES.includes(t) || t === 'idea' || t === 'verdict')
  if (!known) return { ok: false, reason: `unknown action: ${String(t)}` }
  if (!allowed(mode, t)) return { ok: false, reason: `"${t}" not allowed in ${mode} mode` }
  const res = schemaFor(t).safeParse(raw)
  if (res.success) return { ok: true, record: res.data as AnyRecord }
  const i = res.error.issues[0]
  const path = i?.path.join('.')
  return { ok: false, reason: path ? `${path}: ${i?.message}` : (i?.message ?? 'invalid') }
}
