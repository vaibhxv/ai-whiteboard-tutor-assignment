import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { CheckAction } from '../../../src/actions'
import { Checkpoint } from '../../../src/checkpoint/Checkpoint'
import type { CheckpointProps } from '../../../src/checkpoint/Checkpoint'
import { selfRatingCheck } from '../../../src/checkpoint/grade-check'
import { ExploreControls } from '../../../src/board/elements/Explore'

const base = { t: 'check', id: 'c1', prompt: 'Pick it', explain: 'Because.', hint: 'Think about signs.' } as const
const choice: CheckAction = {
  ...base, kind: 'choice',
  options: [{ id: 'a', text: 'Alpha', correct: true }, { id: 'b', text: 'Beta', correct: false, misconception: 'm' }],
}
const num: CheckAction = { ...base, kind: 'number', answer: '2', anticipated: [{ value: '-2', misconception: 'sign' }] }
const expr: CheckAction = { ...base, kind: 'expr', answer: '2x+2', variable: 'x' }

const setup = (check: CheckAction, over: Partial<CheckpointProps> = {}) => {
  const f = { onAnswer: vi.fn(), onUnsure: vi.fn(), onSkip: vi.fn(), onReplaySegment: vi.fn(), onContinue: vi.fn() }
  render(<Checkpoint check={check} {...f} {...over} />)
  return f
}

