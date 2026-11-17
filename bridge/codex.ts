/**
 * Codex as a plain model (blueprint §7.3). UNTESTED against a real CLI: Codex is not installed on the
 * machine this was built on, so the command is built from the documentation and exercised only against
 * tests/fixtures/fake-codex.mjs. `codex exec --json` does not stream text: the answer arrives as one
 * completed `agent_message` item.
 */
import type { ErrorKind } from '../src/sources/errors'
import { scrub } from '../src/sources/http'
import type { GenEvent, Usage } from '../src/sources/types'

/**
 * `-c` values are parsed as TOML by Codex, so string values carry their quotes in the argument itself
 * (there is no shell to strip them). The system prompt is JSON-encoded, which is also a valid TOML basic
 * string.
 */
export function codexArgs(o: { system: string; cwd: string; model?: string }): string[] {
  return [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', o.cwd, ...(o.model ? ['-m', o.model] : []),
    '-c', 'model_reasoning_effort="low"',
    '-c', 'features.shell_tool=false', '-c', 'web_search="disabled"',
    '-c', 'project_doc_max_bytes=0',
    '-c', `developer_instructions=${JSON.stringify(o.system)}`,
    '-',
  ]
}

export type CodexState = { model?: string }

const SIGNED_OUT = /log ?in|not logged|authenticat|unauthori[sz]ed|401/i
const LIMIT = /usage limit|hit your limit|rate limit|quota/i

export function codexErrorKind(text: string): ErrorKind {
  if (LIMIT.test(text)) return 'usage-limit'
  if (SIGNED_OUT.test(text)) return 'cli-signed-out'
  return 'unknown'
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function usageOf(u: unknown): Usage {
  const out: Usage = {}
  if (!isObj(u)) return out
  const i = num(u.input_tokens)
  const c = num(u.cached_input_tokens)
  const o = num(u.output_tokens)
  if (i !== undefined) out.inputTokens = i
  if (c !== undefined) out.cachedInputTokens = c
  if (o !== undefined) out.outputTokens = o
  return out
}

const errorEvent = (message: string): GenEvent => ({ type: 'error', kind: codexErrorKind(message), detail: scrub(message) })

/** One parsed `codex exec --json` line → GenEvents. */
export function parseCodexLine(o: unknown, st: CodexState = {}): GenEvent[] {
  if (!isObj(o)) return []
  switch (o.type) {
    case 'item.completed': {
      const item = isObj(o.item) ? o.item : {}
      return item.type === 'agent_message' && typeof item.text === 'string' ? [{ type: 'text', text: item.text }] : []
    }
    case 'turn.completed':
      return [
        { type: 'meta', model: st.model ?? 'codex', billedTo: 'subscription', usage: usageOf(o.usage) },
        { type: 'done', stop: 'end' },
      ]
    case 'turn.failed': {
      const err = isObj(o.error) ? o.error : {}
      return [errorEvent(typeof err.message === 'string' ? err.message : 'turn failed')]
    }
    case 'error':
      return [errorEvent(typeof o.message === 'string' ? o.message : 'error')]
    default:
      return []
  }
}
