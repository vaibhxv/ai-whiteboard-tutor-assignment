import { afterEach, expect, test, vi } from 'vitest'
import { createAnthropicSource } from '../../../src/sources/anthropic'
import type { GenEvent, GenRequest } from '../../../src/sources/types'

const enc = new TextEncoder()
const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const resp = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
const req: GenRequest = { role: 'plan', intent: 'plan', system: 'SYS', user: 'USR', maxOutputTokens: 800 }
const run = async (src: ReturnType<typeof createAnthropicSource>, signal = new AbortController().signal) => {
  const out: GenEvent[] = []
  for await (const e of src.generate(req, signal)) out.push(e)
  return out
}
afterEach(() => vi.unstubAllGlobals())

const STREAM = sse([
  ['message_start', { type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 10, cache_read_input_tokens: 4 } } }],
  ['content_block_delta', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }],
  ['content_block_delta', { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'x' } }],
  ['content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } }],
  ['content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }],
  ['message_stop', { type: 'message_stop' }],
])

test('request has browser-access header, cache_control on system, stream true; text concatenates; thinking ignored', async () => {
  const f = vi.fn(async () => resp(STREAM))
  vi.stubGlobal('fetch', f)
  const out = await run(createAnthropicSource({ key: 'sk-a', model: 'claude-sonnet-5-5' }))
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://api.anthropic.com/v1/messages')
  expect(init.method).toBe('POST')
  expect(init.headers).toEqual({
    'x-api-key': 'sk-a', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json',
  })
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'claude-sonnet-5-5', max_tokens: 3200, stream: true,
    system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'USR' }],
  })
  expect(out.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toBe('Hello')
  expect(out.find((e) => e.type === 'meta' && e.usage)).toMatchObject({ usage: { inputTokens: 10, outputTokens: 7, cachedInputTokens: 4 } })
  expect(out.at(-1)).toEqual({ type: 'done', stop: 'end' })
})

test('max_tokens stop reason → done length', async () => {
  vi.stubGlobal('fetch', async () => resp(sse([['message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 1 } }]])))
  const out = await run(createAnthropicSource({ key: 'k', model: 'm' }))
  expect(out.at(-1)).toEqual({ type: 'done', stop: 'length' })
})

test.each([[401, 'invalid-key'], [403, 'invalid-key'], [429, 'rate-limit'], [529, 'busy'], [503, 'busy'], [500, 'unknown']])('HTTP %i → %s', async (status, kind) => {
  vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"nope"}}', { status }))
  await expect(run(createAnthropicSource({ key: 'k', model: 'm' }))).rejects.toMatchObject({ kind })
})

test('fetch rejecting with TypeError → offline', async () => {
  vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
  await expect(run(createAnthropicSource({ key: 'k', model: 'm' }))).rejects.toMatchObject({ kind: 'offline' })
})

test('in-stream overloaded_error → busy, other errors → unknown', async () => {
  vi.stubGlobal('fetch', async () => resp(sse([['error', { type: 'error', error: { type: 'overloaded_error', message: 'x' } }]])))
  await expect(run(createAnthropicSource({ key: 'k', model: 'm' }))).rejects.toMatchObject({ kind: 'busy' })
  vi.stubGlobal('fetch', async () => resp(sse([['error', { type: 'error', error: { type: 'api_error', message: 'x' } }]])))
  await expect(run(createAnthropicSource({ key: 'k', model: 'm' }))).rejects.toMatchObject({ kind: 'unknown' })
})

test('an aborted signal ends quietly with done aborted', async () => {
  const ac = new AbortController()
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
    ac.abort()
    throw Object.assign(new Error('aborted'), { name: 'AbortError', signal: init.signal })
  })
  const out = await run(createAnthropicSource({ key: 'k', model: 'm' }), ac.signal)
  expect(out).toEqual([{ type: 'done', stop: 'aborted' }])
})

test('preflight GETs /models with the same headers; maps failures', async () => {
  const f = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', f)
  const src = createAnthropicSource({ key: 'sk', model: 'm' })
  expect(await src.preflight()).toEqual({ ready: true })
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://api.anthropic.com/v1/models')
  expect((init.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true')
  vi.stubGlobal('fetch', async () => new Response('', { status: 401 }))
  expect(await src.preflight()).toMatchObject({ ready: false, reason: 'invalid-key' })
  expect(enc).toBeTruthy()
})

test('badge is exact', () => {
  expect(createAnthropicSource({ key: 'k', model: 'claude-sonnet-5-5' }).badge().text).toBe('LIVE · Anthropic API · claude-sonnet-5-5')
})
