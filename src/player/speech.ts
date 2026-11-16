import { realClock } from '../lib/clock'
import type { Clock } from '../lib/clock'
import { estimateSpeechMs } from './durations'

export interface Speech {
  /** True when the browser has speech synthesis with at least one voice. */
  readonly available: boolean
  speak(text: string, opts: { rate: number }): { done: Promise<void>; cancel(): void }
  cancelAll(): void
}

function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  const en = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
  return en.find((v) => v.localService) ?? en[0]
}

export function createSpeech(opts: { muted: () => boolean; synth?: SpeechSynthesis | null; clock?: Clock }): Speech {
  const clock = opts.clock ?? realClock
  const synth = opts.synth === undefined ? (typeof speechSynthesis === 'undefined' ? null : speechSynthesis) : opts.synth
  const active = new Set<() => void>()
  // Chrome may garbage-collect an utterance mid-speech and never fire `end`; keep references.
  const keep = new Set<unknown>()

  const hasVoices = () => {
    try {
      return !!synth && typeof SpeechSynthesisUtterance !== 'undefined' && synth.getVoices().length > 0
    } catch {
      return false
    }
  }

  return {
    get available() {
      return hasVoices()
    },
    speak(text, { rate }) {
      let finish!: () => void
      const done = new Promise<void>((r) => { finish = r })
      let over = false
      let timer: unknown
      let spoken: unknown
      const end = () => {
        if (over) return
        over = true
        clock.clearTimeout(timer)
        active.delete(cancel)
        if (spoken) keep.delete(spoken)
        finish()
      }
      const cancel = () => {
        if (over) return
        if (spoken && synth) {
          try { synth.cancel() } catch { /* ignore */ }
        }
        end()
      }
      active.add(cancel)
      const est = estimateSpeechMs(text, rate)
      if (opts.muted() || !hasVoices() || !synth || !text) {
        timer = clock.setTimeout(end, est)
        return { done, cancel }
      }
      try {
        const u = new SpeechSynthesisUtterance(text)
        u.rate = rate
        const v = pickVoice(synth)
        if (v) { u.voice = v; u.lang = v.lang }
        u.onend = end
        u.onerror = end
        spoken = u
        keep.add(u)
        timer = clock.setTimeout(end, est * 2 + 2000)
        synth.speak(u)
      } catch {
        spoken = undefined
        clock.clearTimeout(timer)
        timer = clock.setTimeout(end, est)
      }
      return { done, cancel }
    },
    cancelAll() {
      for (const c of [...active]) c()
    },
  }
}
