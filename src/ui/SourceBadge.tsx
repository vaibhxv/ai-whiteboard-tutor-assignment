import { badgeText } from '../sources/types'
import type { Badge } from '../sources/types'

/**
 * The AI source badge: always in the header. Recorded and live differ in wording (RECORDED / LIVE) and
 * in style (outlined amber square vs filled green dot, drawn by CSS so the text stays exact).
 */
export function SourceBadge({ badge }: { badge: Badge }) {
  const recorded = badge.mode === 'recorded'
  return (
    <p className={`source-badge ${recorded ? 'badge-recorded' : 'badge-live'}`} data-testid="source-badge" title="AI source">
      {badge.text || badgeText(badge)}
    </p>
  )
}
