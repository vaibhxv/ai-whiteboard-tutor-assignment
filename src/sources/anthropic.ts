import { SourceError } from './errors'
import { request, preflightGet } from './http'
import { PROVIDERS } from './providers'
import { readSSE } from './sse'
import { liveApiBadge } from './types'
import type { AiSource, GenEvent, GenRequest } from './types'

const BASE = PROVIDERS.anthropic.base

export function createAnthropicSource(opts: { key: string; model: string }): AiSource {
  const headers = (): Record<string, string> => ({
    'x-api-key': opts.key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  })
  return {
    id: 'anthropic',
    badge: () => liveApiBadge('Anthropic API', opts.model),
    preflight: () => preflightGet(`${BASE}/models`, headers(), opts.key),
    async *generate(req: GenRequest, signal: AbortSignal): AsyncGenerator<GenEvent> {
      const body = {
        model: opts.model,
        max_tokens: req.maxOutputTokens * 4, // thinking counts toward max_tokens
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
        stream: true,
      }
      let res: Response
      try {
        res = await request(`${BASE}/messages`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, signal, opts.key)
      } catch (e) {
        if (e instanceof SourceError && e.kind === 'aborted') { yield { type: 'done', stop: 'aborted' }; return }
        throw e
      }
      if (!res.body) throw new SourceError('unknown', 'empty response body')
      let stop: 'end' | 'length' = 'length' // until message_stop: a clean close without it is truncation
      let inTokens: number | undefined
      let cached: number | undefined
      let outTokens: number | undefined
      let sawLength = false
      let model = opts.model
      try {
        for await (const m of readSSE(res.body, signal)) {
          let j: any
          try { j = JSON.parse(m.data) } catch { continue }
          const type = m.event ?? j?.type
          if (type === 'error') {
            const et = j?.error?.type
            throw new SourceError(et === 'overloaded_error' ? 'busy' : et === 'rate_limit_error' ? 'rate-limit' : 'unknown', j?.error?.message)
          }
          if (type === 'message_stop') { stop = sawLength ? 'length' : 'end' } else if (type === 'message_start') {
            model = j.message?.model ?? model
            inTokens = j.message?.usage?.input_tokens
            cached = j.message?.usage?.cache_read_input_tokens
            yield { type: 'meta', model, billedTo: 'api-key' }
          } else if (type === 'content_block_delta') {
            if (j.delta?.type === 'text_delta' && typeof j.delta.text === 'string') yield { type: 'text', text: j.delta.text }
            // thinking_delta / signature_delta are ignored
          } else if (type === 'message_delta') {
            if (j.delta?.stop_reason === 'max_tokens') sawLength = true
            outTokens = j.usage?.output_tokens ?? outTokens
            inTokens = j.usage?.input_tokens ?? inTokens
            yield {
              type: 'meta', model, billedTo: 'api-key',
              usage: {
                ...(inTokens !== undefined ? { inputTokens: inTokens } : {}),
                ...(outTokens !== undefined ? { outputTokens: outTokens } : {}),
                ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
              },
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
