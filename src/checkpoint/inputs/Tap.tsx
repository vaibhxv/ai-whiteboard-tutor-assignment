export function Tap({ selected }: { selected?: string }) {
  return (
    <p className="cp-tap">
      Select the right element on the graph, then press Check.
      {selected ? <span className="cp-tap-sel"> Selected: {selected}</span> : null}
    </p>
  )
}
