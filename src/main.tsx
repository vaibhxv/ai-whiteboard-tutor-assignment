import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/playpen-sans/400.css'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/app.css'

async function root() {
  // Dev-only board gallery (?dev=board); tree-shaken from production builds.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('dev') === 'board') {
    const { DevBoard } = await import('./board/DevBoard')
    return <DevBoard />
  }
  return <App />
}

void root().then((el) => createRoot(document.getElementById('root')!).render(<StrictMode>{el}</StrictMode>))
