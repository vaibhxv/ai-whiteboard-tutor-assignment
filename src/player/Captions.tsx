import { Volume2 } from 'lucide-react'

export function Captions({ say, enabled }: { say: string; enabled: boolean }) {
  if (!enabled) return null
  return (
    <div className="captions" aria-live="polite" aria-atomic="true" data-testid="captions">
      <Volume2 className="captions-icon" size={18} aria-hidden="true" />
      <span className="captions-text">{say}</span>
    </div>
  )
}
