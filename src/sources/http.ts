import { SourceError } from './errors'
import type { ErrorKind } from './errors'

export function kindForStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'invalid-key'
  if (status === 429) return 'rate-limit'
  if (status === 529 || status === 503 || status === 502) return 'busy'
  return 'unknown'
}

/** Removes the key and anything token-shaped from provider text, and caps it. */
export function scrub(text: string, secret?: string): string {
  let t = text
  if (secret) t = t.split(secret).join('[key]')
  t = t.replace(/Bearer\s+\S+/gi, 'Bearer [key]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[key]').replace(/\bAIza[A-Za-z0-9_-]+/g, '[key]')
  return t.slice(0, 300)
}

/** fetch that maps failures to SourceError (abort → aborted, TypeError → offline, !ok → by status). */
export async function request(url: string, init: RequestInit, signal?: AbortSignal, secret?: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, ...(signal ? { signal } : {}) })
  } catch (e) {
    if (signal?.aborted || (e as { name?: string })?.name === 'AbortError') throw new SourceError('aborted')
    if (e instanceof TypeError) throw new SourceError('offline', e.message)
    throw new SourceError('unknown', String(e))
  }
  if (!res.ok) {
    let detail = ''
    if (res.status !== 401 && res.status !== 403) {
      try { detail = await res.text() } catch { /* ignore */ }
    }
    throw new SourceError(kindForStatus(res.status), scrub(`HTTP ${res.status} ${detail}`.trim(), secret))
  }
  return res
}

export async function preflightGet(url: string, headers: Record<string, string>, secret?: string): Promise<{ ready: true } | { ready: false; reason: string; action?: string }> {
  try {
    await request(url, { method: 'GET', headers }, undefined, secret)
    return { ready: true }
  } catch (e) {
    const kind = e instanceof SourceError ? e.kind : 'unknown'
    return { ready: false, reason: kind, action: kind }
  }
}
