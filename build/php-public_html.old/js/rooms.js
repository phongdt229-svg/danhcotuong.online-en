/*
 * rooms.js — Trang danh sách phòng (bản PHP, polling). Tự làm mới mỗi 3s.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function refresh() {
    let data;
    try { data = await window.API.matchList(); } catch (e) { return; }
    renderRooms((data && data.rooms) || []);
    renderLive((data && data.live) || []);
  }

  function renderRooms(list) {
    $('room-count').textContent = list.length;
    const box = $('room-list');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="room-empty">No open rooms yet. Create one!</div>'; return; }
    list.forEach((r) => {
      const row = document.createElement('div'); row.className = 'room-item';
      const info = document.createElement('span'); info.className = 'room-info';
      info.innerHTML = '<b>' + esc(r.host) + '</b><span class="room-code-sm">#' + esc(r.code) + '</span>';
      const btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = 'Join';
      btn.addEventListener('click', () => { location.href = 'play-online.html?join=' + encodeURIComponent(r.code); });
      row.appendChild(info); row.appendChild(btn); box.appendChild(row);
    });
  }

  function renderLive(list) {
    $('live-count').textContent = list.length;
    const box = $('live-list');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="room-empty">No games in progress.</div>'; return; }
    list.forEach((m) => {
      const row = document.createElement('div'); row.className = 'room-item';
      const info = document.createElement('span'); info.className = 'room-info';
      info.innerHTML = '<b>' + esc(m.red) + '</b> <span class="room-code-sm">vs</span> <b>' + esc(m.black) + '</b><span class="room-code-sm">' + (m.moves || 0) + ' moves</span>';
      const btn = document.createElement('button'); btn.className = 'btn btn-accent'; btn.textContent = '👁 Watch';
      btn.addEventListener('click', () => { location.href = 'spectate.html?code=' + encodeURIComponent(m.code); });
      row.appendChild(info); row.appendChild(btn); box.appendChild(row);
    });
  }

  function init() {
    $('btn-quick').addEventListener('click', () => { location.href = 'play-online.html?quick=1'; });
    $('btn-create').addEventListener('click', () => { location.href = 'play-online.html?create=1'; });
    $('btn-refresh').addEventListener('click', refresh);
    $('btn-join').addEventListener('click', () => {
      const code = ($('join-code').value || '').toUpperCase().trim();
      if (code.length < 3) return;
      location.href = 'play-online.html?join=' + encodeURIComponent(code);
    });
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
    refresh();
    setInterval(refresh, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
