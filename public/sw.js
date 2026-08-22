/*
 * sw.js — Service Worker: cache app shell để cài app + chơi với máy OFFLINE.
 * Chiến lược: /api/ luôn dùng mạng; tài nguyên tĩnh cache-first (kèm cập nhật ngầm).
 */
const CACHE = 'dct-cache-v14';

// Tài nguyên lõi cho "chơi với máy" (precache để offline dùng được ngay).
const CORE = [
  'index.html',
  'play.html',
  'play-up.html',
  'puzzles.html',
  'topup.html',
  'history.html',
  'withdraw.html',
  'js/withdraw.js?v=14',
  'js/topup.js?v=14',
  'js/history.js?v=14',
  'puzzles.json?v=14',
  'js/puzzles.js?v=14',
  'js/play-up.js?v=14',
  'css/style.css?v=14',
  'css/board.css?v=14',
  'js/engine/xiangqi.js?v=14',
  'js/engine/ai.worker.js?v=14',
  'js/board.js?v=14',
  'js/play.js?v=14',
  'js/api.js?v=14',
  'js/ui.js?v=14',
  'images/ad.svg?v=14',
  'images/banner.svg?v=14',
  'images/icon.svg',
  'manifest.json',
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
