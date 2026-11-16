export type StopReason = 'end' | 'length' | 'aborted'

export const MAX_LINE = 2000

function keep(raw: string): string | null {
  const line = raw.trim()
  if (line === '' || line.length > MAX_LINE) return null
  return line.startsWith('{') ? line : null
}

/** Assembles streamed text chunks into candidate JSONL lines. Works on strings only. */
export function createLineAssembler(): {
  push(chunk: string): string[]
  end(stop: StopReason): string[]
} {
  let buf = ''
  return {
    push(chunk) {
      buf += chunk
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      const out: string[] = []
      for (const p of parts) {
        const l = keep(p)
        if (l !== null) out.push(l)
      }
      return out
    },
    end(stop) {
      const rest = buf
      buf = ''
      if (stop !== 'end') return []
      const l = keep(rest)
      return l === null ? [] : [l]
    },
  }
}
