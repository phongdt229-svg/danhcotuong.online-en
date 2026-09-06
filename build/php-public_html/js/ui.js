/*
 * ui.js — Dùng chung cho mọi trang: navbar, trạng thái đăng nhập, menu mobile.
 */
(function () {
  'use strict';

  // Áp dụng giao diện đã lưu càng sớm càng tốt (giảm nhấp nháy).
  try {
    const saved = localStorage.getItem('dct-theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) {}

  // Nút đổi Sáng/Tối, chèn vào navbar.
  function wireThemeToggle() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost theme-toggle';
    const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
    const paint = () => {
      btn.textContent = isLight() ? '🌙' : '☀️';
      btn.title = isLight() ? 'Switch to dark theme' : 'Switch to light theme';
    };
    paint();
    btn.addEventListener('click', () => {
      const next = isLight() ? 'dark' : 'light';
      if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('dct-theme', next); } catch (e) {}
      paint();
    });
    const actions = document.querySelector('.nav-actions');
    if (actions) actions.insertBefore(btn, actions.firstChild);
    else {
      const nav = document.querySelector('.nav-inner');
      if (nav) nav.appendChild(btn);
    }
  }

  // Đăng ký Service Worker (cho phép cài app + chơi với máy offline).
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  async function refreshAuthUI() {
    const guest = document.querySelectorAll('[data-auth="guest"]');
    const user = document.querySelectorAll('[data-auth="user"]');
    const nameEls = document.querySelectorAll('[data-user-name]');
    let me = null;
    try {
      me = await window.API.me();
    } catch (e) {
      me = null;
    }
    const loggedIn = me && me.user;
    guest.forEach((el) => (el.style.display = loggedIn ? 'none' : ''));
    user.forEach((el) => (el.style.display = loggedIn ? '' : 'none'));
    if (loggedIn) nameEls.forEach((el) => (el.textContent = me.user.username));
    return me;
  }

  function wireLogout() {
    document.querySelectorAll('[data-action="logout"]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await window.API.logout();
        } catch (err) {}
        location.href = 'index.html';
      });
    });
  }

  function wireMobileMenu() {
    const toggle = document.querySelector('.nav-toggle');
    const menu = document.querySelector('.nav-menu');
    if (toggle && menu) {
      toggle.addEventListener('click', () => menu.classList.toggle('open'));
    }
  }

  // Menu con: bấm "Chơi ▾"/"Đấu online ▾" để mở (chạy cả trên cảm ứng, không chỉ hover).
  function wireSubmenus() {
    document.querySelectorAll('.sub-toggle').forEach((a) => {
      a.addEventListener('click', (e) => {
        const li = a.closest('.has-sub');
        if (!li) return;
        e.preventDefault();
        const wasOpen = li.classList.contains('open');
        document.querySelectorAll('.has-sub.open').forEach((o) => o.classList.remove('open'));
        if (!wasOpen) li.classList.add('open');
      });
    });
    // Bấm ra ngoài -> đóng menu con
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.has-sub')) {
        document.querySelectorAll('.has-sub.open').forEach((o) => o.classList.remove('open'));
      }
    });
  }

  // Nút đóng (×) cho mọi popup: ẩn overlay gần nhất, hoặc điều hướng nếu có data-close-href.
  function wireModalClose() {
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const href = btn.getAttribute('data-close-href');
        if (href) { location.href = href; return; }
        const ov = btn.closest('.overlay');
        if (ov) ov.classList.add('hidden');
      });
    });
  }

  function highlightActive() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu a').forEach((a) => {
      if (a.getAttribute('href') === page) {
        a.classList.add('active');
        // Nếu là mục con -> tô sáng luôn menu cha (Chơi ▾ / Đấu online ▾)
        const sub = a.closest('.sub-menu');
        if (sub) {
          const parentLi = sub.closest('.has-sub');
          const top = parentLi && parentLi.querySelector('a');
          if (top) top.classList.add('active');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireThemeToggle();
    wireMobileMenu();
    wireSubmenus();
    wireModalClose();
    highlightActive();
    if (window.API) {
      refreshAuthUI();
      wireLogout();
    }
  });
  registerSW();

  /* ---------- Thông báo nổi (toast) ---------- */
  // Dùng chung cho mọi trang. CSS nhúng thẳng đây để không phụ thuộc style.css.
  let toastBox = null;
  function ensureToastBox() {
    if (toastBox && document.body.contains(toastBox)) return toastBox;
    const style = document.createElement('style');
    style.textContent =
      '.toast-box{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:min(360px,calc(100vw - 32px))}' +
      '.toast{padding:12px 14px;border-radius:11px;font-size:.88rem;line-height:1.45;font-weight:600;cursor:pointer;' +
      'background:var(--c-card,#1c2836);border:1px solid var(--c-border,#2a3a4d);color:var(--c-text,#e8eef6);' +
      'box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(8px);transition:opacity .18s,transform .18s}' +
      '.toast.show{opacity:1;transform:none}' +
      '.toast.ok{border-color:rgba(16,185,129,.5)}' +
      '.toast.warn{border-color:rgba(239,68,68,.5)}' +
      '.toast-sub{display:block;font-weight:400;opacity:.75;font-size:.8rem;margin-top:3px}' +

      /* Toast PHÒNG MỚI: làm nổi hẳn so với thông báo thường vì đây là thứ cần
         người dùng phản ứng ngay — nền vàng, viền phát sáng nhịp nhàng, có nút. */
      '.toast.room{background:linear-gradient(150deg,#f2b134,#e08c1a);color:#2a1d00;' +
      'border:2px solid rgba(255,220,140,.9);padding:14px 16px;font-size:.95rem;' +
      'box-shadow:0 14px 40px rgba(240,180,41,.45);animation:toast-glow 1.6s ease-in-out infinite}' +
      '.toast.room .toast-sub{opacity:.85;font-weight:600;color:#3d2b00}' +
      '.toast.room:hover{filter:brightness(1.05)}' +
      '.toast-head{display:flex;align-items:center;gap:8px}' +
      '.toast-icon{flex:0 0 30px;width:30px;height:30px;border-radius:8px;display:inline-flex;' +
      'align-items:center;justify-content:center;font-weight:900;font-size:1.05rem;' +
      'background:rgba(0,0,0,.18);color:#2a1d00;font-family:"Noto Serif",serif}' +
      '.toast-cta{display:inline-block;margin-top:9px;padding:6px 14px;border-radius:999px;' +
      'background:#2a1d00;color:#f2b134;font-size:.8rem;font-weight:800;letter-spacing:.02em}' +
      '@keyframes toast-glow{0%,100%{box-shadow:0 14px 40px rgba(240,180,41,.35)}' +
      '50%{box-shadow:0 14px 46px rgba(240,180,41,.75)}}' +
      '@media(prefers-reduced-motion:reduce){.toast.room{animation:none}}' +
      '@media(max-width:600px){.toast-box{left:16px;right:16px;bottom:12px;max-width:none}}';
    document.head.appendChild(style);
    toastBox = document.createElement('div');
    toastBox.className = 'toast-box';
    document.body.appendChild(toastBox);
    return toastBox;
  }

  /*
   * toast(text, {kind, sub, timeout, onClick})
   *   kind: '' | 'ok' | 'warn' | 'room'
   *   sub: dòng phụ nhỏ bên dưới
   *   timeout: ms tự tắt (mặc định 5000, đặt 0 để không tự tắt)
   */
  function toast(text, opts) {
    const o = opts || {};
    const box = ensureToastBox();
    const el = document.createElement('div');
    el.className = 'toast' + (o.kind ? ' ' + o.kind : '');

    // Toast phòng mới có thêm icon quân cờ cho dễ nhận ra giữa các thông báo khác.
    if (o.icon) {
      const head = document.createElement('div');
      head.className = 'toast-head';
      const ic = document.createElement('span');
      ic.className = 'toast-icon';
      ic.textContent = o.icon;
      const tx = document.createElement('span');
      tx.textContent = text;
      head.appendChild(ic);
      head.appendChild(tx);
      el.appendChild(head);
    } else {
      el.textContent = text;
    }

    if (o.sub) {
      const s = document.createElement('span');
      s.className = 'toast-sub';
      s.textContent = o.sub;
      el.appendChild(s);
    }
    // Nút hành động: nói thẳng bấm vào sẽ được gì, thay vì để người dùng đoán.
    if (o.cta) {
      const c = document.createElement('span');
      c.className = 'toast-cta';
      c.textContent = o.cta;
      el.appendChild(c);
    }
    const close = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 200);
    };
    el.addEventListener('click', () => {
      if (o.onClick) o.onClick();
      close();
    });
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const ms = o.timeout === 0 ? 0 : o.timeout || 5000;
    if (ms) setTimeout(close, ms);
    // Giữ tối đa 4 thông báo, cũ nhất rơi ra trước.
    while (box.children.length > 4) box.firstElementChild.remove();
    return el;
  }

  /* ---------- Theo dõi phòng mới trên TOÀN SITE ---------- */
  /*
   * Trang Play vs Human tự lo phần này cho sảnh của nó. Đoạn dưới dành cho MỌI
   * trang còn lại: đang đọc trang chủ, xem bảng xếp hạng hay chơi với máy mà có
   * người mở phòng thì vẫn nhận được thông báo, bấm vào là vào thẳng phòng đó.
   */
  const ROOM_POLL_MS = 8000; // thưa hơn sảnh (4s) vì đây là nền, chạy ở mọi trang
  let seenRooms = null;      // null = lần nạp đầu, chỉ ghi nhớ chứ không báo
  let myBalance = 0;
  let isGuest = true;        // khách CHƯA đăng nhập vẫn được nhận thông báo

  async function watchRooms() {
    try {
      const data = await window.API.matchList();
      const list = (data && data.rooms) || [];
      const now = new Set(list.map((r) => r.code));

      if (seenRooms !== null) {
        list.forEach((r) => {
          if (seenRooms.has(r.code)) return;
          const stake = Number(r.stake) || 0;
          const pts = stake.toLocaleString('en-US');
          const enough = !isGuest && stake <= myBalance;

          // Ba trường hợp, mỗi trường hợp dẫn người dùng tới đúng nơi cần đến.
          let sub, go, cta;
          if (isGuest) {
            sub = '💰 ' + pts + ' points stake';
            cta = 'Sign in to play →';
            go = 'play-online.html?join=' + encodeURIComponent(r.code);
          } else if (enough) {
            sub = '💰 ' + pts + ' points stake · room #' + r.code;
            cta = '▶ Join now';
            go = 'play-online.html?join=' + encodeURIComponent(r.code);
          } else {
            sub = '💰 ' + pts + ' points stake · you need ' +
                  (stake - myBalance).toLocaleString('en-US') + ' more';
            cta = 'Buy points →';
            go = 'topup.html';
          }

          toast(r.host + ' opened a room', {
            kind: 'room',
            icon: '將',
            sub: sub,
            cta: cta,
            timeout: 12000, // để lâu hơn: đây là thứ cần người dùng phản ứng
            onClick: () => { location.href = go; },
          });
        });
      }
      seenRooms = now;
    } catch (e) {
      /* mất mạng / endpoint chưa có -> im lặng, lần sau thử lại */
    }
  }

  async function startRoomWatch() {
    // Sảnh đấu online đã có bộ theo dõi riêng, chạy thêm ở đây sẽ báo trùng.
    const page = location.pathname.split('/').pop() || 'index.html';
    if (page === 'play-online.html') return;
    if (!window.API || !window.API.matchList) return;

    // Khách vãng lai VẪN theo dõi — thấy có phòng mới là một lý do để đăng ký.
    let me = null;
    try { me = await window.API.me(); } catch (e) {}
    isGuest = !(me && me.user);
    myBalance = isGuest ? 0 : Number(me.user.points) || 0;

    await watchRooms(); // lần đầu chỉ ghi nhớ danh sách hiện có
    setInterval(watchRooms, ROOM_POLL_MS);
  }

  document.addEventListener('DOMContentLoaded', startRoomWatch);

  window.UI = { refreshAuthUI, toast };
})();
