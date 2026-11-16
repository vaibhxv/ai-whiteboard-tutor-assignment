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
}

export function Controls(p: ControlsProps) {
  return (
    <div className="player-controls" role="group" aria-label="Lesson controls">
      <button type="button" onClick={p.onBack}>Back one step</button>
      <button type="button" onClick={p.onTogglePlay}>{p.paused ? 'Play' : 'Pause'}</button>
      <button type="button" onClick={p.onForward}>Forward one step</button>
      <button type="button" onClick={p.onReplay}>Replay this step</button>
      <select aria-label="Speed" value={String(p.speed)} onChange={(e) => p.onSpeed(Number(e.target.value))}>
        {SPEEDS.map((s) => <option key={s} value={String(s)}>{`${s}×`}</option>)}
      </select>
      <button type="button" onClick={p.onToggleMute}>{p.muted ? 'Unmute' : 'Mute'}</button>
    </div>
  )
}
