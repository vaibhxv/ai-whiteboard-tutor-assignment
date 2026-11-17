import { act, screen, within } from '@testing-library/react'
import { entries } from 'idb-keyval'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LessonEvent } from '../../../src/lesson/events'
import { getActive, listLessons, saveLesson } from '../../../src/storage/history'
import { resetSession, sessionStore, setSessionDeps } from '../../../src/ui/session'
import { resetUi, useUi } from '../../../src/ui/store'
import { fakeSpeech } from '../player/helpers'
import { advance, fill, segPlan } from '../lesson/helpers'
import { fake } from '../layout/fake'
import { fixture, lesson, playToRecap, renderApp, setup, startVertex, stubFetch, teardown, tick, until } from './helpers'

vi.mock('../../../src/recordings/manifest', async () => ({ manifest: (await import('./manifest')).MANIFEST }))

beforeEach(setup)
afterEach(teardown)

const begin = (over: Partial<Extract<LessonEvent, { type: 'lesson/start' }>>): LessonEvent => ({ type: 'lesson/start', id: 'L1', topic: 'vertex form', badge: { mode: 'recorded', text: 'RECORDED · m · captured 1 Nov 2026', model: 'm', billedTo: 'recording' }, at: '2026-11-16T10:00:00.000Z', ...over })
const log = () => sessionStore.getState().session!.store.getState().log
/** `pagehide` saves at once (the debounce only fires once events go quiet); then the IDB queue drains. */
const settle = async () => { window.dispatchEvent(new Event('pagehide')); await tick(100); await tick(100) }

