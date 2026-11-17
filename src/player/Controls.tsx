import type { ReactNode } from 'react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'

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
  /** Extra toggles shown at the end of the toolbar (the lesson screen puts the Captions toggle here). */
  children?: ReactNode
}

export function Controls(p: ControlsProps) {
  const showPlay = p.interrupted || p.paused
  return (
    <div className="player-controls" role="group" aria-label="Lesson controls">
      <button type="button" className="icon-btn" aria-label="Back one step" onClick={p.onBack} disabled={p.interrupted}>
        <SkipBack size={18} aria-hidden="true" />
      </button>
      <button
        type="button" className="play-btn" aria-label={showPlay ? 'Play' : 'Pause'} onClick={p.onTogglePlay} disabled={p.interrupted}
        title={p.interrupted ? 'Paused while your hand is up' : undefined}
      >
        {showPlay ? <Play size={20} aria-hidden="true" fill="currentColor" /> : <Pause size={20} aria-hidden="true" fill="currentColor" />}
      </button>
      <button type="button" className="icon-btn" aria-label="Forward one step" onClick={p.onForward} disabled={p.interrupted}>
        <SkipForward size={18} aria-hidden="true" />
      </button>
      <button type="button" className="tool-btn replay-btn" aria-label="Replay this step" onClick={p.onReplay} disabled={p.interrupted}>
        <RotateCcw size={16} aria-hidden="true" /><span className="tool-text">Replay</span>
      </button>
      <div className="speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={p.speed === s} onClick={() => p.onSpeed(s)}>{`${s}×`}</button>
        ))}
      </div>
      <button type="button" className="icon-btn mute-btn" aria-label={p.muted ? 'Unmute' : 'Mute'} onClick={p.onToggleMute}>
        {p.muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
      </button>
      {p.children}
    </div>
  )
}
