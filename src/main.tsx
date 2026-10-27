import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useStore } from './store/useStore'
import { changeLocale, detectLocale, setupI18n } from './i18n'
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
// The language can also arrive with the server's settings (first sync, another device).
useStore.subscribe((s, prev) => {
  if (s.settings.locale !== prev.settings.locale) changeLocale(s.settings.locale)
})
startSync()
// The built app opens without a connection too (src/sw.js); the dev server has no service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
