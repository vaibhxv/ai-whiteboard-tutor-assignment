import type { AiSource, GenEvent, GenRequest } from './types'

export type CaptureMeta = Extract<GenEvent, { type: 'meta' }>

/** Wraps a source; calls `sink(intent, fullText, meta)` when a generate finishes with stop 'end'. */
export function withCapture(
  src: AiSource,
  sink: (intent: string, text: string, meta: CaptureMeta) => void,
): AiSource {
  return {
    id: src.id,
    badge: () => src.badge(),
    preflight: () => src.preflight(),
    async *generate(req: GenRequest, signal: AbortSignal): AsyncGenerator<GenEvent> {
      let text = ''
      let meta: CaptureMeta | undefined
      for await (const e of src.generate(req, signal)) {
        if (e.type === 'text') text += e.text
        else if (e.type === 'meta') meta = e
        else if (e.type === 'done' && e.stop === 'end') {
          sink(req.intent, text, meta ?? { type: 'meta', model: src.badge().model, billedTo: src.badge().billedTo })
        }
        yield e
      }
    },
  }
}
