/* Offline shell for already visited pages. Private API responses are never cached. */
const SHELL_CACHE = 'hikes-shell-v5-1';
const PUBLIC_CACHE = 'hikes-public-v5-1';
const SHELL = ['./', './index.html', './css/app.css', './css/redesign.css',
  './js/data.js', './js/ui.js', './js/track.js', './js/api.js',
  './js/offline-store.js', './js/king-applications.js', './js/app.js', './js/admin.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('hikes-') && ![SHELL_CACHE, PUBLIC_CACHE].includes(key))
    .map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isShell = url.pathname.startsWith('/app/');
  const isPublic = /^\/api\/(routes|summits|points|peaks\/hot|community\/recent)(?:\/|$)/.test(url.pathname);
  if (!isShell && !isPublic) return;
  const cacheName = isShell ? SHELL_CACHE : PUBLIC_CACHE;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(cacheName).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: isShell })
    .then(hit => hit || Response.error())));
});
