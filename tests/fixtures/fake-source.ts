import { SourceError } from '../../src/sources/errors'
import type { AiSource, Badge, GenEvent, GenRequest, Role } from '../../src/sources/types'

/** A reply: plain text (stop 'end'), a thrown error, or text with an explicit stop reason. */
export type FakeReply = string | SourceError | { text: string; stop?: 'end' | 'length' }
/** `call` counts earlier requests with the same intent (0 for the first). */
export type FakeEntry = FakeReply | ((req: GenRequest, call: number) => FakeReply)

export type FakeOpts = {
  /** Delay before each chunk, in ms (0 → a microtask yield only). */
  delayMs?: number
  /** Characters per text chunk (default: the whole reply in one chunk). */
  chunk?: number
  id?: AiSource['id']
  /** Keep yielding after the signal aborts (to test that the consumer ignores late output). */
  ignoreAbort?: boolean
}

export type FakeRequest = { role: Role; intent: string; user: string; system: string; maxOutputTokens: number; signal: AbortSignal }

export type FakeSource = AiSource & {
  requests: FakeRequest[]
  intents(): string[]
  /** Highest number of generate calls running at once. */
  peak: number
  active: number
  /** Replace or add replies later in a test. */
  map: Record<string, FakeEntry>
}

const badge: Badge = { mode: 'live', text: 'LIVE · Anthropic API · fake', model: 'fake', billedTo: 'api-key' }

export function FakeSource(map: Record<string, FakeEntry>, opts: FakeOpts = {}): FakeSource {
  const calls = new Map<string, number>()
  const wait = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve())

  const src: FakeSource = {
    id: opts.id ?? 'anthropic',
    requests: [],
    peak: 0,
    active: 0,
    map,
    intents: () => src.requests.map((r) => r.intent),
    badge: () => badge,
    preflight: async () => ({ ready: true }),
    async *generate(req: GenRequest, signal: AbortSignal): AsyncGenerator<GenEvent> {
      src.requests.push({ role: req.role, intent: req.intent, user: req.user, system: req.system, maxOutputTokens: req.maxOutputTokens, signal })
      const call = calls.get(req.intent) ?? 0
      calls.set(req.intent, call + 1)
      src.active++
      src.peak = Math.max(src.peak, src.active)
      try {
        const entry = Object.hasOwn(src.map, req.intent) ? src.map[req.intent] : undefined
        if (entry === undefined) throw new SourceError('not-recorded', `fake: no reply for "${req.intent}"`)
        const reply = typeof entry === 'function' ? entry(req, call) : entry
        if (reply instanceof SourceError) {
          await wait(opts.delayMs ?? 0)
          throw reply
        }
        const { text, stop } = typeof reply === 'string' ? { text: reply, stop: 'end' as const } : { stop: 'end' as const, ...reply }
        yield { type: 'meta', model: 'fake', billedTo: 'api-key' }
        const size = Math.max(1, opts.chunk ?? text.length)
        for (let i = 0; i < text.length; i += size) {
          await wait(opts.delayMs ?? 0)
          if (signal.aborted && !opts.ignoreAbort) {
            yield { type: 'done', stop: 'aborted' }
            return
          }
          yield { type: 'text', text: text.slice(i, i + size) }
        }
        await wait(opts.delayMs ?? 0)
        yield { type: 'done', stop: signal.aborted && !opts.ignoreAbort ? 'aborted' : stop }
      } finally {
        src.active--
      }
    },
  }
  return src
}

/** JSON Lines from records. */
export const jsonl = (...records: object[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
