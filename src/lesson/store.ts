import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { LessonEvent } from './events'
import { reduce, replay } from './machine'
import type { LessonState } from './types'

export type LessonStore = {
  state: LessonState | null
  log: LessonEvent[]
  /** Appends to the log and reduces. */
  dispatch(e: LessonEvent): void
  /** Replaces the log and rebuilds the state from it. */
  load(log: LessonEvent[]): void
  reset(): void
}

export function createLessonStore(): StoreApi<LessonStore> {
  return createStore<LessonStore>()((set, get) => ({
    state: null,
    log: [],
    dispatch(e) {
      const { state, log } = get()
      set({ state: reduce(state, e), log: [...log, e] })
    },
    load(log) {
      set({ state: log.length ? replay(log) : null, log: [...log] })
    },
    reset() {
      set({ state: null, log: [] })
    },
  }))
}
