/* Majlis service worker — app-shell + CDN resilience.
   Navigations are network-first (fresh deploys always win, cached shell is the
   offline fallback); CDN modules and fonts are stale-while-revalidate so a
   flaky connection mid-session never stalls the signaling module. */
const CACHE = 'majlis-shell-v1';
const CORE = ['./', './index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 /* WebRTC/MQTT/WebSocket traffic is never touched */
  const url = new URL(req.url);

  /* App navigation: fresh copy when online, cached shell when offline */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* Signaling module + fonts: serve cached instantly, refresh in background */
  const cdn = url.hostname.endsWith('jsdelivr.net') || url.hostname.endsWith('esm.run') ||
              url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (cdn) {
    e.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  /* Same-origin static assets: stale-while-revalidate */
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  }
});
