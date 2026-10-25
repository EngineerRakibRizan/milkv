// FarmOS service worker: makes the app installable and lets it open instantly,
// even offline. API responses are never cached here; data lives in
// TanStack Query's IndexedDB cache and writes go through the offline outbox.
const VERSION = 'v2'
const SHELL = `farmos-shell-${VERSION}`
const FONTS = `farmos-fonts-${VERSION}`
const PRECACHE = ['/', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  const keep = [SHELL, FONTS]
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)))))
  self.clients.claim()
})

const put = (cache, req, res) => { if (res.ok) caches.open(cache).then((c) => c.put(req, res.clone())); return res }

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Google Fonts (Bangla typeface): cache first, so text renders offline too.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(FONTS, req, r))))
    return
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api') || url.pathname.startsWith('/app/') || url.pathname.startsWith('/broadcasting')) return

  // Page loads: network first (always the latest version), cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => put(SHELL, '/', r)).catch(() => caches.match('/')))
    return
  }

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(SHELL, req, r))))
    return
  }

  // Icons and manifest: serve cached, refresh in the background.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.svg') {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => put(SHELL, req, r)).catch(() => hit)
      return hit || net
    }))
  }
})
