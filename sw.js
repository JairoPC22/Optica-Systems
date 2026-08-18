'use strict';

const CACHE = 'aurora-v9.1';
const SHELL = [
  './',
  './index.html',
  './script.js',
  './styles.css',
  './Logo-optica.ico',
  './manifest.json',
];

// Recursos externos que queremos cachear para offline
const CDN_PRECACHE = [
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
  'https://cdn.jsdelivr.net/npm/feather-icons/dist/feather.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => {
        // Shell local — falla si alguno no existe (correcto)
        return c.addAll(SHELL).then(() => {
          // CDN — cachear con ignorar errores individuales
          return Promise.allSettled(
            CDN_PRECACHE.map(url =>
              fetch(url, { mode: 'cors' })
                .then(res => { if (res.ok) c.put(url, res); })
                .catch(() => {/* sin conexión al instalar → se cachea al primer uso */})
            )
          );
        });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── Google Apps Script (API principal) → solo red, sin cachear ──
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com')
  ) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ ok: false, data: [], error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // ── EmailJS → solo red ──
  if (url.hostname.includes('emailjs.com')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ status: 0, error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // ── Solo interceptar GET ──
  if (e.request.method !== 'GET') {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ ok: false, error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // ── Google Fonts CSS → red primero, caché si falla ──
  if (url.hostname.includes('fonts.googleapis.com')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || new Response('', { status: 503 })))
    );
    return;
  }

  // ── Google Fonts archivos de fuente → caché primero (no cambian) ──
  if (url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // ── CDN (feather, chart.js, emailjs) → caché primero ──
  if (url.hostname.includes('cdn.jsdelivr.net')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // ── cdnjs (three.js u otros) → caché primero ──
  if (url.hostname.includes('cdnjs.cloudflare.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // ── Archivos locales (shell de la app) → caché primero ──
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Si piden index.html y no hay red → devolver la versión cacheada del shell
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});