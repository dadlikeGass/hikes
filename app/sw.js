/* Offline shell for already visited pages. Private API responses are never cached. */
const SHELL_CACHE = 'hikes-shell-v10-5';
const PUBLIC_CACHE = 'hikes-public-v10-5';
const SHELL = ['./', './index.html', './css/app.css', './css/redesign.css',
  './js/data.js', './js/ui.js', './js/track.js', './js/api.js',
  './js/offline-store.js', './js/king-applications.js', './js/vendor/jsqr.js',
  './js/app.js', './js/admin.js'];

self.addEventListener('install', event => {
  /* 新版本立即接管：缓存名一变（下面 v10-2），旧的空详情缓存当场清掉，
     不用等用户把所有标签页都关掉。 */
  self.skipWaiting();
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
  /* 只缓存列表接口。线路详情 /api/routes/{slug} 曾经也被缓存：
     数据还没导入完时打开过页面，旧的空 path/profile 会一直留在缓存里，
     部署后就会出现"轨迹图和坡度图都没了"。详情每次实时取。 */
  const isPublic = /^\/api\/(routes|summits|points|peaks\/hot|community\/recent)$/.test(url.pathname);
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
