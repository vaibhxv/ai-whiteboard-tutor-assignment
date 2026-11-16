import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/playpen-sans/400.css'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/app.css'

async function root() {
  const params = new URLSearchParams(location.search)
  // Dev-only board gallery (?dev=board); tree-shaken from production builds.
  if (import.meta.env.DEV && params.get('dev') === 'board') {
    const { DevBoard } = await import('./board/DevBoard')
    return <DevBoard />
  }
  // Dev-only: ?fixture=vertex plays the test fixture through the replay source.
  if (import.meta.env.DEV && params.get('fixture') === 'vertex') {
    const [{ startRecording }, fx] = await Promise.all([
      import('./ui/session'),
      import('../tests/fixtures/lessons/vertex.fixture.json'),
    ])
    void startRecording(fx.default, 'Finding the vertex of a parabola')
  }
  return <App />
}

void root().then((el) => createRoot(document.getElementById('root')!).render(<StrictMode>{el}</StrictMode>))
