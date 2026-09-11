/*
 * topup.js — Trang nạp điểm: chọn gói, thanh toán bằng PayPal, xem lịch sử giao dịch.
 *
 * Trình duyệt KHÔNG bao giờ gửi số điểm lên máy chủ — chỉ gửi gói đã chọn.
 * Máy chủ tự tính điểm từ số tiền PayPal thu được.
 */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const state = { amount: null, config: null, rendered: false };

  function setStatus(message, kind) {
    const box = el('status');
    box.textContent = message || '';
    box.className = 'topup-status' + (kind ? ' ' + kind : '');
    box.style.display = message ? '' : 'none';
  }

  function fmtUsd(v) {
    return '$' + Number(v).toFixed(2);
  }

  function paintBalance(points) {
    el('balance').textContent = Number(points).toLocaleString('en-US');
  }

  /* ---------- Chọn gói ---------- */
  function renderPackages(cfg) {
    const wrap = el('packages');
    wrap.innerHTML = '';
    cfg.packages.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pkg';
      btn.dataset.amount = String(p.amount);
      btn.innerHTML =
        '<span class="pkg-points">' +
        p.points.toLocaleString('en-US') +
        '</span><span class="pkg-unit">points</span><span class="pkg-price">' +
        fmtUsd(p.amount) +
        '</span>';
      btn.addEventListener('click', () => selectPackage(p.amount));
      wrap.appendChild(btn);
      if (i === 0) selectPackage(p.amount);
    });
  }

  function selectPackage(amount) {
    state.amount = amount;
    document.querySelectorAll('.pkg').forEach((b) => {
      b.classList.toggle('selected', Math.abs(Number(b.dataset.amount) - amount) < 0.001);
    });
    setStatus('');
  }

  /* ---------- Nút PayPal ---------- */
  function loadPayPalSdk(clientId) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // disable-funding=card: ẩn nút "Debit or Credit Card", chỉ để lại nút PayPal.
      s.src =
        'https://www.paypal.com/sdk/js?client-id=' +
        encodeURIComponent(clientId) +
        '&currency=USD&intent=capture&components=buttons&disable-funding=card';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load PayPal.'));
      document.head.appendChild(s);
    });
  }

  function renderButtons() {
    if (state.rendered) return;
    state.rendered = true;

    window.paypal
      .Buttons({
        // height ghim 45px: dung bang nut 'Pay by card' (.btn-stripe) — doi mot ben thi doi ca hai.
        style: { layout: 'vertical', shape: 'rect', label: 'paypal', height: 45 },

        // Máy chủ tạo đơn — trình duyệt chỉ nói "tôi chọn gói này".
        createOrder: async function () {
          setStatus('Creating your order…', 'info');
          const out = await window.API.payCreateOrder(state.amount);
          setStatus('');
          return out.orderId;
        },

        // Thanh toán xong -> máy chủ thu tiền và cộng điểm.
        onApprove: async function (data) {
          setStatus('Confirming your payment…', 'info');
          try {
            const out = await window.API.payCapture(data.orderID);
            paintBalance(out.balance);
            setStatus(
              out.alreadyCredited
                ? 'This payment was already credited. Your balance is up to date.'
                : 'Payment complete — ' + out.points.toLocaleString('en-US') + ' points added to your account.',
              'ok'
            );
            loadHistory();
          } catch (err) {
            setStatus(err.message || 'We could not confirm your payment.', 'err');
          }
        },

        onCancel: function () {
          setStatus('Payment cancelled. You have not been charged.', 'info');
        },

        onError: function (err) {
          console.error('PayPal error:', err);
          setStatus('Something went wrong with PayPal. Please try again.', 'err');
        },
      })
      .render('#paypal-buttons')
      .catch(() => setStatus('Could not display the PayPal buttons.', 'err'));
  }

  /* ---------- Thanh toán bằng thẻ (Stripe Checkout) ---------- */
  function setupStripe(cfg) {
    const box = el('stripe-pay');
    if (!box) return;
    // Máy chủ chưa cấu hình Stripe (hoặc đang chạy backend Node chưa có Stripe) -> ẩn hẳn.
    if (!cfg.stripeConfigured) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    if (cfg.stripeMode === 'test') {
      const note = el('stripe-test-note');
      if (note) note.style.display = '';
    }

    const btn = el('stripe-btn');
    btn.addEventListener('click', async function () {
      if (!state.amount) {
        setStatus('Please pick a package first.', 'err');
        return;
      }
      btn.disabled = true;
      setStatus('Taking you to the secure card payment page…', 'info');
      try {
        // Máy chủ tạo phiên và quyết số tiền — trình duyệt chỉ nói "tôi chọn gói này".
        const out = await window.API.payStripeSession(state.amount);
        window.location.assign(out.url);
      } catch (err) {
        btn.disabled = false;
        setStatus(err.message || 'Could not start the card payment. Please try again.', 'err');
      }
    });
  }

  // Khách vừa từ Stripe quay về. Webhook có thể đã cộng điểm trước rồi —
  // khi đó máy chủ trả alreadyCredited, không cộng lần hai.
  async function handleStripeReturn() {
    const q = new URLSearchParams(window.location.search);
    const sessionId = q.get('stripe_session_id');
    const cancelled = q.get('stripe_cancelled');
    if (!sessionId && !cancelled) return;

    // Dọn tham số khỏi thanh địa chỉ để F5 không chạy lại bước xác nhận.
    window.history.replaceState({}, '', window.location.pathname);

    if (cancelled) {
      setStatus('Card payment cancelled. You have not been charged.', 'info');
      return;
    }

    setStatus('Confirming your card payment…', 'info');
    try {
      const out = await window.API.payStripeConfirm(sessionId);
      paintBalance(out.balance);
      setStatus(
        out.alreadyCredited
          ? 'This payment was already credited. Your balance is up to date.'
          : 'Payment complete — ' + out.points.toLocaleString('en-US') + ' points added to your account.',
        'ok'
      );
      loadHistory();
    } catch (err) {
      setStatus(err.message || 'We could not confirm your card payment.', 'err');
    }
  }
  /* ---------- Lịch sử giao dịch ---------- */
  async function loadHistory() {
    const body = el('history-body');
    try {
      const { transactions } = await window.API.payHistory();
      if (!transactions.length) {
        body.innerHTML = '<tr><td colspan="4" class="text-muted">No top-ups yet.</td></tr>';
        return;
      }
      const label = {
        completed: ['win', 'Completed'],
        created: ['draw', 'Pending'],
        failed: ['loss', 'Failed'],
      };
      body.innerHTML = transactions
        .map((t) => {
          const b = label[t.status] || ['draw', t.status];
          const when = new Date(t.completed_at || t.created_at).toLocaleString('en-US');
          return (
            '<tr><td>' +
            when +
            '</td><td>' +
            fmtUsd(t.amount_usd) +
            '</td><td>' +
            Number(t.points).toLocaleString('en-US') +
            '</td><td><span class="badge ' +
            b[0] +
            '">' +
            b[1] +
            '</span></td></tr>'
          );
        })
        .join('');
    } catch (e) {
      body.innerHTML = '<tr><td colspan="4" class="text-muted">Could not load your history.</td></tr>';
    }
  }

  /* ---------- Khởi động ---------- */
  document.addEventListener('DOMContentLoaded', async function () {
    let me = null;
    try {
      me = await window.API.me();
    } catch (e) {}
    if (!me || !me.user) {
      el('guard').style.display = '';
      return;
    }
    el('content').style.display = '';
    paintBalance(me.user.points || 0);

    let cfg;
    try {
      cfg = await window.API.payConfig();
    } catch (e) {
      setStatus('Could not load payment settings.', 'err');
      return;
    }
    state.config = cfg;
    el('rate').textContent = '$1 = ' + cfg.pointsPerUsd + ' points';
    renderPackages(cfg);
    loadHistory();

    // Stripe chay doc lap voi PayPal: thieu PayPal van tra the duoc.
    setupStripe(cfg);
    handleStripeReturn();

    if (!cfg.configured) {
      if (!cfg.stripeConfigured) setStatus('Payments are not configured on this server yet.', 'err');
      return;
    }
    if (cfg.mode === 'sandbox') el('sandbox-note').style.display = '';

    try {
      await loadPayPalSdk(cfg.clientId);
      renderButtons();
    } catch (e) {
      setStatus('Could not load PayPal. Check your connection and reload.', 'err');
    }
  });
})();
