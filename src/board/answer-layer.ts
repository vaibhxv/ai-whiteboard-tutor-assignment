import { boardBox } from '../layout/constants'
import { markId } from '../layout/engine'
import { markGeometry, markTargetBox } from '../layout/marks'
import type { Measurer, Placed, Viewport } from '../layout/types'
import { layoutAnswer } from '../layout/answer'
import type { Beat } from '../pipeline/beats'

const isPlotLike = (p: Placed) => p.action.t === 'plot' || p.action.t === 'explore'

/**
 * Everything an answer draws: its own lines laid out in the answer panel (`layoutAnswer`), and the
 * marks, points, lines and guides that refer to lesson elements, resolved against the lesson page on
 * show (`lesson`). Those keep their `ink: 'answer'`, so they are drawn in answer ink on the lesson page.
 * A reference to something that is not on the page is dropped, never thrown.
 */
export function answerLayer(beats: Beat[], lesson: readonly Placed[], m: Measurer, vp: Viewport) {
  const { panel, items: own } = layoutAnswer(beats, m, vp)
  const known = [...lesson.filter((p) => p.region !== 'overlay'), ...own]
  const find = (id: string) => known.find((p) => p.id === id)
  const bounds = boardBox(vp)
  const refs: Placed[] = []
  for (const beat of beats) {
    for (const [actionIndex, a] of beat.actions.entries()) {
      if (a.t === 'point' || a.t === 'line' || a.t === 'guide') {
        const parent = find(a.plot)
        if (!parent || !isPlotLike(parent)) continue
        const it: Placed = { id: a.id, action: a, box: parent.box, beatId: beat.id, actionIndex, ink: beat.ink, region: 'inplot', parent: a.plot }
        refs.push(it)
        known.push(it)
      } else if (a.t === 'mark') {
        const target = find(a.target)
        if (!target) continue
        const parent = target.region === 'inplot' && target.parent !== undefined ? find(target.parent) : undefined
        const box = markGeometry(a.kind, markTargetBox(target, parent), bounds).shape
        refs.push({ id: markId(beat.id, actionIndex), action: a, box, beatId: beat.id, actionIndex, ink: beat.ink, region: 'overlay' })
      }
    }
  }
  return { panel, items: [...own, ...refs] }
}
