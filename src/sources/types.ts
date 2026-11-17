import { SourceError } from './errors'
import type { ErrorKind } from './errors'
import type { Recording } from './recording'

export type Role =
  | 'plan' | 'segment' | 'reteach' | 'solution' | 'lost' | 'answer' | 'recap' | 'review' | 'repair'

export type BilledTo = 'api-key' | 'subscription' | 'recording'

export type Badge = {
  mode: 'recorded' | 'live'
  text: string
  model: string
  billedTo: BilledTo
  capturedAt?: string
}

export type Usage = { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
export type PlanLimits = { usedPercent?: number; resetsAt?: string; window?: string }

export type Readiness = { ready: true } | { ready: false; reason: string; action?: string }

export interface GenRequest {
  role: Role
  intent: string // stable key, e.g. "segment:2", "reteach:c1:d", "answer:q-why-halfway"
  system: string // stable across calls, so it can be cached
  user: string // the per-call context
  maxOutputTokens: number
}

export type GenEvent =
  | { type: 'text'; text: string }
  | { type: 'meta'; model: string; billedTo: BilledTo; usage?: Usage; limits?: PlanLimits }
  | { type: 'done'; stop: 'end' | 'length' | 'aborted' }
  | { type: 'error'; kind: ErrorKind; detail?: string }

export interface AiSource {
  readonly id: 'replay' | 'anthropic' | 'openai-compatible' | 'claude-code' | 'codex'
  badge(): Badge // what the on-screen badge says; never guessed
  preflight(): Promise<Readiness>
  /** Errors are delivered by throwing SourceError from the iterator. */
  generate(req: GenRequest, signal: AbortSignal): AsyncIterable<GenEvent>
}

/** Converts in-band `error` events (e.g. from the bridge SSE) into thrown SourceErrors. */
export async function* throwOnErrorEvents(it: AsyncIterable<GenEvent>): AsyncGenerator<GenEvent> {
  for await (const e of it) {
    if (e.type === 'error') throw new SourceError(e.kind, e.detail)
    yield e
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** `d Mon yyyy` from UTC date parts and a fixed month table, so output never depends on ICU data. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Exact on-screen badge text. Live badges carry their text; recorded ones are built from model and date. */
export function badgeText(b: Badge): string {
  if (b.mode === 'recorded') {
    return `RECORDED · ${b.model} · captured ${b.capturedAt ? formatDate(b.capturedAt) : 'unknown date'}`
  }
  return b.text
}

export function recordedBadge(rec: Recording): Badge {
  const b: Badge = {
    mode: 'recorded', text: '', model: rec.meta.model, billedTo: 'recording', capturedAt: rec.meta.capturedAt,
  }
  return { ...b, text: badgeText(b) }
}

export type ProviderLabel = 'Anthropic API' | 'OpenAI API' | 'Gemini API' | 'OpenRouter' | 'Groq'

export function liveApiBadge(providerLabel: ProviderLabel, model: string): Badge {
  return { mode: 'live', text: `LIVE · ${providerLabel} · ${model}`, model, billedTo: 'api-key' }
}

export function liveCliBadge(cli: 'claude' | 'codex'): Badge {
  const name = cli === 'claude' ? 'Claude Code' : 'Codex'
  return { mode: 'live', text: `LIVE · ${name} on this computer`, model: cli, billedTo: 'subscription' }
}

/** One CLI as the local bridge reports it (no account details: email and organisation never leave the bridge). */
export type CliStatus = { installed: boolean; version?: string; signedIn?: boolean; plan?: string }
export type BridgeStatus = { claude: CliStatus; codex: CliStatus }
