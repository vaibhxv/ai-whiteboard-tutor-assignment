import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import App from '../../src/App'

test('app renders the product name', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: /whyboard/i })).toBeInTheDocument()
})
