import type { Clock } from '../lib/clock'
import type { Beat } from '../pipeline/beats'
import { timeBeat } from './durations'
import type { Speech } from './speech'

export type Scheduler = {
  play(beat: Beat, speed: number): void
  pause(): void
  resume(): void
  stop(): void
  readonly state: 'idle' | 'playing' | 'paused'
}

export function createScheduler(deps: { speech: Speech; clock: Clock; onBeatEnd(beatId: string): void }): Scheduler {
  const { speech, clock } = deps
  let state: Scheduler['state'] = 'idle'
  let gen = 0
  let timer: unknown
  let current: { beat: Beat; speed: number } | null = null

  const halt = () => {
    gen++
    clock.clearTimeout(timer)
    speech.cancelAll()
  }

  function play(beat: Beat, speed: number) {
    halt()
    current = { beat, speed }
    state = 'playing'
    const mine = gen
    let waiting = 2
    const part = () => {
      if (mine !== gen || --waiting > 0) return
      state = 'idle'
      deps.onBeatEnd(beat.id)
    }
    const { total } = timeBeat(beat, speed)
    if (beat.say) void speech.speak(beat.say, { rate: speed }).done.then(part)
    else waiting--
    timer = clock.setTimeout(part, total)
  }

  return {
    play,
    pause() {
      if (state !== 'playing') return
      halt()
      state = 'paused'
    },
    resume() {
      if (state === 'paused' && current) play(current.beat, current.speed)
    },
    stop() {
      halt()
      state = 'idle'
    },
    get state() {
      return state
    },
  }
}
