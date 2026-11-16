import { describe, expect, test } from 'vitest'
import { layoutAnswer } from '../../../src/layout/answer'
import { paginate } from '../../../src/layout/engine'
import { beat, fake, inside, m, mark, noOverlap, spikeBeats, w } from './fake'

describe('layoutAnswer', () => {
  test('layoutAnswer never returns a box outside its panel and never changes lesson items', () => {
    const segs = [{ segKey: 'seg:1', template: 'split' as const, beats: spikeBeats() }]
    const pages = paginate(segs, fake, 'wide')
    const snapshot = JSON.stringify(pages)
    const answer = [
      beat('ans:1#0', [w('aw1', 'The vertex is the lowest point.'), m('am1')], 'Good question.', 'answer'),
      beat('ans:1#1', [mark('v'), { t: 'step', id: 'as1', latex: 'x=2', expr: 'x=2', why: 'midpoint' }], 'See?', 'answer'),
    ]
    const res = layoutAnswer(answer, fake, 'wide')
    expect(res.panel).toEqual({ x: 780, y: 420, w: 380, h: 300 })
    expect(res.items.map((i) => i.id)).toEqual(['aw1', 'am1', 'as1'])
    for (const it of res.items) {
      expect(inside(it.box, res.panel)).toBe(true)
      expect(it.ink).toBe('answer')
      expect(it.region).toBe('notes')
    }
    expect(noOverlap(res.items)).toBe(true)
    expect(res.items.map((i) => i.beatId)).toEqual(['ans:1#0', 'ans:1#0', 'ans:1#1'])
    expect(JSON.stringify(pages)).toBe(snapshot)
    expect(layoutAnswer(answer, fake, 'narrow').panel).toEqual({ x: 20, y: 660, w: 560, h: 320 })
  })

  test('overflowing answers keep their order and stay within panel x-bounds (the panel scrolls)', () => {
    const beats = Array.from({ length: 6 }, (_, i) =>
      beat(`ans#${i}`, [w(`a${i}`, 'A fairly long sentence that will wrap inside the answer panel.')], 's', 'answer'))
    const res = layoutAnswer(beats, fake, 'narrow')
    const { panel } = res
    expect(res.items).toHaveLength(6)
    for (const it of res.items) {
      expect(it.box.x).toBeGreaterThanOrEqual(panel.x)
      expect(it.box.x + it.box.w).toBeLessThanOrEqual(panel.x + panel.w)
      expect(it.box.y).toBeGreaterThanOrEqual(panel.y)
    }
    expect(noOverlap(res.items)).toBe(true)
    const last = res.items[5]
    expect((last?.box.y ?? 0) + (last?.box.h ?? 0)).toBeGreaterThan(panel.y + panel.h)
  })
})
