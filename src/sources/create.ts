/**
 * Builds the AI source the settings choose. This task wires only `replay`; Tasks 18 and 19 add the
 * API-key and subscription sources (until then they return null and the UI says they are not set up).
 */
import type { ProviderId, Settings } from '../storage/settings'
import type { Recording } from './recording'
import { createReplaySource } from './replay'
import type { ReplayOpts } from './replay'
import { liveApiBadge, liveCliBadge } from './types'
import type { AiSource, Badge, ProviderLabel } from './types'

/** The part of Task 18's key store this module needs. */
export interface KeyLookup {
  get(provider: ProviderId): string | undefined
}

export const noKeys: KeyLookup = { get: () => undefined }

export type ActiveSourceOpts = { recording?: Recording; replay?: ReplayOpts }

/** The source for a new lesson, or null when the chosen source is not available (yet). */
export function createActiveSource(settings: Settings, _keyStore: KeyLookup, opts: ActiveSourceOpts = {}): AiSource | null {
  switch (settings.sourceId) {
    case 'replay':
      return opts.recording ? createReplaySource(opts.recording, opts.replay) : null
    default:
      return null // Task 18 (API keys) and Task 19 (subscriptions)
  }
}

const LABELS: Record<ProviderId, ProviderLabel> = {
  anthropic: 'Anthropic API', openai: 'OpenAI API', gemini: 'Gemini API', openrouter: 'OpenRouter', groq: 'Groq',
}
const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5-5', openai: 'gpt-6.1-terra', gemini: 'gemini-3.8-flash',
  openrouter: 'anthropic/claude-sonnet-5.5', groq: 'openai/gpt-oss-120b',
}

/** What the header badge says before a lesson starts: the source the next lesson would use. */
export function settingsBadge(s: Settings): Badge {
  switch (s.sourceId) {
    case 'replay':
      return { mode: 'recorded', text: 'RECORDED · lessons captured in advance', model: '', billedTo: 'recording' }
    case 'anthropic':
      return liveApiBadge('Anthropic API', s.model ?? DEFAULT_MODELS.anthropic)
    case 'openai-compatible': {
      const p = s.provider && s.provider !== 'anthropic' ? s.provider : 'gemini'
      return liveApiBadge(LABELS[p], s.model ?? DEFAULT_MODELS[p])
    }
    case 'claude-code':
      return liveCliBadge('claude')
    case 'codex':
      return liveCliBadge('codex')
  }
}
