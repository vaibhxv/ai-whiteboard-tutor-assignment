import type { Action } from '../../actions'
import { HtmlRoot } from './shared'
import type { ElProps } from './shared'

export function Write(p: ElProps) {
  const a = p.item.action as Extract<Action, { t: 'write' }>
  return (
    <HtmlRoot {...p} className={`el-write role-${a.role ?? 'line'}`}>
      <div className="write-text">{a.text}</div>
    </HtmlRoot>
  )
}
