import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useUi } from '../../../src/ui/store'
import { fixture, lesson, playToRecap, renderApp, setup, startVertex, stubFetch, teardown, until } from './helpers'

vi.mock('../../../src/recordings/manifest', async () => ({ manifest: (await import('./manifest')).MANIFEST }))

beforeEach(setup)
afterEach(teardown)

const DISCLOSURE = 'AI-generated lesson. Maths marked ✓ was checked by code.'
const badgeText = 'RECORDED · claude-sonnet-5-5 · captured 16 Nov 2026'

describe('LessonScreen', () => {
  test('disclosure text exact; badge present on the lesson, recap and practice screens', async () => {
    const { user } = await startVertex()
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
    expect(screen.getByTestId('source-badge')).toHaveTextContent(badgeText)
    await playToRecap(user)
    expect(screen.getByRole('heading', { name: 'Recap' })).toBeInTheDocument()
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
    expect(screen.getByTestId('source-badge')).toHaveTextContent(badgeText)
    await user.click(screen.getByRole('button', { name: 'Practice' }))
    expect(lesson()?.phase).toBe('practice')
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeInTheDocument()
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
    expect(screen.getByTestId('source-badge')).toHaveTextContent(badgeText)
  })

  test('landmarks, lesson heading, and a single caption live region while teaching', async () => {
    const { user, container } = await startVertex()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '2' }))
    await until(() => (lesson()?.cursor.beat ?? 0) >= 1)
    expect(screen.getByTestId('captions')).toHaveTextContent(/\w/)
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Lesson controls' })).toBeInTheDocument()
  })

  test('wrong answer at the checkpoint: "Not quite" feedback, reteach plays, then the checkpoint returns', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: 'Skip' })) // skip the warm-up
    await until(() => lesson()?.phase === 'checkpoint')
    await user.click(screen.getByLabelText(/constant term 3 minus 1/i))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(lesson()?.cursor.seg).toBe('reteach:c1:1')
    expect(screen.getByRole('status')).toHaveTextContent("Not quite. Let's look at it another way.")
    expect(screen.queryByText(/halfway between the roots 1 and 3, because/i)).toBeNull() // answer not revealed
    await until(() => lesson()?.phase === 'checkpoint')
    expect(lesson()?.currentCheck).toBe('c1')
    expect(screen.getByRole('region', { name: 'Checkpoint' })).toBeInTheDocument()
  })

  test('progress rail: completed segments open a read-only review; future ones are not clickable', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: '2' }))
    await until(() => lesson()?.phase === 'checkpoint')
    const rail = screen.getByRole('navigation', { name: 'Lesson progress' })
    expect(within(rail).getByText('Roots and symmetry').closest('[aria-current="step"]')).not.toBeNull()
    expect(within(rail).queryByRole('button', { name: /completing the picture/i })).toBeNull()
    await user.click(screen.getByLabelText(/halfway between the roots/i))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(lesson()?.cursor.seg).toBe('seg:2')
    const cursor = lesson()?.cursor
    await user.click(within(rail).getByRole('button', { name: /roots and symmetry/i }))
    const review = screen.getByRole('region', { name: /review: roots and symmetry/i })
    expect(review.querySelector('[data-el="eq1"]')).not.toBeNull()
    expect(lesson()?.cursor).toEqual(cursor) // the lesson cursor does not move
    await user.click(screen.getByRole('button', { name: 'Back to lesson' }))
    expect(screen.queryByRole('region', { name: /review:/i })).toBeNull()
  })

  test('thinking indicator while planning; Cancel shows the Stopped problem with Carry on and Go home', async () => {
    const { user } = renderApp()
    await user.click(screen.getByRole('button', { name: /why the vertex is halfway/i }))
    await until(() => lesson()?.phase === 'planning', 1000, 10)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dlg = screen.getByRole('alertdialog')
    expect(within(dlg).getByText('Stopped')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Carry on' })).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Carry on' }))
    await until(() => lesson()?.phase === 'warmup', 5000, 50)
  })

  test('problem overlay: a missing recorded part explains itself and offers Go home', async () => {
    const { ['segment:1']: _gone, ...rest } = fixture.responses
    stubFetch({ '/recordings/vertex.json': { ...fixture, responses: rest } })
    // Segment 1 is generated during the warm-up, so the problem opens over the warm-up.
    const { user } = await startVertex()
    await until(() => !!screen.queryByRole('alertdialog'), 5000, 50)
    const dlg = screen.getByRole('alertdialog')
    expect(within(dlg).getByText("That part isn't in this recorded lesson")).toBeInTheDocument()
    // The rest of the app is inert while the problem is open, and focus starts on its primary action.
    const app = document.querySelector('.app')!
    expect(app.closest('[inert]')).not.toBeNull()
    expect(dlg.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Connect an AI' }))
    await user.keyboard('{Escape}') // nothing destructive
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Go home' }))
    expect(useUi.getState().screen).toBe('home')
    expect(document.querySelector('[inert]')).toBeNull()
  })

  test('narrow: the checkpoint and its wrong-answer note sit in the stage, right under the captions', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(375)
    try {
      const { user } = await startVertex()
      await user.click(screen.getByRole('button', { name: 'Skip' }))
      await until(() => lesson()?.phase === 'checkpoint')
      const stage = document.querySelector('.stage')!
      const side = screen.getByRole('complementary', { name: 'Lesson panel' })
      const captions = screen.getByTestId('captions')
      const cp = screen.getByRole('region', { name: 'Checkpoint' })
      expect(stage.contains(cp)).toBe(true)
      expect(side.contains(cp)).toBe(false)
      expect(captions.compareDocumentPosition(cp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const controls = screen.getByRole('group', { name: 'Lesson controls' })
      expect(cp.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      await user.click(screen.getByLabelText(/constant term 3 minus 1/i))
      await user.click(screen.getByRole('button', { name: 'Check' }))
      const note = screen.getByRole('status')
      expect(stage.contains(note)).toBe(true)
      expect(captions.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    } finally {
      width.mockRestore()
    }
  })

  test('wide: the checkpoint stays in the side panel', async () => {
    const { user } = await startVertex()
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await until(() => lesson()?.phase === 'checkpoint')
    expect(screen.getByRole('complementary', { name: 'Lesson panel' }).contains(screen.getByRole('region', { name: 'Checkpoint' }))).toBe(true)
  })
})
