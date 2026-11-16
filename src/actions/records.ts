import { z } from 'zod'
import { ActionSchema, CheckKindNameSchema, Id } from './schema'
import type { Action } from './schema'

const Scope = z.strictObject({
  t: z.literal('scope'), verdict: z.enum(['in', 'adjacent', 'declined']),
  reason: z.string().max(300), suggest: z.array(z.string().max(120)).max(4).optional(),
})
const Objective = z.strictObject({ t: z.literal('objective'), text: z.string().min(1).max(300) })
const Warmup = z.strictObject({
  t: z.literal('warmup'), id: Id, prompt: z.string().max(200),
  options: z
    .array(z.strictObject({ id: z.string().min(1).max(24), text: z.string().max(120), correct: z.boolean() }))
    .min(2)
    .max(4),
})
const Segment = z.strictObject({
  t: z.literal('segment'), n: z.number().int().min(1).max(5), title: z.string().max(120),
  goal: z.string().max(300),
  representation: z.enum(['graph', 'worked', 'table', 'numberline', 'analogy']),
  misconception: z.string().max(300), check: CheckKindNameSchema,
})
export const PlanRecordSchema = z.discriminatedUnion('t', [Scope, Objective, Warmup, Segment])
export type PlanRecord = z.infer<typeof PlanRecordSchema>
export type SegmentPlan = Extract<PlanRecord, { t: 'segment' }>
export type WarmupRecord = Extract<PlanRecord, { t: 'warmup' }>

export const IdeaSchema = z.strictObject({
  t: z.literal('idea'), id: Id, text: z.string().min(1).max(200), seg: z.number().int().min(1),
})
export const VerdictSchema = z.strictObject({
  t: z.literal('verdict'), ok: z.boolean(), say: z.string().max(300), fix: ActionSchema.optional(),
})

export type IdeaRecord = z.infer<typeof IdeaSchema>
export type RecapRecord = IdeaRecord | Action
export type VerdictRecord = z.infer<typeof VerdictSchema>
export type AnyRecord = Action | PlanRecord | RecapRecord | VerdictRecord
