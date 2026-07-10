importScripts('https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd.js');

const CACHE_NAME = 'attendance-portal-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never intercept calls to the Apps Script API — those must always hit the network
  if (url.includes('script.google.com') || url.includes('googleusercontent.com')) return;

  // Only handle GET requests for the app shell; let everything else pass through normally
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline — fall back to cache
      return cached || networkFetch;
    })
  );
});

/**
 * Background Sync — Chrome/Android only (Safari/iOS has no Background Sync API,
 * so on iPhones this handler simply never fires; those devices keep relying on
 * the on-open sync in index.html, which works everywhere).
 * The browser calls this on its own schedule once it detects connectivity,
 * even if the app tab/PWA is closed.
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncPendingRecords());
  }
});

async function syncPendingRecords() {
  const apiUrl = await idbKeyval.get('apiUrl');
  if (!apiUrl) return;

  const queue = (await idbKeyval.get('syncQueue')) || [];
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      const isLate = item.type === 'late';
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ fn: 'commitAttendanceRow', args: [item.payload, isLate, isLate] })
      });
      const data = await res.json();
      if (data && data.status === 'Error') throw new Error(data.message);
    } catch (err) {
      remaining.push(item); // still failing — keep it queued for next attempt
    }
  }
  await idbKeyval.set('syncQueue', remaining);
}