describe('Checkpoint', () => {
  test('choice wrong first time shows Not quite and marks no correct option', async () => {
    const u = userEvent.setup()
    const f = setup(choice)
    await u.click(screen.getByLabelText('Beta'))
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByRole('status').textContent).toBe("Not quite. Let's look at it another way.")
    expect(screen.getByRole('status').querySelector('svg[aria-hidden="true"]')).not.toBeNull() // icon + words, never colour alone
    expect(f.onAnswer).toHaveBeenCalledWith({ result: 'wrong', branch: 'b', misconception: 'm' })
    expect(document.body.textContent).not.toMatch(/Because|Correct/)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  test('second wrong uses the work-through copy', async () => {
    const u = userEvent.setup()
    setup(num, { record: { id: 'c1', attempts: 2, branches: [], unsure: 0 } })
    await u.type(screen.getByLabelText('Your answer'), '9')
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByRole('status').textContent).toBe("Let's work through it together.")
  })

  test('correct shows explain and Continue', async () => {
    const u = userEvent.setup()
    const f = setup(num)
    await u.type(screen.getByLabelText('Your answer'), '2')
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByRole('status').textContent).toBe('Correct — Because.')
    expect(screen.getByRole('status').querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    await u.click(screen.getByRole('button', { name: 'Continue' }))
    expect(f.onContinue).toHaveBeenCalledOnce()
  })

  test("I'm not sure shows the hint and does not call onAnswer", async () => {
    const u = userEvent.setup()
    const f = setup(choice)
    await u.click(screen.getByRole('button', { name: "I'm not sure" }))
    expect(screen.getByText(/Think about signs/)).toBeTruthy()
    expect(f.onUnsure).toHaveBeenCalledOnce()
    expect(f.onAnswer).not.toHaveBeenCalled()
  })

  test('replay and skip callbacks', async () => {
    const u = userEvent.setup()
    const f = setup(choice)
    await u.click(screen.getByRole('button', { name: 'Replay this part' }))
    await u.click(screen.getByRole('button', { name: 'Skip' }))
    expect(f.onReplaySegment).toHaveBeenCalledOnce()
    expect(f.onSkip).toHaveBeenCalledOnce()
  })

  test('rapid double click on Check calls onAnswer once', () => {
    const f = setup(num)
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '5' } })
    const b = screen.getByRole('button', { name: 'Check' })
    fireEvent.click(b)
    fireEvent.click(b)
    expect(f.onAnswer).toHaveBeenCalledOnce()
  })

  test('invalid expression shows the message and does not call onAnswer', async () => {
    const u = userEvent.setup()
    const f = setup(expr)
    await u.type(screen.getByLabelText('Your answer, in x'), '2x+*')
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByRole('status').textContent).toMatch(/couldn.t read that/)
    expect(f.onAnswer).not.toHaveBeenCalled()
    // can retry with a fixed answer
    await u.clear(screen.getByLabelText('Your answer, in x'))
    await u.type(screen.getByLabelText('Your answer, in x'), '2(x+1)')
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(f.onAnswer).toHaveBeenCalledWith({ result: 'correct', branch: 'correct' })
  })

  test('tap: Check disabled until something is selected in the figure', async () => {
    const u = userEvent.setup()
    const t: CheckAction = { ...base, kind: 'tap', figure: 'f', answer: 'v' }
    const f = setup(t)
    expect(screen.getByText(/Select the right element on the graph, then press Check\./)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true)
    expect(f.onAnswer).not.toHaveBeenCalled()
    void u
  })

  test('tap: selected element is graded', async () => {
    const u = userEvent.setup()
    const t: CheckAction = { ...base, kind: 'tap', figure: 'f', answer: 'v' }
    const f = setup(t, { selectedInFigure: 'v' })
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(f.onAnswer).toHaveBeenCalledWith({ result: 'correct', branch: 'correct' })
  })

  test('set: grades the parameter value', async () => {
    const u = userEvent.setup()
    const s: CheckAction = { ...base, kind: 'set', explore: 'e', param: 'a', target: [1, 2] }
    const f = setup(s, { paramValue: 3 })
    expect(screen.getByText('a = 3')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(f.onAnswer).toHaveBeenCalledWith({ result: 'wrong', branch: 'other' })
  })

  test('self rating: three buttons, no grading copy', async () => {
    const u = userEvent.setup()
    const f = setup(selfRatingCheck('s'))
    expect(screen.getByText('Did that make sense?')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Sort of' }))
    expect(f.onAnswer).toHaveBeenCalledWith({ result: 'correct', branch: 'sort-of' })
    expect(screen.getByRole('status').textContent).toBe('Thanks — that helps me pace the next part.')
    expect(document.body.textContent).not.toMatch(/Correct/)
  })

  test('choice: B wrong, then A, then B again can be checked again', async () => {
    const u = userEvent.setup()
    const f = setup(choice)
    const check = () => u.click(screen.getByRole('button', { name: 'Check' }))
    await u.click(screen.getByLabelText('Beta')); await check()
    await u.click(screen.getByLabelText('Alpha'))
    await u.click(screen.getByLabelText('Beta'))
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(false)
    await check()
    expect(f.onAnswer).toHaveBeenCalledTimes(2)
  })

  test('number: 9, then 10, then 9 again can be checked again; unchanged resubmit is blocked', async () => {
    const u = userEvent.setup()
    const f = setup(num)
    const box = screen.getByLabelText('Your answer')
    const check = () => u.click(screen.getByRole('button', { name: 'Check' }))
    await u.type(box, '9'); await check()
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true)
    await u.clear(box); await u.type(box, '10')
    await u.clear(box); await u.type(box, '9'); await check()
    expect(f.onAnswer).toHaveBeenCalledTimes(2)
  })

  test('empty number input tells the learner what to do', () => {
    setup(num)
    expect(screen.getByText('Type your answer first')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('number input allows a minus sign on mobile keyboards', () => {
    setup(num)
    expect(screen.getByLabelText('Your answer').getAttribute('inputmode')).toBe('text')
  })

  test('feedback region receives focus after submit', async () => {
    const u = userEvent.setup()
    setup(num)
    await u.type(screen.getByLabelText('Your answer'), '2')
    await u.click(screen.getByRole('button', { name: 'Check' }))
    expect(document.activeElement).toBe(screen.getByRole('status'))
  })
})

describe('Explore slider', () => {
  const a = { t: 'explore', id: 'e', x: [-5, 5], y: [-5, 5], expr: 'a*x', prompt: 'Try', params: [{ name: 'a', min: 0, max: 10, start: 2 }], verify: { status: 'unchecked' } }
  const item = { id: 'e', action: a, box: { x: 0, y: 0, w: 400, h: 300 }, beatId: 'b', actionIndex: 0, region: 'main', ink: 'lesson' } as never
  const el = (v: number) => <ExploreControls item={item} index={new Map()} selected={false} onSelect={() => {}} label="x" values={{ a: v }} onParam={() => {}} />

  test('accessible name is the param name; aria-valuetext carries the value', () => {
    render(el(2))
    const s = screen.getByRole('slider', { name: 'a' })
    expect(s.getAttribute('aria-valuetext')).toBe('a = 2')
  })

  test('arrow, Home/End and Page keys do not reach global handlers; other keys do', () => {
    render(el(2))
    const seen: string[] = []
    const h = (e: KeyboardEvent) => seen.push(e.key)
    window.addEventListener('keydown', h)
    const s = screen.getByRole('slider')
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) fireEvent.keyDown(s, { key })
    expect(seen).toEqual([])
    fireEvent.keyDown(s, { key: 'm' })
    expect(seen).toEqual(['m'])
    window.removeEventListener('keydown', h)
  })

  test('does not hijack native handling (no preventDefault)', () => {
    render(el(2))
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    screen.getByRole('slider').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
})
