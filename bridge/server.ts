/**
 * The local bridge (blueprint D12, §5.3, §8): a loopback-only HTTP server that runs the user's own
 * signed-in `claude` or `codex` CLI and streams GenEvents back as server-sent events.
 *
 *   GET  /bridge/status    installed / version / signed in / plan for each CLI (no account details)
 *   POST /bridge/generate  {cli, model?, system, user, role} → text/event-stream of `data: <GenEvent>`
 *
 * Another website must not be able to drive it: wrong Host → 421 (DNS rebinding), a foreign Origin → 403,
 * a missing or wrong `x-whyboard-token` → 401, and no Access-Control-* header is ever sent, so a
 * cross-origin page can neither pass the preflight nor read a response. Started by `scripts/dev.ts`.
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import type { BridgeStatus, GenEvent } from '../src/sources/types'
import { assertLocalOnly, checkFetchSite, checkHost, checkOrigin, checkToken } from './guards'
import { MODEL_ALLOW, runCli } from './spawn'
import type { Cli, CliRequest } from './spawn'
import { getStatus } from './status'

export const BIND_HOST = '127.0.0.1'
export const MAX_BODY = 64 * 1024

export function allowedOrigins(vitePort: number): string[] {
  return [`http://localhost:${vitePort}`, `http://127.0.0.1:${vitePort}`]
}

export type BridgeOpts = {
  token: string
  allowedOrigins: string[]
  run?: (cli: Cli, req: CliRequest, signal: AbortSignal) => AsyncIterable<GenEvent>
  status?: typeof getStatus
}

const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

function send(res: ServerResponse, status: number, body: unknown = { error: status }): void {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

class BodyError extends Error { constructor(readonly status: number) { super(String(status)) } }

function readBody(req: IncomingMessage): Promise<string> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > MAX_BODY) return Promise.reject(new BodyError(413))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { reject(new BodyError(413)); req.resume(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

type GenBody = { cli: Cli; model?: string; system: string; user: string; role?: string }

function parseGenBody(text: string): GenBody | null {
  let j: unknown
  try { j = JSON.parse(text) } catch { return null }
  if (typeof j !== 'object' || j === null) return null
  const b = j as Record<string, unknown>
  if (b.cli !== 'claude' && b.cli !== 'codex') return null
  if (typeof b.system !== 'string' || typeof b.user !== 'string') return null
  if (b.model !== undefined && (typeof b.model !== 'string' || !MODEL_ALLOW[b.cli].includes(b.model))) return null
  if (b.role !== undefined && (typeof b.role !== 'string' || !/^[a-z]{1,16}$/.test(b.role))) return null
  return {
    cli: b.cli, system: b.system, user: b.user,
    ...(b.model !== undefined ? { model: b.model as string } : {}), ...(b.role !== undefined ? { role: b.role as string } : {}),
  }
}

export function createBridgeServer(o: BridgeOpts): Server & { abortAll(): void } {
  const run = o.run ?? ((cli, req, signal) => runCli(cli, req, signal))
  const status = o.status ?? getStatus
  const live = new Set<AbortController>()
  // Each status check runs four short CLI commands: share one in-flight check and reuse it for 3 s.
  let statusCache: { at: number; p: Promise<BridgeStatus> } | undefined
  const cachedStatus = () => {
    const now = Date.now()
    if (!statusCache || now - statusCache.at > 3000) {
      const p = status()
      statusCache = { at: now, p }
      p.catch(() => { if (statusCache?.p === p) statusCache = undefined })
    }
    return statusCache.p
  }

  const generate = async (req: IncomingMessage, res: ServerResponse) => {
    let text: string
    try { text = await readBody(req) } catch (e) { send(res, e instanceof BodyError ? e.status : 400); return }
    const body = parseGenBody(text)
    if (!body) { send(res, 400, { error: 'bad request' }); return }
    const ac = new AbortController()
    live.add(ac)
    res.on('close', () => { if (!res.writableFinished) ac.abort() })
    res.writeHead(200, { ...BASE_HEADERS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    res.flushHeaders()
    const write = (e: GenEvent) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(e)}\n\n`) }
    try {
      for await (const e of run(body.cli, { system: body.system, user: body.user, ...(body.model ? { model: body.model } : {}) }, ac.signal)) {
        if (ac.signal.aborted) break
        write(e)
      }
    } catch {
      write({ type: 'error', kind: 'unknown', detail: 'The bridge failed while running the command.' })
    } finally {
      live.delete(ac)
      res.end()
    }
  }

  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo | null)?.port ?? -1
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (!checkHost(req.headers.host, port)) { send(res, 421, { error: 'misdirected request' }); return }
    if (path !== '/bridge/status' && path !== '/bridge/generate') { send(res, 404); return }
    const site = req.headers['sec-fetch-site']
    if (!checkOrigin(req.headers.origin, o.allowedOrigins, { method: req.method, path }) || !checkFetchSite(typeof site === 'string' ? site : undefined)) {
      send(res, 403, { error: 'forbidden origin' })
      return
    }
    if (path === '/bridge/status') {
      if (req.method !== 'GET') { send(res, 405); return }
      cachedStatus().then((s) => send(res, 200, s), () => send(res, 500))
      return
    }
    if (req.method !== 'POST') { send(res, 405); return }
    if (!checkToken(req.headers['x-whyboard-token'], o.token)) { send(res, 401, { error: 'bad token' }); return }
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) { send(res, 415); return }
    void generate(req, res)
  })
  return Object.assign(server, { abortAll: () => { for (const ac of live) ac.abort() } })
}

function main(): void {
  assertLocalOnly(process.env, BIND_HOST)
  const token = process.env.BRIDGE_TOKEN ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) {
    console.error('BRIDGE_TOKEN is missing. Start Whyboard with "npm run dev", which creates one.')
    process.exit(1)
  }
  const port = Number(process.env.BRIDGE_PORT ?? 8787)
  const vitePort = Number(process.env.VITE_PORT ?? 5173)
  const server = createBridgeServer({ token, allowedOrigins: allowedOrigins(vitePort) })
  server.listen(port, BIND_HOST, () => {
    console.log(`Whyboard bridge on http://${BIND_HOST}:${port} (this computer only)`)
  })
  const shutdown = () => {
    server.abortAll() // children are killed by their runs' abort handling
    server.close()
    server.closeIdleConnections()
    setTimeout(() => process.exit(0), 2500).unref()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
