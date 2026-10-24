// FarmOS service worker: caches the app shell so repeat visits start instantly
// and the app opens offline. API responses are never cached here; data is
// cached by TanStack Query in IndexedDB and synced through the outbox.
const SHELL = 'farmos-shell-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api') || url.pathname.startsWith('/broadcasting')) return

  // Navigations: network first, fall back to the cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone()
      caches.open(SHELL).then((c) => c.put('/', copy))
      return r
    }).catch(() => caches.match('/')))
    return
  }

  // Hashed build assets are immutable: cache first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const copy = r.clone()
      caches.open(SHELL).then((c) => c.put(e.request, copy))
      return r
    })))
  }
})
