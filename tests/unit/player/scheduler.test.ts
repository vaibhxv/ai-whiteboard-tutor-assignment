import { describe, expect, test, vi } from 'vitest'
import { createSpeech } from '../../../src/player/speech'
import { createScheduler } from '../../../src/player/scheduler'
import { estimateSpeechMs, timeBeat } from '../../../src/player/durations'
import { beat, w } from '../layout/fake'
import { fakeClock, fakeSpeech, flush } from './helpers'

const b1 = beat('s#0', [w('a', 'x'.repeat(30))], 'one two three four five six')
const total = timeBeat(b1, 1).total

function setup() {
  const clock = fakeClock()
  const speech = fakeSpeech()
  const ended: string[] = []
  const sch = createScheduler({ speech, clock, onBeatEnd: (id) => ended.push(id) })
  return { clock, speech, ended, sch }
}

describe('scheduler', () => {
  test('onBeatEnd fires once, only after both speech and the animation timer complete', async () => {
    const { clock, speech, ended, sch } = setup()
    sch.play(b1, 1)
    expect(sch.state).toBe('playing')
    expect(speech.spoken[0]!.text).toBe(b1.say)
    clock.tick(total + 100)
    await flush()
    expect(ended).toEqual([]) // timer done, speech still going
    speech.spoken[0]!.finish()
    await flush()
    expect(ended).toEqual(['s#0'])
    expect(sch.state).toBe('idle')
    clock.tick(10_000)
    await flush()
    expect(ended).toEqual(['s#0'])
  })

  test('speech finishing first still waits for the timer', async () => {
    const { clock, speech, ended, sch } = setup()
    sch.play(b1, 1)
    speech.spoken[0]!.finish()
    await flush()
    expect(ended).toEqual([])
    clock.tick(total)
    await flush()
    expect(ended).toEqual(['s#0'])
  })

  test('empty say: timer only, no utterance', async () => {
    const { clock, speech, ended, sch } = setup()
    const b = beat('s#1', [w('a')], '')
    sch.play(b, 1)
    expect(speech.spoken).toHaveLength(0)
    clock.tick(timeBeat(b, 1).total)
    await flush()
    expect(ended).toEqual(['s#1'])
  })

  test('no voices (speech unavailable): same beat order, driven by the timer', async () => {
    const clock = fakeClock()
    const speech = fakeSpeech(false)
    const ended: string[] = []
    const sch = createScheduler({ speech, clock, onBeatEnd: (id) => ended.push(id) })
    const b2 = beat('s#1', [w('b')], 'two words')
    sch.play(b1, 1)
    clock.tick(estimateSpeechMs(b1.say, 1))
    speech.spoken[0]!.finish() // what the real timer-backed speech would do
    clock.tick(total)
    await flush()
    sch.play(b2, 1)
    speech.spoken[1]!.finish()
    clock.tick(timeBeat(b2, 1).total)
    await flush()
    expect(ended).toEqual(['s#0', 's#1'])
  })

  test('mute mid-sentence: cancelling speech lets the beat finish on the timer, once', async () => {
    const { clock, speech, ended, sch } = setup()
    sch.play(b1, 1)
    clock.tick(500)
    speech.cancelAll()
    await flush()
    expect(ended).toEqual([])
    clock.tick(total - 500)
    await flush()
    expect(ended).toEqual(['s#0'])
    clock.tick(5000)
    await flush()
    expect(ended).toEqual(['s#0'])
  })

  test('pause cancels speech synchronously and the timer; resume replays from the start', async () => {
    const { clock, speech, ended, sch } = setup()
    sch.play(b1, 1)
    clock.tick(1000)
    sch.pause()
    expect(sch.state).toBe('paused')
    expect(speech.spoken[0]!.cancelled).toBe(true)
    expect(clock.pending()).toBe(0)
    clock.tick(100_000)
    await flush()
    expect(ended).toEqual([])
    sch.resume()
    expect(sch.state).toBe('playing')
    expect(speech.spoken).toHaveLength(2)
    speech.spoken[1]!.finish()
    clock.tick(total - 1)
    await flush()
    expect(ended).toEqual([])
    clock.tick(1)
    await flush()
    expect(ended).toEqual(['s#0'])
  })

  test('play replaces a running beat without firing its end; stop silences', async () => {
    const { clock, speech, ended, sch } = setup()
    const b2 = beat('s#1', [w('b')], '')
    sch.play(b1, 1)
    sch.play(b2, 1)
    speech.spoken[0]!.finish()
    clock.tick(total + timeBeat(b2, 1).total)
    await flush()
    expect(ended).toEqual(['s#1'])
    sch.play(b1, 1)
    sch.stop()
    clock.tick(total)
    await flush()
    expect(ended).toEqual(['s#1'])
    expect(sch.state).toBe('idle')
    expect(vi.isFakeTimers()).toBe(false)
  })
})

describe('scheduler with the real speech', () => {
  class U { text: string; rate = 1; voice: unknown = null; lang = ''; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t } }
  const beats = [beat('s#0', [w('a')], 'one two three'), beat('s#1', [w('b')], ''), beat('s#2', [w('c')], 'four five')]

  async function run(synth: unknown) {
    vi.stubGlobal('SpeechSynthesisUtterance', U)
    const clock = fakeClock()
    const speech = createSpeech({ muted: () => false, synth: synth as never, clock })
    const ended: string[] = []
    let i = 0
    const sch = createScheduler({ speech, clock, onBeatEnd: (id) => { ended.push(id); if (++i < beats.length) sch.play(beats[i]!, 1) } })
    sch.play(beats[0]!, 1)
    for (let k = 0; k < 40; k++) { clock.tick(500); await flush() }
    clock.tick(100_000); await flush()
    vi.unstubAllGlobals()
    return ended
  }

  test('synth null: every beat ends exactly once, in order', async () => {
    expect(await run(null)).toEqual(['s#0', 's#1', 's#2'])
  })
  test('synth that never fires end: watchdog ends each beat once', async () => {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ name: 'v', lang: 'en-US', localService: true }] }
    expect(await run(synth)).toEqual(['s#0', 's#1', 's#2'])
  })
})
