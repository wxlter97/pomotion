/**
 * Service worker de pomotion — hecho a mano, sin dependencias.
 *
 * Objetivo (ROADMAP §11 Tier 3): que la app abra sin conexión mostrando lo
 * último que se vio. NO encola mutaciones: offline es solo lectura, las
 * escrituras fallan con el manejo de error que ya tiene la app.
 *
 * Estrategias:
 *   - navegación (cargar la app)  → red primero, cae al index.html cacheado
 *   - /assets/* (con hash, inmutables) → cache primero
 *   - GET /api/tasks + /api/auth/status → red primero, cae a lo guardado
 *     (el auth cacheado deja entrar a la app offline; al reconectar se
 *     revalida y si la sesión venció cae a "guest")
 *   - íconos / manifest estáticos → cache primero
 *   - todo lo demás (otras rutas de API, POST, terceros) → directo a la red
 *
 * Al cambiar VERSION se purgan los caches viejos en `activate`. El worker
 * nuevo espera hasta que la app mande SKIP_WAITING (ver src/pwa.ts) para no
 * cambiar los assets bajo los pies de una sesión abierta.
 */
const VERSION = 'v1';
const SHELL_CACHE = `pomotion-shell-${VERSION}`;
const ASSET_CACHE = `pomotion-assets-${VERSION}`;
const API_CACHE = `pomotion-api-${VERSION}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE, API_CACHE];

/** Tope de respuestas de API guardadas (una por combinación de query). */
const API_CACHE_MAX = 16;

self.addEventListener('install', (event) => {
  // Best-effort: si falla, `navigationHandler` igual cachea el shell en la
  // primera navegación online.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add('/index.html'))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (url.pathname === '/api/tasks' || url.pathname === '/api/auth/status') {
    event.respondWith(networkFirst(request, API_CACHE, { cap: API_CACHE_MAX }));
    return;
  }
  if (/\.(?:png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});

async function navigationHandler(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put('/index.html', res.clone());
    return res;
  } catch (err) {
    return (await cache.match('/index.html')) ?? Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, res.clone());
  }
  return res;
}

async function networkFirst(request, cacheName, opts = {}) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
      if (opts.cap) void trimCache(cache, opts.cap);
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/** Deja el cache en `max` entradas, tirando las más viejas (keys() respeta el
 *  orden de inserción). */
async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
