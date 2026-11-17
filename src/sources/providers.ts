import type { ProviderId } from '../storage/settings'

export type ProviderInfo = {
  label: string
  kind: 'anthropic' | 'openai-compatible'
  base: string
  defaultModel: string
  keyUrl: string
  freeNote?: string
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    label: 'Anthropic', kind: 'anthropic', base: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI', kind: 'openai-compatible', base: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.1-terra', keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Google Gemini', kind: 'openai-compatible', base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/apikey',
    freeNote: 'Free tier, no card needed. Free-tier prompts may be used by Google to improve its products.',
  },
  openrouter: {
    label: 'OpenRouter', kind: 'openai-compatible', base: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-5.5', keyUrl: 'https://openrouter.ai/keys',
  },
  groq: {
    label: 'Groq', kind: 'openai-compatible', base: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b', keyUrl: 'https://console.groq.com/keys',
  },
}
