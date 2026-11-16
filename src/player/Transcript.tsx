import type { Action } from '../actions'
import { describeAction } from '../board/describe'
import type { Beat } from '../pipeline/beats'

export function Transcript({ beats, index }: { beats: Beat[]; index: ReadonlyMap<string, Action> }) {
  return (
    <details className="transcript">
      <summary>Transcript</summary>
      <ol>
        {beats.map((b) => (
          <li key={b.id}>
            {b.say && <p>{b.say}</p>}
            {b.actions.length > 0 && (
              <ul>
                {b.actions.map((a, i) => <li key={i}>{describeAction(a as Action, index)}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}
