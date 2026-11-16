export function Captions({ say, enabled }: { say: string; enabled: boolean }) {
  if (!enabled) return null
  return (
    <div className="captions" aria-live="polite" aria-atomic="true" data-testid="captions">
      {say}
    </div>
  )
}
