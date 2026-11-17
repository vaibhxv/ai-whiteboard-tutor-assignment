import type { ProviderId } from '../storage/settings'
import { SourceError } from './errors'
import { request, preflightGet } from './http'
import { PROVIDERS } from './providers'
import { readSSE } from './sse'
import { liveApiBadge } from './types'
import type { AiSource, GenEvent, GenRequest, ProviderLabel } from './types'

const BADGE: Record<ProviderId, ProviderLabel> = {
  anthropic: 'Anthropic API', openai: 'OpenAI API', gemini: 'Gemini API', openrouter: 'OpenRouter', groq: 'Groq',
}

export function createOpenAICompatibleSource(opts: { provider: Exclude<ProviderId, 'anthropic'>; key: string; model: string }): AiSource {
  const base = PROVIDERS[opts.provider].base
  const headers = (): Record<string, string> => ({ authorization: `Bearer ${opts.key}`, 'content-type': 'application/json' })
  return {
    id: 'openai-compatible',
    badge: () => liveApiBadge(BADGE[opts.provider], opts.model),
    preflight: () => preflightGet(`${base}/models`, { authorization: `Bearer ${opts.key}` }),
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
        res = await request(`${base}/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, signal)
      } catch (e) {
        if (e instanceof SourceError && e.kind === 'aborted') { yield { type: 'done', stop: 'aborted' }; return }
        throw e
      }
      if (!res.body) throw new SourceError('unknown', 'empty response body')
      let stop: 'end' | 'length' = 'end'
      let sentMeta = false
      try {
        for await (const m of readSSE(res.body, signal)) {
          if (m.data.trim() === '[DONE]') break
          let j: any
          try { j = JSON.parse(m.data) } catch { continue }
          if (j?.error) throw new SourceError(j.error.code === 429 || j.error.type === 'rate_limit_error' ? 'rate-limit' : 'unknown', j.error.message)
          if (!sentMeta) {
            sentMeta = true
            yield { type: 'meta', model: typeof j.model === 'string' ? j.model : opts.model, billedTo: 'api-key' }
          }
          const choice = j?.choices?.[0]
          const text = choice?.delta?.content // reasoning / reasoning_content are ignored
          if (typeof text === 'string' && text) yield { type: 'text', text }
          if (choice?.finish_reason === 'length') stop = 'length'
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
        throw new SourceError(e instanceof TypeError ? 'offline' : 'unknown', String(e))
      }
      yield { type: 'done', stop: signal.aborted ? 'aborted' : stop }
    },
  }
}
