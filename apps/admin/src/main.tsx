import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import './index.css'

const container = document.getElementById('root')
if (container === null) throw new Error('index.html is missing #root')

createRoot(container).render(
  <StrictMode>
    {/*
      The SPA is served under /admin/*, so the router treats that as its root.
      The Worker answers any unmatched /admin/* path with index.html, which is
      what makes history routing work on a deep link (architecture section 3.3).
    */}
    <BrowserRouter basename="/admin">
      <App />
    </BrowserRouter>
  </StrictMode>,
)
