/* MedHub service worker — uses one logo: 1.png */

const CACHE_PREFIX = 'medhub-';
const CACHE_VERSION = 'v2';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

const ROOT_URL = new URL('./', self.location.href).href;
const HOME_URL = new URL('./index.html', ROOT_URL).href;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './1.png'
].map((path) => new URL(path, ROOT_URL).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      await cache.add(
        new Request(HOME_URL, { cache: 'reload' })
      );

      await Promise.all(
        PRECACHE
          .filter((url) => url !== HOME_URL)
          .map((url) =>
            cache
              .add(new Request(url, { cache: 'reload' }))
              .catch(() => {})
          )
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(CACHE_PREFIX) &&
              key !== CACHE_NAME
          )
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(ROOT_URL)) return;

  // Let the browser handle PDFs and partial downloads.
  if (
    url.pathname.toLowerCase().endsWith('.pdf') ||
    request.headers.has('range')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // Return cached assets while refreshing them in the background.
  const refresh = fetchAndCache(request);
  event.waitUntil(refresh.then(() => {}));

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      return cached || (await refresh) || Response.error();
    })()
  );
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, {
      cache: 'reload'
    });

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached =
      (await cache.match(request)) ||
      (await cache.match(HOME_URL)) ||
      (await cache.match(ROOT_URL));

    if (cached) return cached;

    return new Response(
      `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport"
                content="width=device-width, initial-scale=1">
          <title>MedHub — Offline</title>
        </head>
        <body style="
          font-family: sans-serif;
          background: #f8fbff;
          color: #0f172a;
          text-align: center;
          padding: 48px 20px;
        ">
          <h2>You are offline</h2>
          <p>Please reconnect and reopen MedHub.</p>
        </body>
      </html>`,
      {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8'
        }
      }
    );
  }
}

async function fetchAndCache(request) {
  try {
    const response = await fetch(request);

    if (response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    return null;
  }
}
