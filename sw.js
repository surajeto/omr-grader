// แคชไฟล์แอปและ OpenCV (~10MB) ไว้ในเครื่อง เพื่อเปิดครั้งต่อไปได้เร็ว/ออฟไลน์
const CACHE = 'omr-v9';
const CORE = ['./', 'index.html', 'app.js?v=9', 'omr.js?v=9', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname === 'api.anthropic.com' || u.hostname === 'script.google.com') return;
  const cdn = u.hostname === 'cdn.jsdelivr.net' || u.hostname.endsWith('gstatic.com') || u.hostname === 'fonts.googleapis.com';
  if (cdn) { // CDN มีเวอร์ชันตายตัว: cache-first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    })));
  } else if (u.origin === location.origin) { // ไฟล์แอป: network-first เพื่อให้ได้เวอร์ชันล่าสุด
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match(e.request)));
  }
});
