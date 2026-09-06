/*
 * withdraw.routes.js — Rút điểm về PayPal (admin duyệt tay).
 * Quyền admin do server quyết định (withdraw.service.isAdmin), không tin client.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const wd = require('../services/withdraw.service');
const pointsService = require('../services/points.service');

// Chặn mọi endpoint quản trị cho người không phải admin.
async function requireAdmin(req, res, next) {
  try {
    const adminId = await wd.adminUserId();
    if (adminId <= 0) return res.status(503).json({ error: 'Admin account is not configured on this server.' });
    if (req.session.userId !== adminId) return res.status(403).json({ error: 'Admin only.' });
    req.adminId = adminId;
    next();
  } catch (err) {
    next(err);
  }
}

// Luật rút (cho giao diện hiển thị).
router.get('/rules', async (req, res, next) => {
  try {
    const uid = req.session.userId;
    res.json({
      ...wd.rules(),
      balance: uid ? await pointsService.getBalance(uid) : 0,
      isAdmin: uid ? await wd.isAdmin(uid) : false,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/request', requireAuth, async (req, res, next) => {
  try {
    res.status(201).json(await wd.request(req.session.userId, req.body.points, req.body.paypalEmail));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    res.json(await wd.mine(req.session.userId));
  } catch (err) {
    next(err);
  }
});

// Người dùng tự huỷ khi chưa được duyệt -> hoàn điểm.
router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    res.json(await wd.close(req.body.id, 'cancelled', { ownerId: req.session.userId }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/admin/list', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json(await wd.adminList(req.query.status));
  } catch (err) {
    next(err);
  }
});

// Đánh dấu ĐÃ TRẢ — không hoàn điểm (tiền đã chuyển tay ngoài hệ thống).
router.post('/admin/paid', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json(await wd.close(req.body.id, 'paid', { note: req.body.note, ref: req.body.payoutRef, adminId: req.adminId }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// TỪ CHỐI -> hoàn lại toàn bộ điểm.
router.post('/admin/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json(await wd.close(req.body.id, 'rejected', { note: req.body.note, adminId: req.adminId }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
