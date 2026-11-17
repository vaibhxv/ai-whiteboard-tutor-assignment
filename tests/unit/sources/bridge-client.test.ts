import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createBridgeSource, readinessFor, statusLine } from '../../../src/sources/bridge-client'
import { createActiveSource, noKeys } from '../../../src/sources/create'
import { SourceError } from '../../../src/sources/errors'
import type { GenEvent, GenRequest } from '../../../src/sources/types'
import { DEFAULT_SETTINGS } from '../../../src/storage/settings'

const req: GenRequest = { role: 'segment', intent: 'segment:1', system: 'SYS', user: 'hello', maxOutputTokens: 1800 }
const TOKEN = 'ab'.repeat(32)

beforeEach(() => {
  const m = document.createElement('meta')
  m.name = 'whyboard-bridge-token'
  m.content = TOKEN
  document.head.appendChild(m)
})
afterEach(() => {
  document.head.querySelectorAll('meta[name="whyboard-bridge-token"]').forEach((m) => m.remove())
  vi.unstubAllGlobals()
})

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
const resp = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })

async function collect(it: AsyncIterable<GenEvent>) {
  const out: GenEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

test('badge is LIVE · Claude Code / Codex on this computer', () => {
  expect(createBridgeSource({ cli: 'claude' }).badge()).toMatchObject({ mode: 'live', text: 'LIVE · Claude Code on this computer', billedTo: 'subscription' })
  expect(createBridgeSource({ cli: 'codex' }).badge().text).toBe('LIVE · Codex on this computer')
  expect(createBridgeSource({ cli: 'claude' }).id).toBe('claude-code')
  expect(createBridgeSource({ cli: 'codex' }).id).toBe('codex')
})

test('generate POSTs to /bridge/generate with the meta token and yields the SSE events', async () => {
  const events = [
    { type: 'meta', model: 'claude-sonnet-5-5', billedTo: 'subscription' },
    { type: 'text', text: 'a' }, { type: 'text', text: 'bc' }, { type: 'done', stop: 'end' },
  ]
  const f = vi.fn(async (..._a: unknown[]) => resp(sse(events)))
  vi.stubGlobal('fetch', f)
  const out = await collect(createBridgeSource({ cli: 'claude' }).generate(req, new AbortController().signal))
  expect(out).toEqual(events)
  const [url, init] = f.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/bridge/generate')
  expect(init.method).toBe('POST')
  expect((init.headers as Record<string, string>)['x-whyboard-token']).toBe(TOKEN)
  expect(JSON.parse(init.body as string)).toEqual({ cli: 'claude', model: 'sonnet', system: 'SYS', user: 'hello', role: 'segment' })
})

test('codex sends no model unless one is chosen', async () => {
  const f = vi.fn(async (..._a: unknown[]) => resp(sse([{ type: 'done', stop: 'end' }])))
  vi.stubGlobal('fetch', f)
  await collect(createBridgeSource({ cli: 'codex' }).generate(req, new AbortController().signal))
  expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)).not.toHaveProperty('model')
})

test('in-band error events become thrown SourceErrors', async () => {
  vi.stubGlobal('fetch', async () => resp(sse([{ type: 'text', text: 'a' }, { type: 'error', kind: 'cli-signed-out', detail: 'Not logged in' }])))
  const it = createBridgeSource({ cli: 'claude' }).generate(req, new AbortController().signal)
  await expect(collect(it)).rejects.toMatchObject({ name: 'SourceError', kind: 'cli-signed-out' })
})

test('a stream that ends without done is reported as truncated', async () => {
  vi.stubGlobal('fetch', async () => resp(sse([{ type: 'text', text: 'a' }])))
  const out = await collect(createBridgeSource({ cli: 'claude' }).generate(req, new AbortController().signal))
  expect(out.at(-1)).toEqual({ type: 'done', stop: 'length' })
})

test('HTTP failures and an unreachable bridge throw SourceErrors; abort yields done aborted', async () => {
  vi.stubGlobal('fetch', async () => new Response('bad token', { status: 401 }))
  await expect(collect(createBridgeSource({ cli: 'claude' }).generate(req, new AbortController().signal))).rejects.toBeInstanceOf(SourceError)
  vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
  await expect(collect(createBridgeSource({ cli: 'claude' }).generate(req, new AbortController().signal))).rejects.toMatchObject({ kind: 'offline' })
  const ac = new AbortController()
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
    ac.abort()
    throw Object.assign(new Error('aborted'), { name: 'AbortError', signal: init.signal })
  })
  expect(await collect(createBridgeSource({ cli: 'claude' }).generate(req, ac.signal))).toEqual([{ type: 'done', stop: 'aborted' }])
})

