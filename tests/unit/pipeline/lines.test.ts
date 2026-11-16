import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { createLineAssembler } from '../../../src/pipeline/lines'
import { createRecordStream } from '../../../src/pipeline/record-stream'

const fx = (n: string) => readFileSync(`tests/fixtures/streams/${n}.txt`, 'utf8')
const all = (text: string, size?: number) => {
  const a = createLineAssembler()
  const out: string[] = []
  if (size === undefined) out.push(...a.push(text))
  else for (let i = 0; i < text.length; i += size) out.push(...a.push(text.slice(i, i + size)))
  out.push(...a.end('end'))
  return out
}

describe('line assembler', () => {
  test('chunk boundaries (incl. inside "x²") yield same lines as one push', () => {
    const t = fx('spike-sonnet')
    const whole = all(t)
    expect(whole).toHaveLength(19)
    for (const size of [1, 3, 7, 50]) expect(all(t, size)).toEqual(whole)
    const i = t.indexOf('²')
    const a = createLineAssembler()
    expect([...a.push(t.slice(0, i)), ...a.push(t.slice(i)), ...a.end('end')]).toEqual(whole)
  })
  test('fenced and prose yield only JSON lines', () => {
    expect(all(fx('fenced'))).toEqual(all(fx('spike-sonnet')))
    expect(all(fx('prose'))).toEqual(all(fx('spike-sonnet')))
  })
  test('drops lines over 2000 chars, blanks and CRLF', () => {
    const long = '{"t":"say","text":"' + 'a'.repeat(2000) + '"}'
    expect(all(`${long}\r\n\r\n{"a":1}\r\n`)).toEqual(['{"a":1}'])
  })
  test('pretty.txt: zero accepted, 5 rejects, no crash', () => {
    const rej: string[] = []
    const s = createRecordStream({ mode: 'board', onRecord: () => { throw new Error('no') }, onReject: (l) => rej.push(l) })
    s.push(fx('pretty'))
    expect(s.end('end')).toEqual({ accepted: 0, rejected: 5 })
    expect(rej).toHaveLength(5)
  })
  test('truncated.txt: end("length") drops half line; end("end") rejects it', () => {
    const run = (stop: 'end' | 'length') => {
      const rej: string[] = []
      const s = createRecordStream({ mode: 'board', onRecord: () => {}, onReject: (l) => rej.push(l) })
      s.push(fx('truncated'))
      return { r: s.end(stop), rej }
    }
    expect(run('length')).toMatchObject({ r: { accepted: 3, rejected: 0 } })
    const e = run('end')
    expect(e.r).toEqual({ accepted: 3, rejected: 1 })
    expect(e.rej[0]).toBe('{"t":"say","text":"Cut off mid')
  })
})
