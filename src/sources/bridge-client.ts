/**
 * The Claude Code / Codex source: talks to the local bridge (bridge/server.ts) on this computer, which
 * runs the user's own signed-in CLI. Loaded only through `if (__LOCAL__)` dynamic imports, so the public
 * build contains none of this. The per-start token comes from a meta tag that only the local dev server
 * injects.
 */
import { SourceError } from './errors'
import { readSSE } from './sse'
import { liveCliBadge, throwOnErrorEvents } from './types'
import type { AiSource, BridgeStatus, CliStatus, GenEvent, GenRequest, Readiness } from './types'

export type BridgeCli = 'claude' | 'codex'

export const CLAUDE_DEFAULT_MODEL = 'sonnet'
const TOKEN_META = 'whyboard-bridge-token'
const NAMES: Record<BridgeCli, string> = { claude: 'Claude Code', codex: 'Codex' }

export const NEXT_STEP = {
  claude: {
    missing: 'Install Claude Code, then run "claude" once to sign in.',
    signedOut: 'Run "claude" in a terminal and sign in.',
  },
  codex: {
    missing: 'Install Codex, then run "codex" once to sign in.',
    signedOut: 'Run "codex" in a terminal and sign in.',
  },
} as const

export const BRIDGE_DOWN = 'Can\'t reach the local bridge. Start Whyboard with "npm run dev" on this computer.'

export function readBridgeToken(doc: Document | undefined = globalThis.document): string | undefined {
  const v = doc?.querySelector(`meta[name="${TOKEN_META}"]`)?.getAttribute('content')?.trim()
  return v || undefined
}

export async function getBridgeStatus(signal?: AbortSignal): Promise<BridgeStatus> {
  const res = await fetch('/bridge/status', { method: 'GET', cache: 'no-store', ...(signal ? { signal } : {}) })
  if (!res.ok) throw new SourceError('unknown', `bridge status HTTP ${res.status}`)
  const j = (await res.json()) as Partial<BridgeStatus>
  const cli = (s: unknown): CliStatus => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    return {
      installed: o.installed === true,
      ...(typeof o.version === 'string' ? { version: o.version } : {}),
      ...(typeof o.signedIn === 'boolean' ? { signedIn: o.signedIn } : {}),
      ...(typeof o.plan === 'string' ? { plan: o.plan } : {}),
    }
  }
  return { claude: cli(j.claude), codex: cli(j.codex) }
}

export function readinessFor(cli: BridgeCli, s: CliStatus): Readiness {
  if (!s.installed) return { ready: false, reason: 'cli-missing', action: NEXT_STEP[cli].missing }
  if (!s.signedIn) return { ready: false, reason: 'cli-signed-out', action: NEXT_STEP[cli].signedOut }
  return { ready: true }
}

/** The one-line status Settings shows under each subscription option. */
export function statusLine(cli: BridgeCli, s: CliStatus): { ok: boolean; text: string } {
  if (!s.installed) return { ok: false, text: `Not installed. ${NEXT_STEP[cli].missing}` }
  if (!s.signedIn) return { ok: false, text: `Signed out. ${NEXT_STEP[cli].signedOut}` }
  const parts = ['Ready', ...(s.plan ? [`${s.plan} plan`] : []), `${NAMES[cli]}${s.version ? ` ${s.version}` : ''}`]
  if (cli === 'codex') parts.push('not yet tested with Whyboard')
  return { ok: true, text: parts.join(' · ') }
}

const EVENT_TYPES = new Set(['text', 'meta', 'done', 'error'])

async function* events(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<GenEvent> {
  for await (const m of readSSE(body, signal)) {
    let e: unknown
    try { e = JSON.parse(m.data) } catch { continue }
    if (e && typeof e === 'object' && EVENT_TYPES.has((e as { type?: string }).type ?? '')) yield e as GenEvent
  }
}

export function createBridgeSource(opts: { cli: BridgeCli; model?: string }): AiSource {
  const { cli } = opts
  const model = opts.model ?? (cli === 'claude' ? CLAUDE_DEFAULT_MODEL : undefined)
  return {
    id: cli === 'claude' ? 'claude-code' : 'codex',
    badge: () => liveCliBadge(cli),
    async preflight(): Promise<Readiness> {
      let s: BridgeStatus
      try {
        s = await getBridgeStatus(AbortSignal.timeout(20_000))
      } catch {
        return { ready: false, reason: 'offline', action: BRIDGE_DOWN }
      }
      return readinessFor(cli, s[cli])
    },
    async *generate(req: GenRequest, signal: AbortSignal): AsyncGenerator<GenEvent> {
      const token = readBridgeToken()
      if (!token) throw new SourceError('unknown', 'This page has no bridge token. Start Whyboard with "npm run dev" and reload.')
      let res: Response
      try {
        res = await fetch('/bridge/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-whyboard-token': token },
          body: JSON.stringify({ cli, ...(model ? { model } : {}), system: req.system, user: req.user, role: req.role }),
          signal,
        })
      } catch (e) {
        if (signal.aborted || (e as { name?: string })?.name === 'AbortError') { yield { type: 'done', stop: 'aborted' }; return }
        throw new SourceError('offline', BRIDGE_DOWN)
      }
      if (!res.ok) {
        const why = res.status === 401
          ? 'The local bridge did not accept this page. Reload it (the bridge was probably restarted).'
          : `The local bridge refused the request (HTTP ${res.status}).`
        throw new SourceError('unknown', why)
      }
      if (!res.body) throw new SourceError('unknown', 'The local bridge sent an empty response.')
      try {
        for await (const e of throwOnErrorEvents(events(res.body, signal))) {
          yield e
          if (e.type === 'done') return
        }
      } catch (e) {
        if (signal.aborted) { yield { type: 'done', stop: 'aborted' }; return }
        if (e instanceof SourceError) throw e
        throw new SourceError('offline', BRIDGE_DOWN)
      }
      // The stream closed without a final event: whatever arrived is a truncated answer.
      yield { type: 'done', stop: signal.aborted ? 'aborted' : 'length' }
    },
  }
}
