import { screen, within, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setSessionDeps } from '../../../src/ui/session'
import { useUi } from '../../../src/ui/store'
import { fakeSpeech } from '../player/helpers'
import { sessionStore } from '../../../src/ui/session'
import { lesson, startVertex, setup, teardown, tick, until } from './helpers'

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
})
