// @vitest-environment node
import { request } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { allowedOrigins, createBridgeServer } from '../../bridge/server'

const TOKEN = 'f'.repeat(64)
const ORIGIN = 'http://localhost:5173'
let server: Server
let port = 0
const seen: { status: number; headers: IncomingHttpHeaders }[] = []

beforeAll(async () => {
  process.env.WHYBOARD_CLAUDE_BIN = resolve('tests/fixtures/fake-claude.mjs')
  process.env.WHYBOARD_CODEX_BIN = resolve('tests/fixtures/fake-codex.mjs')
  server = createBridgeServer({ token: TOKEN, allowedOrigins: allowedOrigins(5173) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
afterAll(async () => {
  delete process.env.WHYBOARD_CLAUDE_BIN
  delete process.env.WHYBOARD_CODEX_BIN
  await new Promise<void>((r) => server.close(() => r()))
})

type Res = { status: number; headers: IncomingHttpHeaders; body: string }

function send(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Res> {
  return new Promise((done, fail) => {
    const req = request({
      host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path ?? '/bridge/status',
      headers: { host: `127.0.0.1:${port}`, ...opts.headers },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (d: string) => { body += d })
      res.on('end', () => {
        seen.push({ status: res.statusCode!, headers: res.headers })
        done({ status: res.statusCode!, headers: res.headers, body })
      })
    })
    req.on('error', fail)
    req.end(opts.body)
  })
}

const gen = (body: unknown, headers: Record<string, string> = {}) => send({
  method: 'POST', path: '/bridge/generate', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-whyboard-token': TOKEN, ...headers },
})
const good = { cli: 'claude', model: 'sonnet', system: 'SYS', user: 'hello', role: 'segment' }

test('allowedOrigins derives both loopback names from the vite port', () => {
  expect(allowedOrigins(5173)).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
  expect(allowedOrigins(6001)).toEqual(['http://localhost:6001', 'http://127.0.0.1:6001'])
})

test('server: Host evil.com → 421; Origin https://evil.com → 403; no token → 401; unknown model → 400; good request streams SSE', async () => {
  expect((await send({ headers: { host: 'evil.com' } })).status).toBe(421)
  expect((await gen(good, { host: 'evil.com:80' })).status).toBe(421)
  expect((await gen(good, { origin: 'https://evil.com' })).status).toBe(403)
  expect((await send({ headers: { origin: 'https://evil.com' } })).status).toBe(403)
  const noTok = await send({ method: 'POST', path: '/bridge/generate', body: JSON.stringify(good), headers: { origin: ORIGIN, 'content-type': 'application/json' } })
  expect(noTok.status).toBe(401)
  expect((await gen(good, { 'x-whyboard-token': 'e'.repeat(64) })).status).toBe(401)
  expect((await gen({ ...good, model: 'gpt-4o' })).status).toBe(400)
  expect((await gen({ ...good, model: 'sonnet; rm -rf /' })).status).toBe(400)
  expect((await gen({ ...good, cli: 'bash' })).status).toBe(400)
  expect((await gen({ ...good, user: 42 })).status).toBe(400)
  expect((await gen('{not json')).status).toBe(400)

  const ok = await gen(good)
  expect(ok.status).toBe(200)
  expect(ok.headers['content-type']).toMatch(/^text\/event-stream/)
  const events = ok.body.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as { type: string; text?: string })
  expect(events[0]).toMatchObject({ type: 'meta', billedTo: 'subscription' })
  expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('abc')
  expect(events.at(-1)).toEqual({ type: 'done', stop: 'end' })
})

test('generate accepts localhost Host and either allowed origin; codex model allow-list applies', async () => {
  expect((await gen(good, { host: `localhost:${port}`, origin: 'http://127.0.0.1:5173' })).status).toBe(200)
  expect((await gen({ ...good, cli: 'codex', model: 'sonnet' })).status).toBe(400)
  const cx = await gen({ ...good, cli: 'codex', model: 'gpt-6.1-terra' })
  expect(cx.status).toBe(200)
  expect(cx.body).toContain('"type":"done"')
  const noModel = await gen({ cli: 'codex', system: 's', user: 'u' })
  expect(noModel.status).toBe(200)
})

test('body over 64 KB → 413; wrong method → 405; unknown path → 404; no origin on generate → 403', async () => {
  expect((await gen({ ...good, user: 'x'.repeat(65 * 1024) })).status).toBe(413)
  expect((await send({ method: 'GET', path: '/bridge/generate', headers: { origin: ORIGIN } })).status).toBe(405)
  expect((await send({ method: 'POST', path: '/bridge/status', headers: { origin: ORIGIN } })).status).toBe(405)
  expect((await send({ path: '/bridge/nope' })).status).toBe(404)
  const noOrigin = await send({ method: 'POST', path: '/bridge/generate', body: JSON.stringify(good), headers: { 'content-type': 'application/json', 'x-whyboard-token': TOKEN } })
  expect(noOrigin.status).toBe(403)
  expect((await gen(good, { 'content-type': 'text/plain' })).status).toBe(415)
})

test('an <img>/form from another site (no Origin, Sec-Fetch-Site cross-site) is refused, even for status', async () => {
  expect((await send({ headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  expect((await send({ headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403)
  expect((await gen(good, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await send({ headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200)
})

test('status checks are shared while in flight and reused for 3 s', async () => {
  let calls = 0
  const s3 = createBridgeServer({
    token: TOKEN, allowedOrigins: allowedOrigins(5173),
    status: async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { claude: { installed: false }, codex: { installed: false } } },
  })
  await new Promise<void>((r) => s3.listen(0, '127.0.0.1', r))
  const p3 = (s3.address() as AddressInfo).port
  const get = () => new Promise<number>((done) => {
    request({ host: '127.0.0.1', port: p3, path: '/bridge/status', headers: { host: `127.0.0.1:${p3}` } }, (res) => { res.resume(); res.on('end', () => done(res.statusCode!)) }).end()
  })
  try {
    expect(await Promise.all([get(), get(), get()])).toEqual([200, 200, 200])
    expect(await get()).toBe(200)
    expect(calls).toBe(1)
  } finally {
    await new Promise<void>((r) => s3.close(() => r()))
  }
})

test('status: GET without Origin returns JSON with no account details', async () => {
  const r = await send({})
  expect(r.status).toBe(200)
  expect(r.headers['content-type']).toMatch(/^application\/json/)
  const s = JSON.parse(r.body) as { claude: { installed: boolean; plan?: string } }
  expect(s.claude).toEqual({ installed: true, version: '9.9.9', signedIn: true, plan: 'max' })
  expect(r.body).not.toContain('@')
  expect(r.body.toLowerCase()).not.toContain('org')
})

test('server sets no Access-Control-* headers on any response', async () => {
  const pre = await send({ method: 'OPTIONS', path: '/bridge/generate', headers: {
    origin: 'https://evil.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-whyboard-token,content-type',
  } })
  expect(pre.status).toBeGreaterThanOrEqual(400)
  const preOk = await send({ method: 'OPTIONS', path: '/bridge/generate', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } })
  expect(preOk.status).toBeGreaterThanOrEqual(400)
  expect(seen.length).toBeGreaterThan(10)
  for (const r of seen) {
    for (const h of Object.keys(r.headers)) expect(h.toLowerCase().startsWith('access-control-'), `${r.status} ${h}`).toBe(false)
  }
})

test('closing the connection kills the child process', async () => {
  const { runCli } = await import('../../bridge/spawn')
  let spawned: { pid: number; cwd: string } | undefined
  const s2 = createBridgeServer({
    token: TOKEN, allowedOrigins: allowedOrigins(5173),
    run: (cli, req, signal) => runCli(cli, req, signal, { env: { FAKE_MODE: 'slow' }, onSpawn: (i) => { spawned = i } }),
  })
  await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r))
  const p2 = (s2.address() as AddressInfo).port
  try {
    await new Promise<void>((done, fail) => {
      const req = request({
        host: '127.0.0.1', port: p2, method: 'POST', path: '/bridge/generate',
        headers: { host: `127.0.0.1:${p2}`, origin: ORIGIN, 'content-type': 'application/json', 'x-whyboard-token': TOKEN },
      }, (res) => {
        res.on('data', () => { req.destroy(); done() }) // first event arrived: hang up
      })
      req.on('error', () => {})
      setTimeout(() => fail(new Error('no data')), 10_000)
      req.end(JSON.stringify(good))
    })
    const alive = () => { try { process.kill(spawned!.pid, 0); return true } catch { return false } }
    for (let i = 0; i < 50 && alive(); i++) await new Promise((r) => setTimeout(r, 100))
    expect(alive()).toBe(false)
  } finally {
    await new Promise<void>((r) => s2.close(() => r()))
  }
})
