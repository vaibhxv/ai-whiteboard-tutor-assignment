import { z } from 'zod'

export const RecordingSchema = z.object({
  meta: z.object({
    title: z.string(),
    model: z.string(),
    via: z.enum(['claude-code', 'codex', 'anthropic', 'openai', 'gemini', 'openrouter', 'groq']),
    capturedAt: z.string(),
    actionsVersion: z.number().int(),
    selection: z.string(),
  }),
  responses: z.record(z.string(), z.object({ text: z.string(), question: z.string().optional() })),
})

export type Recording = z.infer<typeof RecordingSchema>
