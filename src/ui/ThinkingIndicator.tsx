/** "Thinking…" with Cancel while the tutor waits for the model (FRD M3). Not a live region: captions own that. */
export function ThinkingIndicator({ onCancel, detail }: { onCancel(): void; detail?: string }) {
  return (
    <div className="thinking">
      <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="thinking-text">Thinking…</span>
      {detail ? <span className="thinking-detail">{detail}</span> : null}
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  )
}
