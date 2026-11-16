import { fmtNum } from '../../maths/format'

export function SetIn({ param, value }: { param: string; value?: number }) {
  return (
    <p className="cp-set">
      Move the slider, then press Check. Current: <strong>{param} = {value === undefined ? '?' : fmtNum(value)}</strong>
    </p>
  )
}
