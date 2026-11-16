import { useEffect, useRef } from 'react'
import type { WarmupRecord } from '../actions'

/** The warm-up guess (FRD B2): asked before any teaching and never graded. */
export function WarmUp({ record, onAnswer, onSkip }: { record: WarmupRecord; onAnswer(optionId: string): void; onSkip(): void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [record.id])
  return (
    <section className="warmup card" aria-labelledby="warmup-h">
      <h3 id="warmup-h" ref={heading} tabIndex={-1}>Warm-up</h3>
      <p className="warmup-prompt">{`Before I explain: ${record.prompt} Guess — we'll find out.`}</p>
      <div className="warmup-options" role="group" aria-label="Your guess">
        {record.options.map((o) => (
          <button key={o.id} type="button" className="option-button" onClick={() => onAnswer(o.id)}>{o.text}</button>
        ))}
      </div>
      <button type="button" className="link" onClick={onSkip}>Skip</button>
    </section>
  )
}
