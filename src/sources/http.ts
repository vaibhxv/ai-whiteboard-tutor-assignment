import { SourceError } from './errors'
import type { ErrorKind } from './errors'

export function kindForStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'invalid-key'
  if (status === 429) return 'rate-limit'
  if (status === 529 || status === 503 || status === 502) return 'busy'
  return 'unknown'
}

/** fetch that maps failures to SourceError (abort → aborted, TypeError → offline, !ok → by status). */
export async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
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
    try { detail = (await res.text()).slice(0, 500) } catch { /* ignore */ }
    throw new SourceError(kindForStatus(res.status), `HTTP ${res.status} ${detail}`.trim())
  }
  return res
}

export async function preflightGet(url: string, headers: Record<string, string>): Promise<{ ready: true } | { ready: false; reason: string; action?: string }> {
  try {
    await request(url, { method: 'GET', headers })
    return { ready: true }
  } catch (e) {
    const kind = e instanceof SourceError ? e.kind : 'unknown'
    return { ready: false, reason: kind, action: kind }
  }
}
