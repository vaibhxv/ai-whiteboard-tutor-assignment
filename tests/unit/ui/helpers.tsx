import { readFileSync } from 'node:fs'
import { clear } from 'idb-keyval'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import App from '../../../src/App'
import type { LessonState } from '../../../src/lesson/types'
import type { Recording } from '../../../src/sources/recording'
import { resetSession, sessionStore, setSessionDeps } from '../../../src/ui/session'
import { resetUi } from '../../../src/ui/store'
import { fake } from '../layout/fake'

export const fixtureText = readFileSync('tests/fixtures/lessons/vertex.fixture.json', 'utf8')
export const fixture = JSON.parse(fixtureText) as Recording

export { MANIFEST } from './manifest'

/** `fetch` serving recordings by URL. */
export function stubFetch(files: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const body = files[url]
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  setSessionDeps({ fetch: fn as unknown as typeof fetch })
  return fn
}

export function recordingWith(responses: Record<string, string>): Recording {
  return { meta: fixture.meta, responses: Object.fromEntries(Object.entries(responses).map(([k, text]) => [k, { text }])) }
}

export async function setup() {
  await wipeIdb()
  vi.useFakeTimers()
  // Testing Library's async wrapper only advances fake timers it recognises as Jest's.
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
  try { localStorage.clear() } catch { /* ignore */ }
  resetSession()
  resetUi()
  setSessionDeps({ measurer: fake })
  stubFetch({ '/recordings/vertex.json': fixture })
}

/** Clears IndexedDB without ever hanging a hook (a transaction orphaned by fake timers must not block). */
const wipeIdb = () => Promise.race([clear().catch(() => {}), new Promise<void>((r) => setTimeout(r, 1500))])

export async function teardown() {
  resetSession()
  await vi.advanceTimersByTimeAsync(300) // let in-flight IDB work (driven by fake timers) finish
  resetUi()
  try { localStorage.clear() } catch { /* ignore */ }
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await wipeIdb()
}

export function renderApp() {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  const utils = render(<App />)
  return { user, ...utils }
}

export const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

export const lesson = (): LessonState | null => sessionStore.getState().session?.store.getState().state ?? null

/** Advances fake time in small steps until `pred` holds (fails after `maxMs`). */
export async function until(pred: () => boolean, maxMs = 120_000, step = 250) {
  for (let t = 0; t <= maxMs; t += step) {
    if (pred()) return
    await tick(step)
  }
  throw new Error(`condition not met within ${maxMs} ms (phase ${lesson()?.phase})`)
}

/** Starts the vertex starter lesson and waits for the warm-up. */
export async function startVertex() {
  const r = renderApp()
  await r.user.click(screen.getByRole('button', { name: /why the vertex is halfway/i }))
  await until(() => lesson()?.phase === 'warmup', 5000, 50)
  return r
}

/** From the warm-up, answers everything correctly up to the recap (practice not started). */
export async function playToRecap(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '4' }))
  await until(() => lesson()?.phase === 'checkpoint')
  await user.click(screen.getByLabelText(/halfway between the roots/i))
  await user.click(screen.getByRole('button', { name: 'Check' }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await until(() => lesson()?.phase === 'checkpoint')
  await user.type(screen.getByLabelText('Your answer'), '-1')
  await user.click(screen.getByRole('button', { name: 'Check' }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await until(() => lesson()?.phase === 'recap' && lesson()?.recap?.status === 'complete')
}
