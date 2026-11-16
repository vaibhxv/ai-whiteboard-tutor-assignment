export const BEST_EFFORT = "Outside my checked zone. I can explain and sketch, but I can't verify this the way I verify maths."

/** Shown for the whole of an `adjacent` lesson (FRD A4), recap included. */
export function BestEffortBanner() {
  return (
    <p className="best-effort" role="note">
      <span aria-hidden="true">⚠ </span>
      {BEST_EFFORT}
    </p>
  )
}
