import { z } from 'zod'

export const Id = z.string().regex(/^[A-Za-z][\w-]{0,23}$/)
export const Expr = z.string().min(1).max(200)
export type Id = z.infer<typeof Id>
export type Expr = z.infer<typeof Expr>

const finite = z.number().finite()
const range = z
  .tuple([finite, finite])
  .refine(([a, b]) => a < b, { message: 'range needs min < max' })
const point = z.tuple([finite, finite])
const short = (n: number) => z.string().max(n)

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

const Say = z
  .strictObject({ t: z.literal('say'), text: z.string().min(1) })
  .refine((a) => wordCount(a.text) <= 22, { message: 'say too long' })

const Page = z.strictObject({
  t: z.literal('page'),
  layout: z.enum(['notes', 'split']).optional(),
  title: short(120).optional(),
})
const Write = z.strictObject({
  t: z.literal('write'), id: Id, text: z.string().min(1).max(120),
  role: z.enum(['title', 'line', 'note']).optional(),
})
const Math_ = z.strictObject({
  t: z.literal('math'), id: Id, latex: z.string().min(1).max(200), expr: Expr.optional(),
})
const Step = z.strictObject({
  t: z.literal('step'), id: Id, latex: z.string().min(1).max(200), expr: Expr,
  why: short(160), from: Id.optional(),
})
const Solutions = z.strictObject({
  t: z.literal('solutions'), id: Id, of: Id, var: z.string().min(1).max(8),
  values: z.array(finite).max(8), latex: z.string().min(1).max(200),
})
const Plot = z.strictObject({
  t: z.literal('plot'), id: Id, x: range, y: range,
  fns: z.array(z.strictObject({ id: Id, expr: Expr, label: short(60).optional() })).max(4),
})
const Point = z.strictObject({
  t: z.literal('point'), id: Id, plot: Id, at: point, label: short(60).optional(), on: Id.optional(),
})
const Line = z.strictObject({
  t: z.literal('line'), id: Id, plot: Id, from: point, to: point,
  label: short(60).optional(), dashed: z.boolean().optional(),
})
const Guide = z.strictObject({
  t: z.literal('guide'), id: Id, plot: Id, x: finite.optional(), y: finite.optional(),
  label: short(60).optional(),
})
const NumberLine = z.strictObject({
  t: z.literal('numberline'), id: Id, range,
  marks: z.array(z.strictObject({ at: finite, label: short(60).optional() })).max(20),
})
const Table = z.strictObject({
  t: z.literal('table'), id: Id, head: z.array(short(60)).min(1).max(8),
  rows: z.array(z.array(short(60)).max(8)).max(12), fn: Expr.optional(),
})
const Mark = z.strictObject({
  t: z.literal('mark'), kind: z.enum(['circle', 'underline', 'arrow', 'box']),
  target: Id, note: short(60).optional(),
})
const Explore = z.strictObject({
  t: z.literal('explore'), id: Id, x: range, y: range, expr: Expr, prompt: short(200),
  params: z
    .array(
      z
        .strictObject({ name: z.string().min(1).max(8), min: finite, max: finite, start: finite })
        .refine((p) => p.min < p.start && p.start < p.max, { message: 'need min < start < max' }),
    )
    .min(1)
    .max(2),
})
const Ask = z.strictObject({ t: z.literal('ask'), id: Id, text: z.string().min(1).max(200) })

const checkBase = {
  t: z.literal('check'), id: Id, prompt: short(200),
  explain: short(160), hint: short(160), idea: Id.optional(),
}
const anticipated = z
  .array(z.strictObject({ value: Expr, misconception: short(160) }))
  .max(6)
  .optional()
const Check = z.discriminatedUnion('kind', [
  z.strictObject({
    ...checkBase, kind: z.literal('choice'),
    options: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(24), text: short(120), correct: z.boolean(),
          misconception: short(160).optional(), value: Expr.optional(),
        }),
      )
      .min(2)
      .max(6),
  }),
  z.strictObject({
    ...checkBase, kind: z.literal('number'), answer: Expr,
    tolerance: finite.min(0).optional(), anticipated,
  }),
  z.strictObject({
    ...checkBase, kind: z.literal('expr'), answer: Expr,
    variable: z.string().min(1).max(8), anticipated,
  }),
  z.strictObject({ ...checkBase, kind: z.literal('tap'), figure: Id, answer: Id }),
  z.strictObject({
    ...checkBase, kind: z.literal('set'), explore: Id, param: z.string().min(1).max(8), target: range,
  }),
])

export const ActionSchema = z.union([
  z.discriminatedUnion('t', [
    Say, Page, Write, Math_, Step, Solutions, Plot, Point, Line, Guide, NumberLine, Table,
    Mark, Explore, Ask,
  ]),
  Check,
])

export type Action = z.infer<typeof ActionSchema>
export type CheckAction = Extract<Action, { t: 'check' }>
export type AskAction = Extract<Action, { t: 'ask' }>
export type CheckKindName = CheckAction['kind']
export const CheckKindNameSchema = z.enum(['choice', 'number', 'expr', 'tap', 'set'])

export const ACTION_TYPES = [
  'say', 'page', 'write', 'math', 'step', 'solutions', 'plot', 'point', 'line', 'guide',
  'numberline', 'table', 'mark', 'explore', 'check', 'ask',
] as const
export const ANSWER_ACTIONS = ['say', 'write', 'math', 'step', 'mark', 'point', 'line', 'guide'] as const
