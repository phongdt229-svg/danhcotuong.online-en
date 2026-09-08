/*
 * sw.js — Service Worker: cache app shell để cài app + chơi với máy OFFLINE.
 * Chiến lược: /api/ luôn dùng mạng; tài nguyên tĩnh cache-first (kèm cập nhật ngầm).
 */
const CACHE = 'dct-cache-v18';

// Tài nguyên lõi cho "chơi với máy" (precache để offline dùng được ngay).
const CORE = [
  'index.html',
  'play.html',
  'play-up.html',
  'puzzles.html',
  'topup.html',
  'history.html',
  'withdraw.html',
  'js/withdraw.js?v=18',
  'js/topup.js?v=18',
  'js/history.js?v=18',
  'puzzles.json?v=18',
  'js/puzzles.js?v=18',
  'js/play-up.js?v=18',
  'css/style.css?v=18',
  'css/board.css?v=18',
  'js/engine/xiangqi.js?v=18',
  'js/engine/ai.worker.js?v=18',
  'js/board.js?v=18',
  'js/play.js?v=18',
  'js/api.js?v=18',
  'js/ui.js?v=18',
  'images/ad.svg?v=18',
  'images/banner.svg?v=18',
  'images/icon.svg',
  'manifest.json?v=18',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await Promise.allSettled(CORE.map((u) => c.add(u)));
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api/') !== -1) return; // API: luôn mạng

  // NETWORK-FIRST cho MỌI thứ (HTML/CSS/JS/ảnh): online luôn lấy bản mới nhất,
  // mất mạng mới dùng cache. Nhờ vậy sửa CSS/JS là thấy ngay, không kẹt bản cũ.
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const r = await fetch(req);
        if (r && r.ok) cache.put(req, r.clone()); // cập nhật cache cho lần offline
        return r;
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return (await cache.match('play.html')) || (await cache.match('index.html'));
        }
        throw err;
      }
    })()
  );
});
