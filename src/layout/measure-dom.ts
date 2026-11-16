import type { Action } from '../actions'
import { renderLatex } from '../board/elements/shared-latex'
import type { Measurer } from './types'

/**
 * Measures real DOM sizes for the layout engine: renders each action into a hidden `aria-hidden`
 * container under `root`, using the same CSS classes as the Board (Playpen Sans 26 px for `write`,
 * KaTeX for `math`/`step`/`solutions`, the table markup), then reads its box. Results are cached by
 * `t + content + maxWidth`. In jsdom (no layout) every size is 0; use a fake Measurer in tests.
 * Call after fonts have loaded, or sizes will be those of the fallback font.
 */
export function createDomMeasurer(root: HTMLElement): Measurer {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.className = 'board-measure'
  host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;'
  root.appendChild(host)
  const cache = new Map<string, { w: number; h: number }>()

  const content = (a: Action): HTMLElement | null => {
    const el = document.createElement('div')
    const child = (cls: string, text?: string): HTMLElement => {
      const c = document.createElement('div')
      c.className = cls
      if (text !== undefined) c.textContent = text
      el.appendChild(c)
      return c
    }
    const math = (latex: string) => {
      const m = document.createElement('span')
      m.className = 'math-line'
      m.innerHTML = renderLatex(latex) // KaTeX output only (trust: false, escapes its input)
      el.appendChild(m)
    }
    switch (a.t) {
      case 'write':
        el.className = `el el-write role-${a.role ?? 'line'}`
        child('write-text', a.text)
        return el
      case 'math':
      case 'solutions':
        el.className = 'el el-math'
        math(a.latex)
        return el
      case 'step':
        el.className = 'el el-step'
        math(a.latex)
        child('step-why', a.why)
        return el
      case 'table': {
        el.className = 'el el-table'
        const table = document.createElement('table')
        table.className = 'board-table'
        for (const [ri, row] of [a.head, ...a.rows].entries()) {
          const tr = table.insertRow()
          for (let c = 0; c < a.head.length; c++) {
            const cell = document.createElement(ri === 0 ? 'th' : 'td')
            cell.textContent = row[c] ?? ''
            tr.appendChild(cell)
          }
        }
        el.appendChild(table)
        return el
      }
      default: return null
    }
  }

  return {
    measure(a, maxWidth) {
      if (a.t === 'numberline') return { w: maxWidth, h: 80 }
      const key = `${a.t}|${JSON.stringify(a)}|${maxWidth}`
      const hit = cache.get(key)
      if (hit) return hit
      const el = content(a)
      let size = { w: Math.min(200, maxWidth), h: 48 }
      if (el) {
        el.style.position = 'static'
        el.style.width = 'max-content'
        el.style.maxWidth = `${maxWidth}px`
        host.appendChild(el)
        const r = el.getBoundingClientRect()
        size = { w: Math.min(maxWidth, Math.ceil(r.width) + 1), h: Math.ceil(r.height) }
        host.removeChild(el)
      }
      cache.set(key, size)
      return size
    },
  }
}

/**
 * Loads Playpen Sans and the KaTeX faces before measuring (they are web fonts, so a measure taken
 * first would use fallback metrics and the Board would then wrap differently). Await once at startup.
 */
export async function warmMeasureFonts(): Promise<void> {
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;left:-99999px;visibility:hidden;'
  const w = document.createElement('div')
  w.className = 'el el-write'
  w.textContent = 'Hello'
  const m = document.createElement('div')
  m.className = 'el el-math'
  m.innerHTML = renderLatex('y = x^2 - \\frac{1}{2}\\sqrt{x} \\quad \\text{or}') // KaTeX output only
  probe.append(w, m)
  document.body.appendChild(probe)
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  await document.fonts.ready
  probe.remove()
}
