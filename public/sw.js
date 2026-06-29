// Service worker — network-first pages, offline-resilient.
//
// Strategy:
//   * HTML pages -> NETWORK-FIRST: when online, always fetch the fresh page
//     and show it (cache is updated as a side effect). Only when the network
//     fails (offline) do we serve the cached copy, then the offline page.
//     This runs on every navigation — no polling.
//   * /_astro/* (content-hashed, immutable) -> cache-first (never changes).
//   * other GETs (images, fonts, pagefind shards) -> stale-while-revalidate.
//
// So an online user always gets fresh content/HTML on navigation; an offline
// user still gets everything they've visited plus a branded offline fallback.
// Bump VERSION to invalidate everything on a new deploy.
const VERSION = "v2";
const IMMUTABLE = `immutable-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const OFFLINE_URL = "/offline";

// Automatic LRU bounds so caches can never grow unbounded between VERSION bumps.
// Cache.keys() returns entries in insertion order, so the oldest are at the
// front; we re-insert on access (touch) to make it true LRU, then trim.
const LIMITS = { [IMMUTABLE]: 250, [RUNTIME]: 200 };

// Precached on install so the app shell + fallback work offline immediately.
const PRECACHE = [
  "/",
  "/home",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(RUNTIME);
      // Don't fail the whole install if one asset 404s.
      await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Immutable, content-hashed build assets: cache-first.
  if (url.pathname.startsWith("/_astro/")) {
    event.respondWith(cacheFirst(request, IMMUTABLE));
    return;
  }

  // HTML pages (full navigations AND Astro ClientRouter soft navigations,
  // which arrive as same-origin fetches without mode "navigate"): detect by
  // an extension-less path that isn't an asset namespace.
  if (isPageRequest(request, url)) {
    event.respondWith(pageNetworkFirst(request));
    return;
  }

  // Images, fonts, pagefind index, etc: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request, RUNTIME));
});

function isPageRequest(request, url) {
  if (request.mode === "navigate" || request.destination === "document") return true;
  const p = url.pathname;
  if (p.startsWith("/_astro/") || p.startsWith("/pagefind/") || p.startsWith("/fonts/") ||
      p.startsWith("/images/") || p.startsWith("/icons/")) return false;
  const last = p.split("/").pop() || "";
  return !last.includes("."); // extension-less -> a page route
}

// Network-first: when online, fetch the fresh page and show it (and refresh the
// cache). When the network fails, serve the cached page, then the offline page.
async function pageNetworkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(request);
    if (res && res.ok) await put(cache, RUNTIME, request, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    return cached || (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Touch: re-insert so this entry becomes most-recently-used.
    await put(cache, cacheName, request, cached.clone());
    return cached;
  }
  const res = await fetch(request);
  if (res && res.ok) await put(cache, cacheName, request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) put(cache, cacheName, request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

// Write an entry, then enforce the LRU bound for its cache by deleting the
// oldest entries (front of Cache.keys()) once over the limit.
async function put(cache, cacheName, request, response) {
  // Delete-then-add moves the key to the end (most-recently-used).
  await cache.delete(request);
  await cache.put(request, response);
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}
