export const SPEEDS = [0.75, 1, 1.25, 1.5] as const

export type ControlsProps = {
  paused: boolean
  muted: boolean
  speed: number
  onTogglePlay(): void
  onBack(): void
  onForward(): void
  onReplay(): void
  onSpeed(s: number): void
  onToggleMute(): void
  /** A raised hand stops the lesson track: Play and the step buttons are disabled until it is lowered. */
  interrupted?: boolean
}

export function Controls(p: ControlsProps) {
  return (
    <div className="player-controls" role="group" aria-label="Lesson controls">
      <button type="button" onClick={p.onBack} disabled={p.interrupted}>Back one step</button>
      <button
        type="button" onClick={p.onTogglePlay} disabled={p.interrupted}
        title={p.interrupted ? 'Paused while your hand is up' : undefined}
      >
        {p.interrupted || p.paused ? 'Play' : 'Pause'}
      </button>
      <button type="button" onClick={p.onForward} disabled={p.interrupted}>Forward one step</button>
      <button type="button" onClick={p.onReplay} disabled={p.interrupted}>Replay this step</button>
      <select aria-label="Speed" value={String(p.speed)} onChange={(e) => p.onSpeed(Number(e.target.value))}>
        {SPEEDS.map((s) => <option key={s} value={String(s)}>{`${s}×`}</option>)}
      </select>
      <button type="button" onClick={p.onToggleMute}>{p.muted ? 'Unmute' : 'Mute'}</button>
    </div>
  )
}
