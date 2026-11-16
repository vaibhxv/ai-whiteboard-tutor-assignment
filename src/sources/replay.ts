import { realClock } from '../lib/clock'
import type { Clock } from '../lib/clock'
import { SourceError } from './errors'
import type { Recording } from './recording'
import { recordedBadge } from './types'
import type { AiSource, GenEvent, GenRequest } from './types'

export type ReplayOpts = { chunkChars?: number; intervalMs?: number; clock?: Clock }

export function createReplaySource(rec: Recording, opts: ReplayOpts = {}): AiSource {
  const chunkChars = Math.max(1, opts.chunkChars ?? 24)
  const intervalMs = opts.intervalMs ?? 30
  const clock = opts.clock ?? realClock

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve()
      let h: unknown
      const onAbort = () => { clock.clearTimeout(h); resolve() }
      h = clock.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
    })

  return {
    id: 'replay',
    badge: () => recordedBadge(rec),
    preflight: async () => ({ ready: true }),
    async *generate(req: GenRequest, signal: AbortSignal): AsyncGenerator<GenEvent> {
      const r = Object.hasOwn(rec.responses, req.intent) ? rec.responses[req.intent] : undefined
      if (!r) throw new SourceError('not-recorded', `No recording for "${req.intent}"`)
      yield { type: 'meta', model: rec.meta.model, billedTo: 'recording' }
      for (let i = 0; i < r.text.length; i += chunkChars) {
        if (i > 0) await sleep(intervalMs, signal)
        if (signal.aborted) {
          yield { type: 'done', stop: 'aborted' }
          return
        }
        yield { type: 'text', text: r.text.slice(i, i + chunkChars) }
      }
      yield { type: 'done', stop: signal.aborted ? 'aborted' : 'end' }
    },
  }
}
