import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { lesson, playToRecap, setup, startVertex, teardown } from './helpers'

vi.mock('../../../src/recordings/manifest', async () => ({ manifest: (await import('./manifest')).MANIFEST }))

beforeEach(setup)
afterEach(teardown)

describe('Recap and practice', () => {
  test('recap lists the ideas and revisits the warm-up guess', async () => {
    const { user } = await startVertex()
    await playToRecap(user) // guessed "4"
    expect(screen.getByRole('button', { name: /vertex sits halfway between the roots/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /height of the vertex is the minimum value/i })).toBeInTheDocument()
    expect(screen.getByText('Earlier you guessed: 4.')).toBeInTheDocument()
    expect(screen.getByText('Let us try a few on your own.')).toBeInTheDocument()
    expect(screen.getByText('The answer: 2')).toBeInTheDocument()
  })

  test('recap idea click opens the page of that segment', async () => {
    const { user } = await startVertex()
    await playToRecap(user)
    await user.click(screen.getByRole('button', { name: /height of the vertex is the minimum value/i }))
    const review = screen.getByRole('region', { name: /review: completing the picture/i })
    expect(review.querySelector('[data-el="minv"]')).not.toBeNull()
    expect(review.querySelector('[data-el="eq1"]')).toBeNull()
    expect(lesson()?.phase).toBe('recap')
    await user.click(screen.getByRole('button', { name: 'Back to lesson' }))
    expect(screen.getByRole('heading', { name: 'Recap' })).toBeInTheDocument()
  })

  test('practice: one question at a time; the end shows Solid/Shaky per idea with no percentage', async () => {
    const { user, container } = await startVertex()
    await playToRecap(user)
    await user.click(screen.getByRole('button', { name: 'Practice' }))
    // rp1 (idea i1): correct
    expect(screen.getAllByRole('region', { name: 'Checkpoint' })).toHaveLength(1)
    await user.click(screen.getByLabelText('4'))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText(/Correct —/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next question' }))
    // rp2 (idea i1): correct
    await user.type(screen.getByLabelText('Your answer'), '4')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await user.click(screen.getByRole('button', { name: 'Next question' }))
    // rp3 (idea i2): skipped
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(lesson()?.phase).toBe('done')
    const results = screen.getByRole('list', { name: 'How each idea went' })
    const items = within(results).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(/✓\s*Solid/)
    expect(items[0]).toHaveTextContent(/vertex sits halfway/)
    expect(items[1]).toHaveTextContent(/↻\s*Shaky/)
    expect(container.textContent).not.toMatch(/%/)
    await user.click(screen.getByRole('button', { name: 'Start another lesson' }))
    expect(screen.getByLabelText('What are you stuck on?')).toBeInTheDocument()
  })

  test('a wrong practice answer is recorded and the next question follows', async () => {
    const { user } = await startVertex()
    await playToRecap(user)
    await user.click(screen.getByRole('button', { name: 'Practice' }))
    await user.click(screen.getByLabelText('8'))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText(/Not quite/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull() // one try, no help
    await user.click(screen.getByRole('button', { name: 'Next question' }))
    expect(lesson()?.practice.rp1).toEqual({ result: 'wrong' })
    expect(screen.getByText(/roots at 0 and 8/)).toBeInTheDocument()
  })
})
