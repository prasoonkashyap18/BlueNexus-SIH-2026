import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/feedback/ErrorBoundary.tsx'

// The error boundary wraps the whole application surface: an unexpected render
// error anywhere below shows the recoverable fallback instead of a blank page.
// "Try again" remounts App from scratch (keyed subtree), so there is never a
// second React root, a second Three.js canvas, or leftover comparison state.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
