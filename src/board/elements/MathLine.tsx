import type { Action } from '../../actions'
import { HtmlRoot, Latex } from './shared'
import type { ElProps } from './shared'

/** math and solutions: one KaTeX line. */
export function MathLine(p: ElProps) {
  const a = p.item.action as Extract<Action, { t: 'math' | 'solutions' }>
  return (
    <HtmlRoot {...p} className="el-math">
      <Latex className="math-line" latex={a.latex} />
    </HtmlRoot>
  )
}
