'use strict';

const ROOT = new URL('./', self.location.href);
const PREFIX = `medhub-${ROOT.pathname}-`;
const CACHE = `${PREFIX}v3`;
const HOME = ROOT.href;

// Save the homepage for offline use.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    try {
      const response = await fetch(
        new Request(HOME, { cache: 'reload' })
      );

      if (
        response.ok &&
        !response.redirected &&
        (response.headers.get('content-type') || '')
          .includes('text/html')
      ) {
        await cache.put(HOME, response);
      }
    } catch (error) {
      console.warn(
        'MedHub: the homepage will be saved on a later visit.',
        error
      );
    }

    await self.skipWaiting();
  })());
});

// Remove older versions of this app's cache.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();

    await Promise.all(
      names
        .filter(name =>
          name.startsWith(PREFIX) && name !== CACHE
        )
        .map(name => caches.delete(name))
    );

    await self.clients.claim();
  })());
});

// Load the latest homepage online; use the saved copy offline.
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  const isHome =
    url.pathname === ROOT.pathname ||
    url.pathname === new URL('index.html', ROOT).pathname;

  if (
    request.method !== 'GET' ||
    request.mode !== 'navigate' ||
    url.origin !== ROOT.origin ||
    !isHome ||
    url.search
  ) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    try {
      const response = await fetch(request);

      if (
        response.ok &&
        !response.redirected &&
        (response.headers.get('content-type') || '')
          .includes('text/html')
      ) {
        await cache.put(HOME, response.clone())
          .catch(() => {});
      }

      return response;
    } catch (error) {
      const saved = await cache.match(HOME);

      if (saved) return saved;

      return new Response(
        `<!doctype html>
        <html lang="en">
          <meta charset="utf-8">
          <meta name="viewport"
                content="width=device-width, initial-scale=1">
          <title>MedHub — Offline</title>
          <body>
            <h1>You are offline</h1>
            <p>Connect to the internet and visit MedHub
               once to save its homepage.</p>
            <button onclick="location.reload()">Try again</button>
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
  })());
});
