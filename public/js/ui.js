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
      '.toast-box{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(340px,calc(100vw - 32px))}' +
      '.toast{padding:12px 14px;border-radius:11px;font-size:.88rem;line-height:1.45;font-weight:600;cursor:pointer;' +
      'background:var(--c-card,#1c2836);border:1px solid var(--c-border,#2a3a4d);color:var(--c-text,#e8eef6);' +
      'box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(8px);transition:opacity .18s,transform .18s}' +
      '.toast.show{opacity:1;transform:none}' +
      '.toast.ok{border-color:rgba(16,185,129,.5)}' +
      '.toast.warn{border-color:rgba(239,68,68,.5)}' +
      '.toast.room{border-color:rgba(240,180,41,.55)}' +
      '.toast-sub{display:block;font-weight:400;opacity:.75;font-size:.8rem;margin-top:3px}' +
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
    el.textContent = text;
    if (o.sub) {
      const s = document.createElement('span');
      s.className = 'toast-sub';
      s.textContent = o.sub;
      el.appendChild(s);
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

  window.UI = { refreshAuthUI, toast };
})();
