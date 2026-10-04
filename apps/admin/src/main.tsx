import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { Toaster } from './components/ui/sonner'
import './index.css'

const container = document.getElementById('root')
if (container === null) throw new Error('index.html is missing #root')

/**
 * The router's root, taken from the page rather than written here.
 *
 * The panel's entry point is a setting -- `/admin` is the first thing a scanner
 * tries, so the operator can move it -- which means the build cannot know its own
 * base path. The first segment of the URL it was served at is it: the Worker serves
 * the shell under the configured path and under no other, so the shell arriving at
 * all is the answer to the question. It is also what makes history routing work on
 * a deep link (architecture section 3.3).
 */
function panelBase(): string {
  const [first] = window.location.pathname.split('/').filter((part) => part !== '')

  return first === undefined ? '/admin' : `/${first}`
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={panelBase()}>
      <App />
      <Toaster />
    </BrowserRouter>
  </StrictMode>,
)
