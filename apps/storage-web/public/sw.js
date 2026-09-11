/*
 * The service worker exists for one reason: a godown has bad signal.
 *
 * Two strategies, chosen per request rather than one applied to
 * everything:
 *
 * - **The app shell is cache-first.** HTML, JS and CSS are content-hashed
 *   by the build, so a cached copy is never stale -- and it means the app
 *   opens on a dead connection instead of showing the browser's dinosaur.
 * - **The API is network-first, with a cached fallback for reads.** A GET
 *   that fails falls back to the last answer it gave, so an operator
 *   standing in the godown can still look up what a family has stored.
 *   Writes are never cached or replayed: quietly re-sending "hand back 4
 *   cartons" when the signal returns is exactly the mistake nobody could
 *   undo.
 */
const VERSION = 'storage-book-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only a good answer is worth keeping. A 401 or a 402 cached and
          // replayed later would lock somebody out of their own app.
          if (response.ok) {
            const copy = response.clone();
            caches.open(DATA).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ message: 'You are offline, and this has not been loaded before.' }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          );
        }),
    );
    return;
  }

  // Navigations: the shell, so the app opens offline and React routes from
  // there. Everything else (hashed assets): cache first, then network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
