/*
 * user.routes.js — Thông tin công khai & thống kê người dùng.
 */
const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');

// Bảng xếp hạng (đặt TRƯỚC /:id/stats để không bị nuốt route)
router.get('/leaderboard', async (req, res) => {
  try {
    res.json({ players: await userService.leaderboard(20) });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

router.get('/:id/stats', async (req, res) => {
  try {
    const user = await userService.findById(parseInt(req.params.id, 10));
    if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    res.json({
      username: user.username,
      elo: user.elo,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

module.exports = router;
