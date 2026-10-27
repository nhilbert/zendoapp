/**
 * Zendo's service worker: the app opens without a connection to the server.
 * Built into dist/sw.js by the plugin in vite.config.ts, which fills in VERSION and FILES.
 *  - Pages come from the network first, so the sign-in and new deploys work as before. Without a
 *    network (or while the server is down) the saved app is shown; the data stays in the browser
 *    storage and the sync sends queued changes once the server answers again.
 *  - The app's files (hashed bundles, fonts, icons) come from the cache of this version.
 *  - The API, sign-in, agent and TRMNL addresses are never touched.
 */
const VERSION = '__VERSION__'
const FILES = __FILES__
const CACHE = `zendo-${VERSION}`
const SERVER_ONLY = /^\/(api|oauth2?|mcp|trmnl|\.well-known)(\/|$)/
const PAGE_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

// The newest deploy takes over at once, so the saved app always matches the server's data format.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zendo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || SERVER_ONLY.test(url.pathname)) return
  if (req.mode === 'navigate') event.respondWith(page(req))
  else event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit ?? fetch(req)))
})

/** Network first (redirects to the sign-in pass through); the saved app when offline, slow or the server is down. */
async function page(req) {
  const saved = () => caches.match('/index.html', { cacheName: CACHE })
  try {
    const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS))])
    return res.status >= 500 ? ((await saved()) ?? res) : res
  } catch {
    return (await saved()) ?? Response.error()
  }
}
