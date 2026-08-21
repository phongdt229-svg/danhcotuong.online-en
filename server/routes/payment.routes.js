/*
 * payment.routes.js — Nạp điểm bằng PayPal.
 *
 * Luồng: client bấm nút PayPal
 *   -> POST /api/payments/paypal/order   (server tạo đơn, trả orderId)
 *   -> người dùng trả tiền trên cửa sổ PayPal
 *   -> POST /api/payments/paypal/capture (server thu tiền + cộng điểm)
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const pointsService = require('../services/points.service');
const paypal = require('../services/paypal.service');
const ledgerService = require('../services/ledger.service');

// Giới hạn số đơn tạo mới theo người dùng (tránh spam tạo đơn lên PayPal).
const orderAttempts = new Map(); // userId -> { count, ts }
const RL_WINDOW = 10 * 60 * 1000; // 10 phút
const RL_MAX = 20;
function limitOrders(req, res, next) {
  const key = req.session.userId;
  const now = Date.now();
  const rec = orderAttempts.get(key);
  if (!rec || now - rec.ts > RL_WINDOW) {
    orderAttempts.set(key, { count: 1, ts: now });
  } else {
    rec.count += 1;
    if (rec.count > RL_MAX) {
      return res.status(429).json({ error: 'Too many top-up attempts. Please wait a few minutes.' });
    }
  }
  if (orderAttempts.size > 5000) {
    for (const [k, v] of orderAttempts) if (now - v.ts > RL_WINDOW) orderAttempts.delete(k);
  }
  next();
}

// Cấu hình công khai cho trình duyệt (client-id của PayPal vốn là thông tin công khai).
router.get('/config', (req, res) => {
  res.json({
    configured: paypal.isConfigured(),
    clientId: paypal.clientId(),
    mode: paypal.isLive() ? 'live' : 'sandbox',
    ...pointsService.catalog(),
  });
});

router.get('/balance', requireAuth, async (req, res, next) => {
  try {
    res.json({ balance: await pointsService.getBalance(req.session.userId) });
  } catch (err) {
    next(err);
  }
});

router.get('/history', requireAuth, async (req, res, next) => {
  try {
    res.json({ transactions: await pointsService.history(req.session.userId, 20) });
  } catch (err) {
    next(err);
  }
});

/*
 * Lịch sử biến động điểm (nạp vào / trừ ra) — đọc từ sổ cái nên khớp tuyệt đối với số dư.
 * ?limit=25&before=<id>&kind=topup|stake_hold|stake_win|stake_refund|house_fee
 */
router.get('/ledger', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const page = await ledgerService.history(userId, {
      limit: req.query.limit,
      before: req.query.before,
      kind: req.query.kind,
    });
    res.json({
      ...page,
      balance: await pointsService.getBalance(userId),
      summary: await ledgerService.summary(userId),
    });
  } catch (err) {
    next(err);
  }
});

// Tạo đơn. Client chỉ gửi `amount` (một trong các gói hợp lệ), server tự quyết số điểm.
router.post('/paypal/order', requireAuth, limitOrders, async (req, res) => {
  try {
    if (!paypal.isConfigured()) {
      return res.status(503).json({ error: 'Payments are not available right now.' });
    }
    const out = await pointsService.createTopUp(req.session.userId, req.body.amount);
    res.status(201).json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('paypal order error:', err.message);
    res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
});

// Thu tiền + cộng điểm. Gọi lại cùng orderId vẫn an toàn (không cộng điểm hai lần).
router.post('/paypal/capture', requireAuth, async (req, res) => {
  try {
    const orderId = String(req.body.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Missing order id.' });

    const out = await pointsService.completeTopUp(req.session.userId, orderId);
    res.json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('paypal capture error:', err.message);
    res.status(502).json({ error: 'Could not confirm the payment. Please contact support if you were charged.' });
  }
});

module.exports = router;
