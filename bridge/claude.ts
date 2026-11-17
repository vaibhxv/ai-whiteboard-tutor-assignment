/**
 * Claude Code as a plain streaming model (blueprint §7.3, measured on 2.1.325 with a Max plan): every
 * tool, MCP server, setting, slash command and hook is off, nothing is persisted, the system prompt is an
 * argument and the prompt goes on stdin. Never `--bare`: bare mode does not read subscription logins.
 */
import type { ErrorKind } from '../src/sources/errors'
import { scrub } from '../src/sources/http'
import type { BilledTo, GenEvent, PlanLimits, Usage } from '../src/sources/types'

export const CLAUDE_DEFAULT_MODEL = 'sonnet'

export function claudeArgs(o: { model: string; system: string }): string[] {
  return [
    '-p', '--model', o.model, '--tools', '', '--system-prompt', o.system,
    '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--disallowedTools', 'mcp__*',
    '--disable-slash-commands', '--no-session-persistence', '--permission-prompts', 'none',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  ]
}

/** What one run has learned so far (the init line names the model and who is billed). */
export type ClaudeState = { model?: string; billedTo?: BilledTo; length?: boolean }

const SIGNED_OUT = /log ?in|not logged|authenticat/i
const LIMIT = /usage limit|hit your limit|rate limit|limit reached/i

/** Error kind for a failure message (stderr of a non-zero exit, or an error result). */
export function claudeErrorKind(text: string): ErrorKind {
  if (SIGNED_OUT.test(text)) return 'cli-signed-out'
  if (LIMIT.test(text)) return 'usage-limit'
  return 'unknown'
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function limitsOf(info: Obj): PlanLimits {
  const window = typeof info.rateLimitType === 'string' ? info.rateLimitType : undefined
  const windows = isObj(info.unifiedWindows) ? info.unifiedWindows : {}
  const w = window && isObj(windows[window]) ? (windows[window] as Obj) : {}
  const utilization = num(info.utilization) ?? num(w.utilization)
  const resets = num(info.resetsAt) ?? num(w.resetsAt)
  return {
    ...(utilization !== undefined ? { usedPercent: Math.round(utilization * 100) } : {}),
    ...(resets !== undefined ? { resetsAt: new Date(resets * 1000).toISOString() } : {}),
    ...(window ? { window } : {}),
  }
}

function usageOf(u: unknown): Usage | undefined {
  if (!isObj(u)) return undefined
  const out: Usage = {}
  const i = num(u.input_tokens)
  const o = num(u.output_tokens)
  const c = num(u.cache_read_input_tokens)
  if (i !== undefined) out.inputTokens = i
  if (o !== undefined) out.outputTokens = o
  if (c !== undefined) out.cachedInputTokens = c
  return out
}

/** One parsed stream-json line → GenEvents. Unknown lines yield nothing. */
export function parseClaudeLine(o: unknown, st: ClaudeState = {}): GenEvent[] {
  if (!isObj(o)) return []
  const meta = (extra: { usage?: Usage; limits?: PlanLimits } = {}): GenEvent => ({
    type: 'meta', model: st.model ?? 'claude', billedTo: st.billedTo ?? 'subscription', ...extra,
  })
  switch (o.type) {
    case 'system': {
      if (o.subtype !== 'init') return []
      if (typeof o.model === 'string') st.model = o.model
      st.billedTo = o.apiKeySource === 'none' ? 'subscription' : 'api-key'
      return [meta()]
    }
    case 'stream_event': {
      const e = isObj(o.event) ? o.event : {}
      const d = isObj(e.delta) ? e.delta : {}
      if (d.type === 'text_delta' && typeof d.text === 'string') return [{ type: 'text', text: d.text }]
      if (e.type === 'message_delta' && d.stop_reason === 'max_tokens') st.length = true
      return []
    }
    case 'rate_limit_event': {
      const info = isObj(o.rate_limit_info) ? o.rate_limit_info : {}
      if (info.status === 'rejected' || info.status === 'exceeded') {
        return [{ type: 'error', kind: 'usage-limit', detail: 'Your plan has reached its usage limit for now.' }]
      }
      return [meta({ limits: limitsOf(info) })]
    }
    case 'result': {
      if (o.is_error === true) {
        const text = typeof o.result === 'string' ? o.result : typeof o.subtype === 'string' ? o.subtype : 'error'
        return [{ type: 'error', kind: claudeErrorKind(text), detail: scrub(text) }]
      }
      const usage = usageOf(o.usage)
      const length = st.length || o.stop_reason === 'max_tokens'
      return [...(usage ? [meta({ usage })] : []), { type: 'done', stop: length ? 'length' : 'end' }]
    }
    default:
      return []
  }
}
