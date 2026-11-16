import { afterEach, describe, expect, test, vi } from 'vitest'
import { estimateSpeechMs } from '../../../src/player/durations'
import { createSpeech } from '../../../src/player/speech'
import { fakeClock, flush } from './helpers'

class FakeUtterance {
  text: string
  rate = 1
  voice: unknown = null
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) { this.text = text }
}

function fakeSynth(voices: { name: string; lang: string; localService: boolean }[] = [{ name: 'v', lang: 'en-GB', localService: true }]) {
  const spoken: FakeUtterance[] = []
  return {
    spoken,
    speak: vi.fn((u: FakeUtterance) => { spoken.push(u) }),
    cancel: vi.fn(),
    getVoices: () => voices,
  }
}

afterEach(() => vi.unstubAllGlobals())
const setup = (voices?: Parameters<typeof fakeSynth>[0], muted = false) => {
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  const synth = fakeSynth(voices)
  const clock = fakeClock()
  const speech = createSpeech({ muted: () => muted, synth: synth as never, clock })
  return { synth, clock, speech }
}

describe('createSpeech', () => {
  test('speaks one utterance with rate and a local en voice; end resolves done', async () => {
    const { synth, speech } = setup([
      { name: 'fr', lang: 'fr-FR', localService: true },
      { name: 'remote', lang: 'en-US', localService: false },
      { name: 'local', lang: 'en-GB', localService: true },
    ])
    expect(speech.available).toBe(true)
    const h = speech.speak('hello there', { rate: 1.25 })
    const u = synth.spoken[0]!
    expect(u.rate).toBe(1.25)
    expect((u.voice as { name: string }).name).toBe('local')
    let done = false
    void h.done.then(() => { done = true })
    await flush()
    expect(done).toBe(false)
    u.onend?.()
    await flush()
    expect(done).toBe(true)
  })

  test('watchdog: synth that never fires end resolves at estimate*2+2000', async () => {
    const { clock, speech } = setup()
    const text = 'one two three four five'
    const ms = estimateSpeechMs(text, 1) * 2 + 2000
    let done = false
    void speech.speak(text, { rate: 1 }).done.then(() => { done = true })
    clock.tick(ms - 1)
    await flush()
    expect(done).toBe(false)
    clock.tick(1)
    await flush()
    expect(done).toBe(true)
  })

  test('no voices or null synth: unavailable, resolves on the estimate timer', async () => {
    for (const synth of [null, fakeSynth([])]) {
      vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
      const clock = fakeClock()
      const speech = createSpeech({ muted: () => false, synth: synth as never, clock })
      expect(speech.available).toBe(false)
      let done = false
      void speech.speak('a b c', { rate: 1 }).done.then(() => { done = true })
      clock.tick(estimateSpeechMs('a b c', 1) - 1)
      await flush()
      expect(done).toBe(false)
      clock.tick(1)
      await flush()
      expect(done).toBe(true)
    }
  })

  test('muted: no utterance, timer-driven', async () => {
    const { synth, clock, speech } = setup(undefined, true)
    let done = false
    void speech.speak('a b c', { rate: 1 }).done.then(() => { done = true })
    expect(synth.speak).not.toHaveBeenCalled()
    clock.tick(estimateSpeechMs('a b c', 1))
    await flush()
    expect(done).toBe(true)
  })

  test('cancel calls synth.cancel and resolves; cancelAll cancels everything; error resolves', async () => {
    const { synth, speech } = setup()
    let a = false, b = false, c = false
    const ha = speech.speak('one', { rate: 1 })
    void ha.done.then(() => { a = true })
    ha.cancel()
    await flush()
    expect(synth.cancel).toHaveBeenCalled()
    expect(a).toBe(true)
    void speech.speak('two', { rate: 1 }).done.then(() => { b = true })
    speech.cancelAll()
    await flush()
    expect(b).toBe(true)
    void speech.speak('three', { rate: 1 }).done.then(() => { c = true })
    synth.spoken[2]!.onerror?.()
    await flush()
    expect(c).toBe(true)
  })
})
