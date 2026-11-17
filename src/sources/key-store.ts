/**
 * API keys. Memory by default; with `keepInTab`, also `sessionStorage['whyboard.key.<provider>']`
 * (gone when the tab closes). Never localStorage, IndexedDB or logs.
 */
import type { ProviderId } from '../storage/settings'

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'groq']
const prefix = 'whyboard.key.'
const memory = new Map<ProviderId, string>()

const session = (): Storage | undefined => {
  try { return globalThis.sessionStorage } catch { return undefined }
}

/** Reads keys the learner chose to keep for this tab into memory (call on app load). */
function rehydrate(): void {
  const s = session()
  if (!s) return
  for (const p of PROVIDER_IDS) {
    try {
      const v = s.getItem(prefix + p)
      if (v) memory.set(p, v)
    } catch { /* storage blocked */ }
  }
}

export const keyStore = {
  get(provider: ProviderId): string | undefined {
    return memory.get(provider)
  },
  /** True when this key is also held in sessionStorage. */
  kept(provider: ProviderId): boolean {
    try { return !!session()?.getItem(prefix + provider) } catch { return false }
  },
  set(provider: ProviderId, key: string, keepInTab: boolean): void {
    const k = key.trim()
    if (!k) { keyStore.forget(provider); return }
    memory.set(provider, k)
    try {
      if (keepInTab) session()?.setItem(prefix + provider, k)
      else session()?.removeItem(prefix + provider)
    } catch { /* memory only */ }
  },
  forget(provider: ProviderId): void {
    memory.delete(provider)
    try { session()?.removeItem(prefix + provider) } catch { /* ignore */ }
  },
  forgetAll(): void {
    for (const p of PROVIDER_IDS) keyStore.forget(p)
    memory.clear()
  },
  rehydrate,
}

rehydrate()
