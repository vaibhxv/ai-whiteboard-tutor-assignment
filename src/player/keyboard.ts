export type KeyHandlers = {
  togglePlay(): void
  back(): void
  forward(): void
  replay(): void
  toggleMute(): void
  raiseHand(): void
}

const OWN_KEYS = 'input, textarea, select, button, [role="button"], [contenteditable]:not([contenteditable="false"])'

/** Binds the player keys on `target`; returns the unbind function. */
export function bindKeys(target: Window, h: KeyHandlers): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target
    if (t instanceof Element && t.closest(OWN_KEYS)) return
    let fn: (() => void) | undefined
    switch (e.key) {
      case ' ': fn = h.togglePlay; break
      case 'ArrowLeft': fn = h.back; break
      case 'ArrowRight': fn = h.forward; break
      case 'r': case 'R': fn = h.replay; break
      case 'm': case 'M': fn = h.toggleMute; break
      case '/': fn = h.raiseHand; break
    }
    if (!fn) return
    e.preventDefault()
    fn()
  }
  target.addEventListener('keydown', onKey)
  return () => target.removeEventListener('keydown', onKey)
}
