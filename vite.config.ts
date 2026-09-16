import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
})

function offlineServiceWorker(): Plugin {
  return {
    name: 'offline-service-worker',
    generateBundle(_, bundle) {
      const generatedFiles = Object.values(bundle)
        .map((item) => `/${item.fileName}`)
        .filter((fileName) => fileName !== '/sw.js')
      const precache = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/favicon.svg',
        '/apple-touch-icon.png',
        '/pwa-192x192.png',
        '/pwa-512x512.png',
        ...generatedFiles,
      ]
      const cacheVersion = hash(precache.join('|'))

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: buildServiceWorker(cacheVersion, precache),
      })
    },
  }
}

function hash(value: string): string {
  let result = 0
  for (const character of value) {
    result = (result * 31 + character.charCodeAt(0)) >>> 0
  }
  return result.toString(36)
}

function buildServiceWorker(version: string, precache: string[]): string {
  return `
const CACHE_NAME = 'golf-strokes-gained-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/.auth/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
`.trimStart()
}