test('no token meta → a clear error without calling fetch', async () => {
  document.head.querySelectorAll('meta[name="whyboard-bridge-token"]').forEach((m) => m.remove())
  const f = vi.fn()
  vi.stubGlobal('fetch', f)
  await expect(collect(createBridgeSource({ cli: 'claude' }).generate(req, new AbortController().signal))).rejects.toBeInstanceOf(SourceError)
  expect(f).not.toHaveBeenCalled()
})

test('preflight maps /bridge/status to Readiness with the next step', async () => {
  const status = (claude: unknown, codex: unknown = { installed: false }) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('/bridge/status')
    return new Response(JSON.stringify({ claude, codex }), { status: 200 })
  }))
  status({ installed: true, version: '2.1.326', signedIn: true, plan: 'max' })
  expect(await createBridgeSource({ cli: 'claude' }).preflight()).toEqual({ ready: true })
  status({ installed: false })
  expect(await createBridgeSource({ cli: 'claude' }).preflight()).toEqual({
    ready: false, reason: 'cli-missing', action: 'Install Claude Code, then run "claude" once to sign in.',
  })
  status({ installed: true, signedIn: false })
  expect(await createBridgeSource({ cli: 'claude' }).preflight()).toEqual({
    ready: false, reason: 'cli-signed-out', action: 'Run "claude" in a terminal and sign in.',
  })
  status({ installed: true }, { installed: false })
  expect(await createBridgeSource({ cli: 'codex' }).preflight()).toEqual({
    ready: false, reason: 'cli-missing', action: 'Install Codex, then run "codex" once to sign in.',
  })
  status({ installed: true }, { installed: true, signedIn: false })
  expect(await createBridgeSource({ cli: 'codex' }).preflight()).toEqual({
    ready: false, reason: 'cli-signed-out', action: 'Run "codex" in a terminal and sign in.',
  })
  vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
  expect(await createBridgeSource({ cli: 'claude' }).preflight()).toMatchObject({ ready: false, reason: 'offline' })
})

test('readinessFor and statusLine describe each state in words', () => {
  expect(readinessFor('claude', { installed: true, signedIn: true })).toEqual({ ready: true })
  expect(statusLine('claude', { installed: true, version: '2.1.326', signedIn: true, plan: 'max' }))
    .toEqual({ ok: true, text: 'Ready · max plan · Claude Code 2.1.326' })
  expect(statusLine('claude', { installed: false }))
    .toEqual({ ok: false, text: 'Not installed. Install Claude Code, then run "claude" once to sign in.' })
  expect(statusLine('claude', { installed: true, version: '2.1.326', signedIn: false }))
    .toEqual({ ok: false, text: 'Signed out. Run "claude" in a terminal and sign in.' })
  expect(statusLine('codex', { installed: true, version: '0.99.0', signedIn: true }).text).toMatch(/^Ready · Codex 0\.99\.0/)
})

test('createActiveSource: subscriptions are null in the public build, bridge sources when local', async () => {
  expect(createActiveSource({ ...DEFAULT_SETTINGS, sourceId: 'claude-code' }, noKeys)).toBeNull()
  expect(createActiveSource({ ...DEFAULT_SETTINGS, sourceId: 'codex' }, noKeys)).toBeNull()
  vi.stubGlobal('__LOCAL__', true)
  const src = createActiveSource({ ...DEFAULT_SETTINGS, sourceId: 'claude-code' }, noKeys)!
  expect(src.id).toBe('claude-code')
  expect(src.badge().text).toBe('LIVE · Claude Code on this computer')
  const f = vi.fn(async (..._a: unknown[]) => resp(sse([{ type: 'text', text: 'x' }, { type: 'done', stop: 'end' }])))
  vi.stubGlobal('fetch', f)
  expect(await collect(src.generate(req, new AbortController().signal))).toEqual([{ type: 'text', text: 'x' }, { type: 'done', stop: 'end' }])
  expect(createActiveSource({ ...DEFAULT_SETTINGS, sourceId: 'codex' }, noKeys)!.badge().text).toBe('LIVE · Codex on this computer')
})
