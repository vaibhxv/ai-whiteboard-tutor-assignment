import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { BestEffortBanner } from '../../../src/ui/BestEffortBanner'
import { Disclosure } from '../../../src/ui/Disclosure'
import { SourceBadge } from '../../../src/ui/SourceBadge'
import { settingsBadge } from '../../../src/sources/create'
import { DEFAULT_SETTINGS } from '../../../src/storage/settings'
import { liveApiBadge, liveCliBadge, recordedBadge } from '../../../src/sources/types'
import { fixture } from './helpers'

describe('SourceBadge', () => {
  test('recorded: exact text, styled as recorded', () => {
    render(<SourceBadge badge={recordedBadge(fixture)} />)
    const b = screen.getByTestId('source-badge')
    expect(b).toHaveTextContent('RECORDED · claude-sonnet-5-5 · captured 16 Nov 2026')
    expect(b).toHaveClass('badge-recorded')
    expect(b).not.toHaveClass('badge-live')
  })

  test('live: exact text, styled differently from recorded', () => {
    const { rerender } = render(<SourceBadge badge={liveApiBadge('Anthropic API', 'claude-sonnet-5-5')} />)
    expect(screen.getByTestId('source-badge')).toHaveTextContent('LIVE · Anthropic API · claude-sonnet-5-5')
    expect(screen.getByTestId('source-badge')).toHaveClass('badge-live')
    rerender(<SourceBadge badge={liveCliBadge('claude')} />)
    expect(screen.getByTestId('source-badge')).toHaveTextContent('LIVE · Claude Code on this computer')
  })

  test('never absent: before a lesson the badge names the chosen source', () => {
    render(<SourceBadge badge={settingsBadge(DEFAULT_SETTINGS)} />)
    expect(screen.getByTestId('source-badge').textContent).toMatch(/^RECORDED · /)
    expect(settingsBadge({ ...DEFAULT_SETTINGS, sourceId: 'openai-compatible', provider: 'gemini' }).text).toBe('LIVE · Gemini API · gemini-3.8-flash')
    expect(settingsBadge({ ...DEFAULT_SETTINGS, sourceId: 'codex' }).text).toBe('LIVE · Codex on this computer')
  })
})

describe('Disclosure and best-effort banner', () => {
  test('exact copy', () => {
    render(<><Disclosure /><BestEffortBanner /></>)
    expect(screen.getByText('AI-generated lesson. Maths marked ✓ was checked by code.')).toBeInTheDocument()
    expect(screen.getByText("Outside my checked zone. I can explain and sketch, but I can't verify this the way I verify maths.")).toBeInTheDocument()
  })
})
