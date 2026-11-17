/** Server-sent-events reader: UTF-8 safe across chunk boundaries, accepts \n, \r\n and \r line ends. */
export type SseMessage = { event?: string; data: string }

export async function* readSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  const onAbort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })
  let buf = ''
  let event: string | undefined
  let data: string[] = []
  const flush = (): SseMessage | null => {
    if (data.length === 0) { event = undefined; return null }
    const m: SseMessage = { ...(event !== undefined ? { event } : {}), data: data.join('\n') }
    event = undefined
    data = []
    return m
  }
  const line = (l: string): SseMessage | null => {
    if (l === '') return flush()
    if (l.startsWith(':')) return null
    const i = l.indexOf(':')
    const field = i < 0 ? l : l.slice(0, i)
    let value = i < 0 ? '' : l.slice(i + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    return null
  }
  try {
    for (;;) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      for (;;) {
        const m = /\r\n|\n|\r/.exec(buf)
        // A trailing \r may be half of \r\n: wait for more input.
        if (!m || (m[0] === '\r' && m.index === buf.length - 1)) break
        const out = line(buf.slice(0, m.index))
        buf = buf.slice(m.index + m[0].length)
        if (out) yield out
      }
    }
    buf += decoder.decode()
    if (buf) { const out = line(buf.replace(/\r$/, '')); if (out) yield out }
    const last = flush()
    if (last) yield last
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try { reader.releaseLock() } catch { /* a cancel is still pending */ }
  }
}
