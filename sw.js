/* MedHub service worker
 * - Homepage: network-first (always the latest when online), cached copy when offline
 * - Old caches are deleted on activate
 * - All paths are relative, so it works in a GitHub Pages subfolder
 *
 * To force every user to update: change CACHE_VERSION (v1 -> v2 ...).
 */
const CACHE_PREFIX = 'medhub-';
const CACHE_VERSION = 'v1';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Resolved against the service worker's own location (works in any subfolder)
const HOME_URL = new URL('./index.html', self.location).href;
const ROOT_URL = new URL('./', self.location).href;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Homepage is required; install fails if it can't be cached.
      await cache.add(new Request('./index.html', { cache: 'reload' }));
      // Everything else is best-effort so a missing file never blocks install.
      await Promise.all(
        PRECACHE.filter((u) => u !== './index.html').map((u) =>
          cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignore Google Analytics etc.
  if (!url.href.startsWith(ROOT_URL)) return;       // stay inside our own folder

  // Homepage / page navigations: network first, cache fallback
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req));
    return;
  }

  // PDFs: leave to the browser (large files, range requests)
  if (url.pathname.toLowerCase().endsWith('.pdf')) return;

  // Other same-origin files (icons, manifest...): cache first, refresh in background
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req, { cache: 'reload' }); // bypass HTTP cache
    if (fresh && fresh.ok) {
      cache.put(HOME_URL, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached =
      (await cache.match(HOME_URL)) ||
      (await cache.match(ROOT_URL)) ||
      (await caches.match(HOME_URL));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>MedHub</title><body style="font-family:sans-serif;background:#f8fbff;text-align:center;padding:48px 20px">' +
        '<h2>You are offline</h2><p>Please reconnect and reopen MedHub.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}
