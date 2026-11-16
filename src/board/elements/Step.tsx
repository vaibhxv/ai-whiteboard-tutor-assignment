import type { Action } from '../../actions'
import { HtmlRoot, Latex } from './shared'
import type { ElProps } from './shared'

export function Step(p: ElProps) {
  const a = p.item.action as Extract<Action, { t: 'step' }>
  return (
    <HtmlRoot {...p} className="el-step">
      <Latex className="math-line" latex={a.latex} />
      <div className="step-why">{a.why}</div>
    </HtmlRoot>
  )
}
