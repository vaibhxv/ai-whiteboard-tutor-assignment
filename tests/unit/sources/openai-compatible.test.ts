import { afterEach, expect, test, vi } from 'vitest'
import { createActiveSource } from '../../../src/sources/create'
import { createOpenAICompatibleSource } from '../../../src/sources/openai-compatible'
import { PROVIDERS } from '../../../src/sources/providers'
import type { GenEvent, GenRequest } from '../../../src/sources/types'
import { DEFAULT_SETTINGS } from '../../../src/storage/settings'

const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
const resp = (body: string, status = 200) => new Response(body, { status })
const req: GenRequest = { role: 'segment', intent: 'segment:1', system: 'SYS', user: 'USR', maxOutputTokens: 1800 }
const run = async (src: { generate: (r: GenRequest, s: AbortSignal) => AsyncIterable<GenEvent> }) => {
  const out: GenEvent[] = []
  for await (const e of src.generate(req, new AbortController().signal)) out.push(e)
  return out
}
afterEach(() => vi.unstubAllGlobals())

const STREAM =
  chunk({ model: 'g', choices: [{ delta: { reasoning: 'thinking', content: null } }] }) +
  chunk({ choices: [{ delta: { reasoning_content: 'more' } }] }) +
  chunk({ choices: [{ delta: { content: 'Hi ' } }] }) +
  chunk({ choices: [{ delta: { content: 'there' }, finish_reason: 'stop' }] }) +
  'data: [DONE]\n\n' + chunk({ choices: [{ delta: { content: 'AFTER' } }] })

test('gemini: Bearer auth to generativelanguage.googleapis.com; reasoning ignored; [DONE] ends the stream', async () => {
  const f = vi.fn(async () => resp(STREAM))
  vi.stubGlobal('fetch', f)
  const out = await run(createOpenAICompatibleSource({ provider: 'gemini', key: 'gk', model: 'gemini-3.8-flash' }))
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer gk')
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'gemini-3.8-flash', stream: true, max_tokens: 7200,
    messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }],
  })
  expect(out.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toBe('Hi there')
  expect(out.at(-1)).toEqual({ type: 'done', stop: 'end' })
})

test('openai uses max_completion_tokens; groq and openrouter use max_tokens', async () => {
  const f = vi.fn(async () => resp('data: [DONE]\n\n'))
  vi.stubGlobal('fetch', f)
  for (const provider of ['openai', 'groq', 'openrouter'] as const) {
    await run(createOpenAICompatibleSource({ provider, key: 'k', model: 'm' }))
  }
  const bodies = f.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))
  expect(bodies[0].max_completion_tokens).toBe(7200)
  expect(bodies[0].max_tokens).toBeUndefined()
  expect(bodies[1].max_tokens).toBe(7200)
  expect(bodies[2].max_tokens).toBe(7200)
})

test('finish_reason length → done length', async () => {
  vi.stubGlobal('fetch', async () => resp(chunk({ choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] }) + 'data: [DONE]\n\n'))
  const out = await run(createOpenAICompatibleSource({ provider: 'openai', key: 'k', model: 'm' }))
  expect(out.at(-1)).toEqual({ type: 'done', stop: 'length' })
})

test.each([[401, 'invalid-key'], [429, 'rate-limit'], [529, 'busy'], [503, 'busy'], [418, 'unknown']])('HTTP %i → %s', async (status, kind) => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status }))
  await expect(run(createOpenAICompatibleSource({ provider: 'groq', key: 'k', model: 'm' }))).rejects.toMatchObject({ kind })
})

test('fetch rejects with TypeError → offline', async () => {
  vi.stubGlobal('fetch', async () => { throw new TypeError('Failed') })
  await expect(run(createOpenAICompatibleSource({ provider: 'groq', key: 'k', model: 'm' }))).rejects.toMatchObject({ kind: 'offline' })
})

test('preflight GETs {base}/models', async () => {
  const f = vi.fn(async () => resp('{}'))
  vi.stubGlobal('fetch', f)
  expect(await createOpenAICompatibleSource({ provider: 'openrouter', key: 'k', model: 'm' }).preflight()).toEqual({ ready: true })
  expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://openrouter.ai/api/v1/models')
})

test('the key is never sent anywhere but the provider base, and every base is a CSP host', async () => {
  const csp = ['https://api.anthropic.com', 'https://api.openai.com', 'https://generativelanguage.googleapis.com', 'https://openrouter.ai', 'https://api.groq.com']
  for (const p of Object.values(PROVIDERS)) expect(csp.some((h) => p.base.startsWith(h + '/'))).toBe(true)
  const f = vi.fn(async () => resp(STREAM))
  vi.stubGlobal('fetch', f)
  const src = createActiveSource({ ...DEFAULT_SETTINGS, sourceId: 'openai-compatible', provider: 'gemini' }, { get: () => 'gk' })!
  await src.preflight()
  await run(src)
  for (const c of f.mock.calls) expect((c as unknown as [string])[0].startsWith(PROVIDERS.gemini.base)).toBe(true)
})

test('badge text per provider', () => {
  expect(createOpenAICompatibleSource({ provider: 'gemini', key: 'k', model: 'm' }).badge().text).toBe('LIVE · Gemini API · m')
  expect(createOpenAICompatibleSource({ provider: 'groq', key: 'k', model: 'm' }).badge().text).toBe('LIVE · Groq · m')
})
