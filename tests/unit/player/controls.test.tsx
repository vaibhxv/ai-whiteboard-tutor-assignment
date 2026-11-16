import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { createRef } from 'react'
import { createLessonStore } from '../../../src/lesson/store'
import type { LessonEvent } from '../../../src/lesson/events'
import { Captions } from '../../../src/player/Captions'
import { Controls } from '../../../src/player/Controls'
import { bindKeys } from '../../../src/player/keyboard'
import { Transcript } from '../../../src/player/Transcript'
import { usePlayer } from '../../../src/player/usePlayer'
import { timeBeat } from '../../../src/player/durations'
import { fake, beat, w } from '../layout/fake'
import { fill, segPlan, start } from '../lesson/helpers'
import { fakeClock, fakeSpeech, flush } from './helpers'

const handlers = () => ({
  togglePlay: vi.fn(), back: vi.fn(), forward: vi.fn(), replay: vi.fn(), toggleMute: vi.fn(), raiseHand: vi.fn(),
})

describe('bindKeys', () => {
  test('Space toggles, arrows, R, M, / dispatch; unbind stops', () => {
    const h = handlers()
    const off = bindKeys(window, h)
    fireEvent.keyDown(document.body, { key: ' ' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'r' })
    fireEvent.keyDown(document.body, { key: 'M' })
    fireEvent.keyDown(document.body, { key: '/' })
    expect(h.togglePlay).toHaveBeenCalledTimes(1)
    expect(h.back).toHaveBeenCalledTimes(1)
    expect(h.forward).toHaveBeenCalledTimes(1)
    expect(h.replay).toHaveBeenCalledTimes(1)
    expect(h.toggleMute).toHaveBeenCalledTimes(1)
    expect(h.raiseHand).toHaveBeenCalledTimes(1)
    off()
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(h.togglePlay).toHaveBeenCalledTimes(1)
  })

  test('ignored inside input, textarea, select, contenteditable, and buttons', () => {
    const h = handlers()
    const off = bindKeys(window, h)
    render(
      <div>
        <input aria-label="i" /><textarea aria-label="t" /><select aria-label="s"><option>a</option></select>
        <div contentEditable suppressContentEditableWarning data-testid="ce">x</div>
        <button>b</button><span role="button" tabIndex={0}>rb</span>
      </div>,
    )
    for (const el of [screen.getByLabelText('i'), screen.getByLabelText('t'), screen.getByLabelText('s'), screen.getByTestId('ce'), screen.getByText('b'), screen.getByText('rb')]) {
      fireEvent.keyDown(el, { key: ' ' })
      fireEvent.keyDown(el, { key: '/' })
      fireEvent.keyDown(el, { key: 'r' })
    }
    expect(h.togglePlay).not.toHaveBeenCalled()
    expect(h.raiseHand).not.toHaveBeenCalled()
    expect(h.replay).not.toHaveBeenCalled()
    off()
  })
})