describe('history and resume', () => {
  test('a started lesson is saved after 500 ms with its summary and set active', async () => {
    await startVertex()
    await tick(10_000) // generation finishes; the warm-up waits, so the log is quiet and the debounce fires
    const list = await act(async () => { const p = listLessons(); await vi.advanceTimersByTimeAsync(100); return p })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ done: false, source: { kind: 'recording', slug: 'vertex' } })
    expect(list[0]?.badgeText).toMatch(/^RECORDED · /)
    const active = await act(async () => { const p = getActive(); await vi.advanceTimersByTimeAsync(100); return p })
    expect(active).toBe(list[0]?.id)
  })

  test('refresh mid-lesson: resumes paused at the cursor; speech starts only after the Resume click', async () => {
    const { user, unmount } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await until(() => lesson()?.phase === 'teaching' && (lesson()?.cursor.beat ?? 0) >= 1, 20_000, 50)
    await settle()
    const before = lesson()!
    unmount()
    resetSession() // the page is gone: nothing flushes
    resetUi()
    const speech = fakeSpeech()
    setSessionDeps({ measurer: fake, speech })
    stubFetch({ '/recordings/vertex.json': fixture })
    const r = renderApp()
    await until(() => !!lesson(), 5000, 50)
    expect(lesson()!.id).toBe(before.id)
    expect(lesson()!.cursor).toEqual(before.cursor)
    expect(log().at(-1)?.type).toBe('lesson/resumed')
    await tick(2000)
    expect(speech.spoken).toHaveLength(0)
    await r.user.click(screen.getByRole('button', { name: 'Resume lesson' }))
    await until(() => speech.spoken.length > 0, 5000, 50)
    expect(screen.queryByRole('button', { name: 'Resume lesson' })).toBeNull()
  })

  test('leaving via Home keeps the lesson in History but clears active', async () => {
    const { user } = await startVertex()
    await settle()
    await user.click(screen.getByRole('button', { name: 'Home' }))
    await tick(100)
    const [list, active] = await act(async () => { const p = Promise.all([listLessons(), getActive()]); await vi.advanceTimersByTimeAsync(200); return p })
    expect(list).toHaveLength(1)
    expect(active).toBeNull()
  })

  test('History screen: lists newest first, inline delete confirm, Delete all', async () => {
    const mk = async (id: string, createdAt: string, done: boolean) =>
      saveLesson(id, [begin({ id, at: createdAt })], { topic: `Topic ${id}`, createdAt, badgeText: 'RECORDED · m · captured 1 Nov 2026', done, source: { kind: 'recording', slug: 'vertex' } })
    vi.useRealTimers()
    await mk('a', '2026-11-01T10:00:00Z', true)
    await mk('b', '2026-11-05T10:00:00Z', false)
    vi.useFakeTimers()
    const { user } = renderApp()
    await user.click(screen.getByRole('button', { name: 'History' }))
    await tick(100)
    const items = await vi.waitFor(() => { const l = screen.getAllByRole('listitem').filter((e) => e.classList.contains('history-item')); expect(l).toHaveLength(2); return l }, { timeout: 3000, interval: 50 }).catch(async () => { await tick(200); return screen.getAllByRole('listitem') })
    expect(within(items[0]!).getByText('Topic b')).toBeInTheDocument()
    expect(within(items[0]!).getByText(/5 Nov 2026 · RECORDED · m · captured 1 Nov 2026 · In progress/)).toBeInTheDocument()
    expect(within(items[1]!).getByText(/1 Nov 2026 .* · Done/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete Topic b' }))
    expect(screen.getByText(/Delete this lesson\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.getByText('Topic b')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete Topic b' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    await tick(200)
    expect(screen.queryByText('Topic b')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Delete all' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    await tick(200)
    expect(screen.queryByText('Topic a')).toBeNull()
  })

  test('Open on a done lesson shows its recap read-only', { timeout: 60_000 }, async () => {
    const { user } = await startVertex()
    await playToRecap(user)
    const full: LessonEvent[] = [...log(), { type: 'lesson/done' }]
    const st = lesson()!
    await user.click(screen.getByRole('button', { name: 'Home' }))
    await tick(100)
    await act(async () => { const p = saveLesson(st.id, full, { topic: st.topic, createdAt: st.createdAt, badgeText: st.badge.text, done: true, source: { kind: 'recording', slug: 'vertex' } }); await vi.advanceTimersByTimeAsync(100); await p })
    await user.click(screen.getByRole('button', { name: 'History' }))
    await tick(200)
    await user.click(screen.getByRole('button', { name: `Open ${st.topic}` }))
    await tick(200)
    expect(screen.getByRole('heading', { name: 'Recap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /vertex sits halfway between the roots/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
    expect(sessionStore.getState().session?.readOnly).toBe('done')
  })

  test('a live lesson without its source opens read-only with a banner and Settings link', async () => {
    const liveLog: LessonEvent[] = [
      begin({ badge: { mode: 'live', text: 'LIVE · Anthropic API · m', model: 'm', billedTo: 'api-key' } }),
      { type: 'plan/record', record: segPlan(1) }, { type: 'plan/done' }, ...fill('seg:1', 2, 'c1'), ...advance(1),
    ]
    vi.useRealTimers()
    await saveLesson('L1', liveLog, { topic: 'vertex form', createdAt: '2026-11-16T10:00:00.000Z', badgeText: 'LIVE · Anthropic API · m', done: false, source: { kind: 'live', sourceId: 'anthropic', model: 'm' } })
    vi.useFakeTimers()
    const { user } = renderApp()
    await user.click(screen.getByRole('button', { name: 'History' }))
    await tick(200)
    await user.click(screen.getByRole('button', { name: 'Open vertex form' }))
    await tick(200)
    expect(screen.getByText(/This lesson was generated live\. Reconnect the same AI source to continue\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(useUi.getState().screen).toBe('settings')
  })

  test('no API key or secret reaches IndexedDB', async () => {
    const KEY = 'sk-test-SECRET-123'
    sessionStorage.setItem('whyboard.key', KEY)
    await startVertex()
    await settle()
    const all = await act(async () => { const p = entries(); await vi.advanceTimersByTimeAsync(100); return p })
    expect(all.length).toBeGreaterThan(0)
    expect(JSON.stringify(all)).not.toContain(KEY)
    sessionStorage.clear()
  })

  test('when IndexedDB fails, History says so and the app still works', async () => {
    const mod = await import('../../../src/ui/session')
    vi.spyOn(mod, 'listLessons').mockRejectedValue(new Error('no idb'))
    const { user } = renderApp()
    await user.click(screen.getByRole('button', { name: 'History' }))
    await tick(100)
    expect(screen.getByText("History isn't available in this browser.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: /stuck on a maths idea/i })).toBeInTheDocument()
  })
})
