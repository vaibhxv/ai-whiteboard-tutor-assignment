import { expect, test } from 'vitest'
import { readSSE } from '../../../src/sources/sse'

export function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch)
      c.close()
    },
  })
}
const collect = async (b: ReadableStream<Uint8Array>) => {
  const out = []
  for await (const m of readSSE(b, new AbortController().signal)) out.push(m)
  return out
}

test('readSSE handles an event split across chunks', async () => {
  const r = await collect(streamOf(['event: a\nda', 'ta: {"x":1}\n', '\ndata: two\n\n']))
  expect(r).toEqual([{ event: 'a', data: '{"x":1}' }, { data: 'two' }])
})

test('readSSE handles a multi-byte char split across chunks and CRLF', async () => {
  const bytes = new TextEncoder().encode('data: π≈3.14 ✓\r\n\r\n')
  const cut = 8 // inside the 2-byte π or the 3-byte ≈
  const r = await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]))
  expect(r).toEqual([{ data: 'π≈3.14 ✓' }])
})

test('readSSE ignores comments and joins multi-line data; flushes a final unterminated event', async () => {
  const r = await collect(streamOf([': ping\ndata: a\ndata: b\n\ndata: tail']))
  expect(r).toEqual([{ data: 'a\nb' }, { data: 'tail' }])
})
