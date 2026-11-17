import { screen, within, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setSessionDeps } from '../../../src/ui/session'
import { useUi } from '../../../src/ui/store'
import { fakeSpeech } from '../player/helpers'
import { FakeSource, jsonl } from '../../fixtures/fake-source'
import { sessionStore } from '../../../src/ui/session'
import { lesson, renderApp, startVertex, setup, teardown, tick, until } from './helpers'

vi.mock('../../../src/recordings/manifest', async () => ({ manifest: (await import('./manifest')).MANIFEST }))

beforeEach(setup)
afterEach(teardown)

const sessionLesson = () => sessionStore.getState().session!.store.getState()
const el = (id: string) => document.querySelector(`[data-el="${id}"]`) as HTMLElement | null
const positions = () =>
  Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('.layer [data-el]:not(.ink-answer)')).map((e) => [e.dataset.el!, `${e.dataset.ox},${e.dataset.oy}`]))

/** Warm-up answered; the lesson is teaching segment 2 (it has the suggested question q2). */
async function toSegment2(user: Awaited<ReturnType<typeof startVertex>>['user']) {
  await user.click(screen.getByRole('button', { name: '4' }))
  await until(() => lesson()?.phase === 'checkpoint')
  await user.click(screen.getByLabelText(/halfway between the roots/i))
  await user.click(screen.getByRole('button', { name: 'Check' }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await until(() => lesson()?.cursor.seg === 'seg:2' && (lesson()?.segments['seg:2']?.asks.length ?? 0) > 0 && lesson()!.cursor.beat >= 1)
}

describe('interrupts', () => {
  test('raise hand during a beat: speech.cancelAll called synchronously, overlay open', async () => {
    const speech = fakeSpeech()
    setSessionDeps({ speech })
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await until(() => speech.spoken.length > 0, 5000, 50)
    const before = speech.cancelAllCalls
    const state = await act(async () => {
      screen.getByRole('button', { name: /raise hand/i }).click()
      return { calls: speech.cancelAllCalls, overlay: lesson()?.overlay }
    })
    expect(state.calls).toBeGreaterThan(before)
    expect(state.overlay).toEqual({ kind: 'interrupt' })
    expect(screen.getByRole('form', { name: 'Ask the tutor' })).toBeInTheDocument()
    expect(screen.getByLabelText('Your question')).toHaveAttribute('maxLength', '500')
    const play = screen.getByRole('button', { name: 'Play' })
    expect(play).toBeDisabled()
  })

  test('the "/" key raises a hand', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await user.keyboard('/')
    expect(lesson()?.overlay?.kind).toBe('interrupt')
  })

  test('select vertex → Ask about this → "v" chip; the suggested chip asks with its askId', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await until(() => el('v') !== null, 60_000)
    await user.click(el('v')!)
    await user.click(screen.getByRole('button', { name: 'Ask about this' }))
    expect(lesson()?.overlay?.kind).toBe('interrupt')
    const chips = screen.getByRole('list', { name: 'Asking about' })
    expect(within(chips).getByText(/point/i)).toBeInTheDocument()
    expect(useUi.getState().askTargets).toEqual(['v'])
    await user.click(within(chips).getByRole('button', { name: /remove/i }))
    expect(screen.queryByRole('list', { name: 'Asking about' })).toBeNull()
  })

  test('answer plays in the panel; lesson items keep their boxes', async () => {
    const { user } = await startVertex()
    await toSegment2(user)
    const before = positions()
    await user.click(screen.getByRole('button', { name: /raise hand/i }))
    await user.click(screen.getByRole('button', { name: 'Why is the vertex the lowest point?' }))
    expect(lesson()?.threads[0]?.askId).toBe('q2')
    await until(() => lesson()?.threads[0]?.status === 'complete')
    expect(screen.getByText('Answer', { selector: '.answer-head' })).toBeInTheDocument()
    await until(() => !!screen.queryByText('Did that clear it up?'))
    const panel = screen.getByRole('group', { name: 'Answer panel' })
    expect(el('aq1')).not.toBeNull()
    expect(panel.contains(el('aq1'))).toBe(true)
    expect(el('aq1')!.className).toContain('ink-answer')
    const after = positions()
    for (const [id, pos] of Object.entries(before)) expect(after[id]).toBe(pos)
    expect(screen.getByRole('region', { name: 'Answer' })).toHaveTextContent('The curve opens upward')
  })

  test('Yes, carry on → lesson track again, the interrupted beat plays from its start', async () => {
    const { user } = await startVertex()
    await toSegment2(user)
    const cursor = lesson()!.cursor
    const say = screen.getByTestId('captions').textContent
    await user.click(screen.getByRole('button', { name: /raise hand/i }))
    expect(lesson()?.cursor).toEqual(cursor)
    await tick(5000) // the lesson stays where it was while the hand is up
    expect(lesson()?.cursor).toEqual(cursor)
    await user.click(screen.getByRole('button', { name: 'Why is the vertex the lowest point?' }))
    await until(() => !!screen.queryByText('Did that clear it up?'))
    expect(screen.getByTestId('captions').textContent).not.toBe(say)
    await user.click(screen.getByRole('button', { name: 'Yes, carry on' }))
    expect(lesson()?.overlay).toBeNull()
    expect(lesson()?.playback).toEqual({ track: 'lesson' })
    expect(lesson()?.cursor).toEqual(cursor)
    expect(screen.getByTestId('captions').textContent).toBe(say)
    expect(screen.queryByRole('group', { name: 'Answer panel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  })

  test('replay source: free-text disabled with reason; follow-ups disabled; second "I\'m lost" disabled with reason', async () => {
    const { user } = await startVertex()
    await toSegment2(user)
    await user.click(screen.getByRole('button', { name: /raise hand/i }))
    expect(screen.getByLabelText('Your question')).toBeDisabled()
    expect(screen.getByText('Typed questions need a live AI source.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Why is the vertex the lowest point?' }))
    await until(() => !!screen.queryByText('Did that clear it up?'))
    expect(screen.getByRole('button', { name: 'Not quite' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show me differently' })).toBeDisabled()
    expect(screen.getByText('Follow-up questions need a live AI source.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, carry on' }))
    const lost = screen.getByRole('button', { name: /I'm lost/ })
    expect(lost).toBeEnabled()
    await user.click(lost)
    expect(lesson()?.cursor.seg).toBe('lost:2:1')
    expect(screen.getByRole('button', { name: /I'm lost/ })).toBeDisabled()
    expect(screen.getByText('Recorded lessons include one other explanation per step.')).toBeInTheDocument()
  })

  test('Something looks wrong on a checked element in replay → answer panel shows "Checked by code"', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await until(() => el('v') !== null, 60_000)
    await user.click(el('v')!)
    await user.click(screen.getByRole('button', { name: 'Something looks wrong' }))
    await until(() => !!screen.queryByRole('region', { name: 'Answer' }))
    await until(() => lesson()?.playback.track === 'answer' && (lesson()?.playback as { beat: number }).beat >= 0 && !!screen.queryByText('Did that clear it up?'))
    expect(screen.getByRole('region', { name: 'Answer' })).toHaveTextContent('Checked by code')
  })

  test('a hand raised at a checkpoint leaves the cursor and phase alone', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await until(() => lesson()?.phase === 'checkpoint')
    await user.click(screen.getByRole('button', { name: /raise hand/i }))
    expect(lesson()?.overlay?.kind).toBe('interrupt')
    const at = lesson()!.cursor
    await tick(3000)
    expect(lesson()?.cursor).toEqual(at)
    expect(lesson()?.phase).toBe('checkpoint')
  })

  test('struck elements are drawn struck through and stay visible', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await until(() => el('eq1') !== null, 60_000)
    expect(el('eq1')!.className).not.toContain('is-struck')
    await act(async () => { sessionLesson().dispatch({ type: 'element/strike', id: 'eq1' }) })
    expect(el('eq1')!.className).toContain('is-struck')
    expect(el('eq1')!.querySelector('.strike-line')).not.toBeNull()
    expect(el('eq1')).toBeVisible()
  })

  test('struck points and lines inside a plot are struck through too', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    await until(() => el('v') !== null, 60_000)
    expect(el('v')!.className).not.toContain('is-struck')
    await act(async () => { sessionLesson().dispatch({ type: 'element/strike', id: 'v' }) })
    const v = el('v')!
    expect(v.getAttribute('class')).toContain('is-struck')
    expect(v.getAttribute('aria-label')).toMatch(/Marked as wrong\.$/)
    expect(v.querySelector('.strike-svg')).not.toBeNull()
    expect(v.querySelectorAll('.strike-svg line')).toHaveLength(2) // a point gets an X
  })

  test('while an answer plays or awaits "Did that clear it up?", the lesson controls stay disabled', async () => {
    const { user } = await startVertex()
    await toSegment2(user)
    await user.click(screen.getByRole('button', { name: /raise hand/i }))
    await user.click(screen.getByRole('button', { name: 'Why is the vertex the lowest point?' }))
    for (const name of ['Back one step', 'Play', 'Forward one step', 'Replay this step']) expect(screen.getByRole('button', { name })).toBeDisabled()
    await until(() => !!screen.queryByText('Did that clear it up?'))
    for (const name of ['Back one step', 'Play', 'Forward one step', 'Replay this step']) expect(screen.getByRole('button', { name })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Yes, carry on' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  })

  test('Yes, carry on restarts the interrupted beat: speech speaks it again and its drawing re-animates', async () => {
    const speech = fakeSpeech()
    setSessionDeps({ speech })
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '4' }))
    const finishAll = () => speech.spoken.forEach((s) => s.finish())
    await until(() => { finishAll(); return lesson()?.phase === 'checkpoint' })
    await user.click(screen.getByLabelText(/halfway between the roots/i))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    for (let i = 0; i < 400 && !(lesson()?.cursor.seg === 'seg:2' && lesson()?.cursor.beat === 1); i++) { finishAll(); await tick(20) }
    expect(lesson()?.cursor).toEqual({ seg: 'seg:2', beat: 1 })
    const say = speech.spoken.at(-1)!.text
    const animating = Array.from(document.querySelectorAll('.layer [class*="anim-"]'))
    expect(animating.length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /raise hand/i }))
    await user.click(screen.getByRole('button', { name: 'Why is the vertex the lowest point?' }))
    for (let i = 0; i < 400 && !screen.queryByText('Did that clear it up?'); i++) { finishAll(); await tick(20) }
    const spokenBefore = speech.spoken.length
    await user.click(screen.getByRole('button', { name: 'Yes, carry on' }))
    expect(speech.spoken.length).toBeGreaterThan(spokenBefore)
    expect(speech.spoken.at(-1)!.text).toBe(say)
    expect(lesson()?.cursor).toEqual({ seg: 'seg:2', beat: 1 })
    expect(animating.every((n) => !n.isConnected)).toBe(true) // re-keyed: the drawing starts over
    expect(document.querySelectorAll('.layer [class*="anim-"]').length).toBeGreaterThan(0)
  })

  test('live: Something looks wrong opens its own review thread; it attaches before the verdict arrives, and a second report is ignored', async () => {
    useUi.getState().updateSettings({ sourceId: 'anthropic' })
    const say = (text: string) => ({ t: 'say', text })
    const plan = jsonl(
      { t: 'scope', verdict: 'in', reason: 'ok' },
      { t: 'objective', text: 'Learn it.' },
      { t: 'segment', n: 1, title: 'Part 1', goal: 'g', representation: 'worked', misconception: 'm', check: 'choice' },
    )
    const seg = jsonl(
      say('Look at this line.'), { t: 'math', id: 's1m', latex: '2+2=5', expr: '2+2=5' }, say('Wait.'), { t: 'write', id: 's1w', text: 'note' },
    )
    const verdict = jsonl({ t: 'verdict', ok: false, say: 'You are right, that line was wrong.' })
    const src = FakeSource({ plan, 'segment:1': seg, 'review:s1m': verdict }, { delayMs: 40 })
    setSessionDeps({ createSource: () => src })
    const { user } = renderApp()
    await user.type(screen.getByLabelText('What are you stuck on?'), 'a topic')
    await user.click(screen.getByRole('button', { name: 'Start lesson' }))
    await until(() => el('s1m') !== null, 60_000)
    await user.click(el('s1m')!)
    await user.click(screen.getByRole('button', { name: 'Something looks wrong' }))
    // The controller opened the thread synchronously; the verdict has not arrived yet.
    const open = lesson()!
    expect(open.overlay).toMatchObject({ kind: 'interrupt', threadId: expect.any(String) })
    expect(open.threads).toHaveLength(1)
    expect(['pending', 'streaming']).toContain(open.threads[0]!.status)
    expect(screen.getByRole('region', { name: 'Answer' })).toBeInTheDocument()
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    // A second report while the answer is open does not open a second thread.
    await user.click(el('s1m')!)
    await user.click(screen.getByRole('button', { name: 'Something looks wrong' }))
    expect(lesson()?.threads).toHaveLength(1)
    await until(() => lesson()?.threads[0]?.status === 'complete')
    await until(() => !!screen.queryByText('Did that clear it up?'))
    expect(lesson()?.threads).toHaveLength(1)
    expect(lesson()?.struck).toContain('s1m')
    expect(screen.getByRole('region', { name: 'Answer' })).toHaveTextContent('You are right, that line was wrong.')
    expect(el('s1m')!.className).toContain('is-struck')
    expect(src.intents().filter((i) => i === 'review:s1m')).toHaveLength(1)
  })
})
