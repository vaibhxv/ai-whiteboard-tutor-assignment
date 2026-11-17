/**
 * Builds the AI source the settings choose: a recording, an API key straight to a provider, or (only when
 * Whyboard runs on the user's own computer) the user's Claude Code / Codex CLI through the local bridge.
 */
import type { ProviderId, Settings } from '../storage/settings'
import type { Recording } from './recording'
import { createAnthropicSource } from './anthropic'
import { createOpenAICompatibleSource } from './openai-compatible'
import { PROVIDERS } from './providers'
import { createReplaySource } from './replay'
import type { ReplayOpts } from './replay'
import { liveApiBadge, liveCliBadge } from './types'
import type { AiSource, Badge, GenEvent, GenRequest, ProviderLabel } from './types'

/** The part of Task 18's key store this module needs. */
export interface KeyLookup {
  get(provider: ProviderId): string | undefined
}

export const noKeys: KeyLookup = { get: () => undefined }

export type ActiveSourceOpts = { recording?: Recording; replay?: ReplayOpts }

/** The source for a new lesson, or null when the chosen source is not available (yet). */
export function createActiveSource(settings: Settings, keyStore: KeyLookup, opts: ActiveSourceOpts = {}): AiSource | null {
  switch (settings.sourceId) {
    case 'replay':
      return opts.recording ? createReplaySource(opts.recording, opts.replay) : null
    case 'anthropic': {
      const key = keyStore.get('anthropic')
      return key ? createAnthropicSource({ key, model: settings.model ?? PROVIDERS.anthropic.defaultModel }) : null
    }
    case 'openai-compatible': {
      const provider = compatProvider(settings)
      const key = keyStore.get(provider)
      return key ? createOpenAICompatibleSource({ provider, key, model: settings.model ?? DEFAULT_MODELS[provider] }) : null
    }
    case 'claude-code':
    case 'codex':
      // Compile-time false in the public build, so the bridge client is not even bundled there.
      if (__LOCAL__) return lazyBridgeSource(settings.sourceId === 'codex' ? 'codex' : 'claude', settings.model)
      return null
  }
}

/** A bridge source whose code loads on first use (keeps `createActiveSource` synchronous). */
function lazyBridgeSource(cli: 'claude' | 'codex', model: string | undefined): AiSource {
  const load = () => import('./bridge-client').then((m) => m.createBridgeSource({ cli, ...(model ? { model } : {}) }))
  return {
    id: cli === 'claude' ? 'claude-code' : 'codex',
    badge: () => liveCliBadge(cli),
    preflight: async () => (await load()).preflight(),
    async *generate(req: GenRequest, signal: AbortSignal): AsyncGenerator<GenEvent> {
      yield* (await load()).generate(req, signal)
    },
  }
}

/** The OpenAI-compatible provider a setting names (Gemini when none is chosen). */
export function compatProvider(s: Settings): Exclude<ProviderId, 'anthropic'> {
  return s.provider && s.provider !== 'anthropic' ? s.provider : 'gemini'
}

export const LABELS: Record<ProviderId, ProviderLabel> = {
  anthropic: 'Anthropic API', openai: 'OpenAI API', gemini: 'Gemini API', openrouter: 'OpenRouter', groq: 'Groq',
}
export const DEFAULT_MODELS: Record<ProviderId, string> = {
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
      const p = compatProvider(s)
      return liveApiBadge(LABELS[p], s.model ?? DEFAULT_MODELS[p])
    }
    case 'claude-code':
      return liveCliBadge('claude')
    case 'codex':
      return liveCliBadge('codex')
  }
}
