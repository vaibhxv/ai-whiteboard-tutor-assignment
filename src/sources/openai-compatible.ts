import type { ProviderId } from '../storage/settings'
import { SourceError } from './errors'
import { request, preflightGet, scrub } from './http'
import type { ErrorKind } from './errors'
import { PROVIDERS } from './providers'
import { readSSE } from './sse'
import { liveApiBadge } from './types'
import type { AiSource, GenEvent, GenRequest, ProviderLabel } from './types'

const BADGE: Record<ProviderId, ProviderLabel> = {
  anthropic: 'Anthropic API', openai: 'OpenAI API', gemini: 'Gemini API', openrouter: 'OpenRouter', groq: 'Groq',
}

/** Maps an in-stream `error` object (code / status / type) to an error kind. */
export function kindForStreamError(err: { code?: unknown; status?: unknown; type?: unknown }): ErrorKind {
  const tags = [err.code, err.status, err.type].map((x) => String(x ?? '').toLowerCase())
  const has = (...w: string[]) => tags.some((t) => w.some((x) => t === x || (x.length > 3 && t.includes(x))))
  if (has('429', 'rate_limit', 'rate_limit_error', 'rate_limit_exceeded', 'resource_exhausted')) return 'rate-limit'
  if (has('503', '529', 'overloaded', 'server_error', 'unavailable')) return 'busy'
  if (has('401', '403', 'invalid_api_key', 'authentication', 'unauthorized', 'permission')) return 'invalid-key'
  return 'unknown'
}

export function createOpenAICompatibleSource(opts: { provider: Exclude<ProviderId, 'anthropic'>; key: string; model: string }): AiSource {
  const base = PROVIDERS[opts.provider].base
  const headers = (): Record<string, string> => ({ authorization: `Bearer ${opts.key}`, 'content-type': 'application/json' })
  return {
    id: 'openai-compatible',
    badge: () => liveApiBadge(BADGE[opts.provider], opts.model),
    preflight: () => preflightGet(`${base}/models`, { authorization: `Bearer ${opts.key}` }, opts.key),
    async *generate(req: GenRequest, signal: AbortSignal): AsyncGenerator<GenEvent> {
      const cap = req.maxOutputTokens * 4 // reasoning counts toward the cap
      const body = {
        model: opts.model,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        stream: true,
        ...(opts.provider === 'openai' ? { max_completion_tokens: cap } : { max_tokens: cap }),
      }
      let res: Response
      try {
        res = await request(`${base}/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, signal, opts.key)
      } catch (e) {
        if (e instanceof SourceError && e.kind === 'aborted') { yield { type: 'done', stop: 'aborted' }; return }
        throw e
      }
      if (!res.body) throw new SourceError('unknown', 'empty response body')
      let stop: 'end' | 'length' = 'length' // until a finish_reason or [DONE]: a clean close without one is truncation
      let sawLength = false
      let sentMeta = false
      try {
        for await (const m of readSSE(res.body, signal)) {
          if (m.data.trim() === '[DONE]') { if (!sawLength) stop = 'end'; break }
          let j: any
          try { j = JSON.parse(m.data) } catch { continue }
          if (j?.error) throw new SourceError(kindForStreamError(j.error), scrub(String(j.error.message ?? ''), opts.key))
          if (!sentMeta) {
            sentMeta = true
            yield { type: 'meta', model: typeof j.model === 'string' ? j.model : opts.model, billedTo: 'api-key' }
          }
          const choice = j?.choices?.[0]
          const text = choice?.delta?.content // reasoning / reasoning_content are ignored
          if (typeof text === 'string' && text) yield { type: 'text', text }
          if (choice?.finish_reason === 'length') { sawLength = true; stop = 'length' }
          else if (choice?.finish_reason) stop = 'end'
          if (j?.usage) {
            yield {
              type: 'meta', model: opts.model, billedTo: 'api-key',
              usage: { inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens },
            }
          }
        }
      } catch (e) {
        if (signal.aborted) { yield { type: 'done', stop: 'aborted' }; return }
        if (e instanceof SourceError) throw e
        throw new SourceError(e instanceof TypeError ? 'offline' : 'unknown', scrub(String(e), opts.key))
      }
      yield { type: 'done', stop: signal.aborted ? 'aborted' : stop }
    },
  }
}
