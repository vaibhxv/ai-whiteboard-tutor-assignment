/**
 * Learner settings, kept in `localStorage['whyboard.settings']`. Never holds a secret: API keys live in
 * the key store (memory, or `sessionStorage` when opted in). Every storage access is guarded, because
 * storage can be missing or throw (private windows, blocked site data).
 */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'groq'
export type SourceId = 'replay' | 'anthropic' | 'openai-compatible' | 'claude-code' | 'codex'

export type Settings = {
  sourceId: SourceId
  provider?: ProviderId
  model?: string
  keepKeyInTab: boolean
  captions: boolean
  speed: number
  muted: boolean
}

export const SETTINGS_KEY = 'whyboard.settings'

export const DEFAULT_SETTINGS: Settings = {
  sourceId: 'replay', keepKeyInTab: false, captions: true, speed: 1, muted: false,
}

const SOURCES: readonly SourceId[] = ['replay', 'anthropic', 'openai-compatible', 'claude-code', 'codex']
const PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'groq']
const SPEEDS = [0.75, 1, 1.25, 1.5]

/** Keeps only known fields with valid values; anything else (including any stray secret) is dropped. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Settings = { ...DEFAULT_SETTINGS }
  if (SOURCES.includes(r.sourceId as SourceId)) out.sourceId = r.sourceId as SourceId
  if (PROVIDERS.includes(r.provider as ProviderId)) out.provider = r.provider as ProviderId
  if (typeof r.model === 'string' && r.model.trim() && r.model.length <= 120) out.model = r.model.trim()
  if (typeof r.keepKeyInTab === 'boolean') out.keepKeyInTab = r.keepKeyInTab
  if (typeof r.captions === 'boolean') out.captions = r.captions
  if (typeof r.speed === 'number' && SPEEDS.includes(r.speed)) out.speed = r.speed
  if (typeof r.muted === 'boolean') out.muted = r.muted
  return out
}

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY)
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(s)))
  } catch {
    // Storage unavailable: settings last for this page only.
  }
}
