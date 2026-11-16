import type { Clock } from '../../../src/lib/clock'
import type { Speech } from '../../../src/player/speech'

export type FakeClock = Clock & { tick(ms: number): void; pending(): number }

export function fakeClock(): FakeClock {
  let t = 0
  let id = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => t,
    setTimeout(fn, ms) { const h = ++id; timers.set(h, { at: t + ms, fn }); return h },
    clearTimeout(h) { timers.delete(h as number) },
    pending: () => timers.size,
    tick(ms) {
      const end = t + ms
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!next) break
        timers.delete(next[0])
        t = next[1].at
        next[1].fn()
      }
      t = end
    },
  }
}

/** Flushes promise continuations. */
export const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

export type FakeSpeech = Speech & {
  spoken: { text: string; rate: number; cancelled: boolean; finish(): void }[]
  cancelAllCalls: number
}

/** Speech whose utterances finish only when the test says so. */
export function fakeSpeech(available = true): FakeSpeech {
  const spoken: FakeSpeech['spoken'] = []
  const sp: FakeSpeech = {
    available,
    spoken,
    cancelAllCalls: 0,
    speak(text, { rate }) {
      let res!: () => void
      const done = new Promise<void>((r) => { res = r })
      const rec = { text, rate, cancelled: false, finish: () => res() }
      spoken.push(rec)
      return { done, cancel: () => { rec.cancelled = true; res() } }
    },
    cancelAll() {
      sp.cancelAllCalls++
      for (const s of spoken) if (!s.cancelled) { s.cancelled = true; s.finish() }
    },
  }
  return sp
}
