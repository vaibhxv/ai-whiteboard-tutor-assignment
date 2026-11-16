import type { Action } from '../../actions'
import { fmtNum } from '../../maths/format'
import { compile, parseMath } from '../../maths/safe'
import { HtmlRoot } from './shared'
import type { ElProps } from './shared'

/** Empty cells are filled from `fn` (a function of the row's first column, x) when it computes. */
function cellFiller(fn: string | undefined): (row: string[], col: number) => string {
  const parsed = fn ? parseMath(fn) : undefined
  if (!parsed?.ok || parsed.value.kind !== 'expr') return (row, c) => row[c] ?? ''
  const f = compile(parsed.value.node)
  return (row, c) => {
    const cell = row[c] ?? ''
    if (cell !== '' || c === 0) return cell
    const v = f({ x: Number(row[0]) })
    return Number.isFinite(v) ? fmtNum(v) : ''
  }
}

export function Table(p: ElProps) {
  const a = p.item.action as Extract<Action, { t: 'table' }>
  const cell = cellFiller(a.fn)
  return (
    <HtmlRoot {...p} className="el-table">
      <table className="board-table">
        <thead>
          <tr>{a.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {a.rows.map((r, ri) => (
            <tr key={ri}>{a.head.map((_, ci) => <td key={ci}>{cell(r, ci)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </HtmlRoot>
  )
}
