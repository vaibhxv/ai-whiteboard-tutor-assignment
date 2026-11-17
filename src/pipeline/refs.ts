import type { Action } from '../actions'

export type RefResult = { ok: true } | { ok: false; reason: string }

const bad = (reason: string): RefResult => ({ ok: false, reason })

function fnIds(a: Action | undefined): string[] {
  return a && a.t === 'plot' ? a.fns.map((f) => f.id) : []
}

export function checkRefs(
  a: Action,
  index: ReadonlyMap<string, Action>,
  local: ReadonlySet<string>,
): RefResult {
  const taken = (id: string): boolean => {
    if (index.has(id) || local.has(id)) return true
    for (const v of index.values()) if (fnIds(v).includes(id)) return true
    return false
  }
  if ('id' in a && typeof a.id === 'string' && taken(a.id)) return bad(`duplicate id ${a.id}`)
  if (a.t === 'plot') {
    const seen = new Set<string>([a.id])
    for (const f of a.fns) {
      if (seen.has(f.id) || taken(f.id)) return bad(`duplicate id ${f.id}`)
      seen.add(f.id)
    }
  }
  const exists = (id: string) => index.has(id) || local.has(id)
  const plotOf = (id: string): Action | undefined => {
    const p = index.get(id)
    return p && p.t === 'plot' ? p : undefined
  }
  switch (a.t) {
    case 'mark':
      // A mark may name a plot's curve (a fn id) as well as an element id.
      if (!exists(a.target) && !taken(a.target)) return bad(`unknown target ${a.target}`)
      break
    case 'point': {
      const p = plotOf(a.plot)
      if (!p) return bad(`unknown plot ${a.plot}`)
      if (a.on !== undefined && !fnIds(p).includes(a.on)) return bad(`unknown fn ${a.on} on plot ${a.plot}`)
      break
    }
    case 'line':
    case 'guide':
      if (!plotOf(a.plot)) return bad(`unknown plot ${a.plot}`)
      break
    case 'step':
      if (a.from !== undefined && !exists(a.from)) return bad(`unknown from ${a.from}`)
      break
    case 'solutions':
      if (!exists(a.of)) return bad(`unknown of ${a.of}`)
      break
    case 'check':
      if (a.kind === 'tap') {
        const fig = index.get(a.figure)
        if (!fig) return bad(`unknown figure ${a.figure}`)
        if (fig.t !== 'plot' && fig.t !== 'explore') return bad(`tap figure ${a.figure} is not a plot`)
        const ans = index.get(a.answer)
        const onFigure = fnIds(fig).includes(a.answer) ||
          (ans !== undefined && 'plot' in ans && ans.plot === a.figure)
        if (!onFigure) return bad(`tap answer ${a.answer} is not on figure ${a.figure}`)
      } else if (a.kind === 'set') {
        const e = index.get(a.explore)
        if (!e || e.t !== 'explore') return bad(`unknown explore ${a.explore}`)
      }
      break
    default:
      break
  }
  return { ok: true }
}