describe('Controls', () => {
  test('accessible names and callbacks', async () => {
    const h = { onTogglePlay: vi.fn(), onBack: vi.fn(), onForward: vi.fn(), onReplay: vi.fn(), onSpeed: vi.fn(), onToggleMute: vi.fn() }
    const { rerender } = render(<Controls paused={false} muted={false} speed={1} {...h} />)
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back one step' }))
    await userEvent.click(screen.getByRole('button', { name: 'Forward one step' }))
    await userEvent.click(screen.getByRole('button', { name: 'Replay this step' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Speed' }), '1.5')
    expect(h.onTogglePlay).toHaveBeenCalled()
    expect(h.onBack).toHaveBeenCalled()
    expect(h.onForward).toHaveBeenCalled()
    expect(h.onReplay).toHaveBeenCalled()
    expect(h.onToggleMute).toHaveBeenCalled()
    expect(h.onSpeed).toHaveBeenCalledWith(1.5)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['0.75×', '1×', '1.25×', '1.5×'])
    rerender(<Controls paused muted speed={1} {...h} />)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
  })
})

describe('Captions', () => {
  test('announces each new say in an aria-live region; hidden when off', () => {
    const { rerender } = render(<Captions say="First line" enabled />)
    const region = screen.getByText('First line')
    expect(region.closest('[aria-live="polite"]')).not.toBeNull()
    rerender(<Captions say="Second line" enabled />)
    expect(screen.getByText('Second line').closest('[aria-live="polite"]')).not.toBeNull()
    rerender(<Captions say="Second line" enabled={false} />)
    expect(screen.queryByText('Second line')).toBeNull()
  })
})

describe('Transcript', () => {
  test('lists each say with text alternatives of its actions', () => {
    const beats = [beat('s#0', [w('a', 'Hello board')], 'Let us begin'), beat('s#1', [w('b', 'More')], '')]
    render(<Transcript beats={beats} index={new Map()} />)
    expect(screen.getByText('Transcript')).toBeInTheDocument()
    expect(screen.getByText('Let us begin')).toBeInTheDocument()
    expect(screen.getByText('Hello board')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
  })
})

function setupPlayer(extra: LessonEvent[] = fill('seg:1', 2, 'c1')) {
  const store = createLessonStore()
  for (const e of [start, { type: 'plan/record', record: segPlan(1) } as LessonEvent, { type: 'plan/done' } as LessonEvent, ...extra]) store.getState().dispatch(e)
  const clock = fakeClock()
  const speech = fakeSpeech()
  const measureRoot = createRef<HTMLElement>()
  const hook = renderHook(() => usePlayer(store, { measureRoot, measurer: fake, clock, speech, viewport: 'wide', keys: false }))
  return { store, clock, speech, hook }
}

describe('usePlayer', () => {
  test('plays the cursor beat, advances on beat end, and stops at the checkpoint', async () => {
    const { store, clock, speech, hook } = setupPlayer()
    expect(store.getState().state!.cursor.beat).toBe(0)
    expect(hook.result.current.currentSay).toBe('beat 0')
    expect(hook.result.current.animating?.beatId).toBe('seg:1#0')
    expect(speech.spoken[0]!.text).toBe('beat 0')
    const b = store.getState().state!.segments['seg:1']!.beats[0]!
    await act(async () => { speech.spoken[0]!.finish(); clock.tick(timeBeat(b, 1).total); await flush() })
    expect(store.getState().state!.cursor.beat).toBe(1)
    expect(hook.result.current.currentSay).toBe('beat 1')
    await act(async () => { speech.spoken[1]!.finish(); clock.tick(10_000); await flush() })
    expect(store.getState().state!.phase).toBe('checkpoint')
    expect(hook.result.current.animating).toBeUndefined()
  })

  test('pause stops speech immediately; resume replays the beat (new playToken)', async () => {
    const { clock, speech, hook } = setupPlayer()
    const token = hook.result.current.playToken
    act(() => hook.result.current.togglePlay())
    expect(hook.result.current.paused).toBe(true)
    expect(speech.spoken[0]!.cancelled).toBe(true)
    act(() => hook.result.current.togglePlay())
    expect(hook.result.current.paused).toBe(false)
    expect(hook.result.current.playToken).toBeGreaterThan(token)
    expect(speech.spoken).toHaveLength(2)
    expect(clock.pending()).toBeGreaterThan(0)
  })

  test('mute cancels the current utterance; the beat completes on the timer', async () => {
    const { store, clock, speech, hook } = setupPlayer()
    act(() => hook.result.current.toggleMute())
    expect(hook.result.current.muted).toBe(true)
    expect(speech.spoken[0]!.cancelled).toBe(true)
    const b = store.getState().state!.segments['seg:1']!.beats[0]!
    await act(async () => { clock.tick(timeBeat(b, 1).total); await flush() })
    expect(store.getState().state!.cursor.beat).toBe(1)
  })

  test('forward/back seek within the segment; forward past the last beat is a no-op', () => {
    const { store, hook } = setupPlayer()
    act(() => hook.result.current.forward())
    expect(store.getState().state!.cursor.beat).toBe(1)
    act(() => hook.result.current.forward())
    expect(store.getState().state!.cursor.beat).toBe(1)
    act(() => hook.result.current.back())
    expect(store.getState().state!.cursor.beat).toBe(0)
  })

  test('waiting while the next beat has not streamed; advances when the segment completes at its end', async () => {
    const { store, clock, speech, hook } = setupPlayer([
      { type: 'seg/stream', key: 'seg:1' },
      { type: 'seg/beat', key: 'seg:1', beat: beat0() },
    ])
    expect(hook.result.current.waiting).toBe(false)
    await act(async () => { speech.spoken[0]!.finish(); clock.tick(10_000); await flush() })
    expect(store.getState().state!.cursor.beat).toBe(1)
    expect(hook.result.current.waiting).toBe(true)
    expect(hook.result.current.animating).toBeUndefined()
    act(() => {
      store.getState().dispatch({ type: 'seg/done', key: 'seg:1', summary: { accepted: 1, rejected: 0, failed: [], hasCheck: false, truncated: false } })
    })
    expect(store.getState().state!.phase).not.toBe('teaching') // stalledAtEnd re-dispatched player/advance
    expect(hook.result.current.waiting).toBe(false)
  })

  test('/ raises the hand: stops speech, opens overlay, not a user pause', () => {
    const { store, speech, hook } = setupPlayer()
    act(() => hook.result.current.raiseHand())
    expect(hook.result.current.paused).toBe(false)
    expect(speech.spoken[0]!.cancelled).toBe(true)
    expect(store.getState().state!.overlay).not.toBeNull()
  })

  test('page shown is the one containing the current beat', () => {
    const { hook } = setupPlayer()
    expect(hook.result.current.pages.length).toBeGreaterThan(0)
    expect(hook.result.current.pageIndex).toBe(0)
  })
})

function beat0() {
  return beat('seg:1#0', [w('z0')], 'beat 0')
}

describe('usePlayer fix round 1', () => {
  test('raise hand: speech cancelled synchronously, answer beats auto-play and advance, close replays lesson beat', async () => {
    const { store, clock, speech, hook } = setupPlayer()
    act(() => hook.result.current.raiseHand())
    expect(speech.spoken[0]!.cancelled).toBe(true)
    expect(hook.result.current.paused).toBe(false)
    const d = (e: LessonEvent) => act(() => store.getState().dispatch(e))
    d({ type: 'interrupt/ask', threadId: 't1', question: 'why?', targets: [] })
    d({ type: 'thread/stream', threadId: 't1' })
    d({ type: 'thread/beat', threadId: 't1', beat: beat('t1#0', [w('q0')], 'answer one') })
    d({ type: 'thread/beat', threadId: 't1', beat: beat('t1#1', [w('q1')], 'answer two') })
    expect(hook.result.current.track).toBe('answer')
    expect(speech.spoken.at(-1)!.text).toBe('answer one')
    await act(async () => { speech.spoken.at(-1)!.finish(); clock.tick(10_000); await flush() })
    const pb = store.getState().state!.playback
    expect(pb.track === 'answer' && pb.beat).toBe(1)
    expect(speech.spoken.at(-1)!.text).toBe('answer two')
    d({ type: 'interrupt/close', outcome: 'clear' })
    expect(hook.result.current.track).toBe('lesson')
    expect(speech.spoken.at(-1)!.text).toBe('beat 0')
    expect(store.getState().state!.cursor.beat).toBe(0)
  })

  test('speed change mid-beat applies from the next beat; animating timing frozen', async () => {
    const { store, clock, speech, hook } = setupPlayer()
    const t0 = hook.result.current.animating!.timing
    act(() => hook.result.current.setSpeed(1.5))
    expect(hook.result.current.animating!.timing).toEqual(t0)
    await act(async () => { speech.spoken[0]!.finish(); clock.tick(10_000); await flush() })
    expect(store.getState().state!.cursor.beat).toBe(1)
    expect(speech.spoken[1]!.rate).toBe(1.5)
    const b = store.getState().state!.segments['seg:1']!.beats[1]!
    expect(hook.result.current.animating!.timing).toEqual(timeBeat(b, 1.5))
  })

  test('stalled end dispatches advance once per stall', () => {
    const { store, hook } = setupPlayer([{ type: 'seg/stream', key: 'seg:1' }, { type: 'seg/beat', key: 'seg:1', beat: beat0() }])
    const spy = vi.spyOn(store.getState(), 'dispatch')
    hook.rerender()
    expect(spy).not.toHaveBeenCalled()
  })
})
