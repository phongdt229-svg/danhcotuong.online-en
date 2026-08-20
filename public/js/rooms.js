/*
 * rooms.js — Trang "Danh sách phòng đang có".
 * Kết nối WebSocket /ws, hiển thị danh sách phòng đang chờ (cập nhật trực tiếp).
 * Bấm "Vào" / "Tạo phòng" / "Tìm nhanh" sẽ chuyển sang play-online.html kèm tham số
 * để trang đó tự thực hiện hành động tương ứng.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let ws = null;
  let myName = 'Khách';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function connStatus(msg) { const el = $('conn-status'); if (el) el.textContent = msg; }
  function enable(on) {
    ['btn-quick', 'btn-create', 'btn-join', 'btn-refresh'].forEach((id) => { const b = $(id); if (b) b.disabled = !on; });
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', name: myName }));
      ws.send(JSON.stringify({ type: 'list' }));
      enable(true);
      connStatus('Đã kết nối. Chọn phòng để vào hoặc tạo phòng mới.');
    };
    ws.onclose = () => { enable(false); connStatus('Mất kết nối máy chủ. Bấm Làm mới để thử lại.'); };
    ws.onerror = () => connStatus('Lỗi kết nối máy chủ.');
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'rooms') { renderRooms(msg.rooms || []); renderLive(msg.live || []); }
    };
  }

  function requestList() {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'list' }));
    else connect();
  }

  function renderRooms(list) {
    $('room-count').textContent = list.length;
    const box = $('room-list');
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="room-empty">Chưa có phòng nào đang mở. Hãy tạo phòng mới!</div>';
      return;
    }
    list.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'room-item';
      const info = document.createElement('span');
      info.className = 'room-info';
      info.innerHTML = '<b>' + escapeHtml(r.host) + '</b><span class="room-code-sm">#' + escapeHtml(r.code) + '</span>';
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Vào';
      btn.addEventListener('click', () => { location.href = 'play-online.html?join=' + encodeURIComponent(r.code); });
      row.appendChild(info);
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  function renderLive(list) {
    const cnt = $('live-count');
    if (cnt) cnt.textContent = list.length;
    const box = $('live-list');
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="room-empty">Chưa có trận nào đang diễn ra.</div>';
      return;
    }
    list.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'room-item';
      const info = document.createElement('span');
      info.className = 'room-info';
      info.innerHTML =
        '<b>' + escapeHtml(m.red) + '</b> <span class="room-code-sm">đấu</span> <b>' + escapeHtml(m.black) +
        '</b><span class="room-code-sm">' + (m.moves || 0) + ' nước</span>';
      const btn = document.createElement('button');
      btn.className = 'btn btn-accent';
      btn.textContent = '👁 Xem';
      btn.addEventListener('click', () => { location.href = 'spectate.html?code=' + encodeURIComponent(m.code); });
      row.appendChild(info);
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  async function init() {
    try {
      const me = window.API && (await window.API.me());
      if (me && me.user) myName = me.user.username;
    } catch (e) {}

    $('btn-quick').addEventListener('click', () => { location.href = 'play-online.html?quick=1'; });
    $('btn-create').addEventListener('click', () => { location.href = 'play-online.html?create=1'; });
    $('btn-refresh').addEventListener('click', requestList);
    $('btn-join').addEventListener('click', () => {
      const code = ($('join-code').value || '').toUpperCase().trim();
      if (code.length < 3) { connStatus('Nhập mã phòng hợp lệ.'); return; }
      location.href = 'play-online.html?join=' + encodeURIComponent(code);
    });
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

    connect();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
