import rough from 'roughjs'

const gen = rough.generator()

/** Stable 32-bit FNV-1a hash of an element id: the rough.js seed, so a sketch never wobbles between renders. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) || 1
}

export type Geom =
  | { x1: number; y1: number; x2: number; y2: number }
  | { x: number; y: number; w: number; h: number }
  | { cx: number; cy: number; w: number; h: number }

const HEAD = 12

/** Sketchy path `d` strings for a shape (rough.js, roughness 1.2, seeded). An arrow runs tail → head. */
export function roughPaths(kind: 'line' | 'rect' | 'ellipse' | 'arrow', geom: Geom, seed: number): string[] {
  const o = { roughness: 1.2, seed }
  const paths = (d: ReturnType<typeof gen.line>) => gen.toPaths(d).map((p) => p.d)
  if (kind === 'rect' && 'x' in geom) return paths(gen.rectangle(geom.x, geom.y, geom.w, geom.h, o))
  if (kind === 'ellipse' && 'cx' in geom) return paths(gen.ellipse(geom.cx, geom.cy, geom.w, geom.h, o))
  if ('x1' in geom) {
    const { x1, y1, x2, y2 } = geom
    const line = paths(gen.line(x1, y1, x2, y2, o))
    if (kind !== 'arrow') return line
    const a = Math.atan2(y2 - y1, x2 - x1)
    const wing = (s: number) =>
      gen.line(x2, y2, x2 - HEAD * Math.cos(a + s * 0.45), y2 - HEAD * Math.sin(a + s * 0.45), { ...o, seed: seed + 1 })
    return [...line, ...paths(wing(1)), ...paths(wing(-1))]
  }
  return []
}
