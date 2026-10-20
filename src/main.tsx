import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useStore } from './store/useStore'
import { detectLocale, setupI18n } from './i18n'
import { startSync } from './sync/server'

// First run: seed fictional sample data so the prototype can be explored.
const initial = useStore.getState()
if (!initial.seeded) {
  initial.loadSample(detectLocale())
  try {
    localStorage.setItem('zendo.fresh', '1') // a seeded sample never counts as the user's own data
  } catch {
    /* ignore */
  }
}
setupI18n(useStore.getState().settings.locale)
startSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
