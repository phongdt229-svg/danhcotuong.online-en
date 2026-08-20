/*
 * game.routes.js — Lưu kết quả ván & lấy lịch sử của người dùng hiện tại.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const gameService = require('../services/game.service');
const userService = require('../services/user.service');

const VALID_RESULTS = ['win', 'loss', 'draw'];

router.post('/', requireAuth, async (req, res) => {
  try {
    const result = req.body.result;
    if (!VALID_RESULTS.includes(result))
      return res.status(400).json({ error: 'Kết quả không hợp lệ' });

    const game = {
      opponent_type: String(req.body.opponent_type || 'ai').slice(0, 40),
      result,
      moves_count: Math.max(0, parseInt(req.body.moves_count, 10) || 0),
      duration_sec: Math.max(0, parseInt(req.body.duration_sec, 10) || 0),
      pgn: req.body.pgn || null,
    };
    const id = await gameService.saveGame(req.session.userId, game);
    await userService.applyResult(req.session.userId, result);
    res.status(201).json({ id });
  } catch (err) {
    console.error('save game error:', err.message);
    res.status(500).json({ error: 'Không lưu được ván đấu' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const games = await gameService.listByUser(req.session.userId);
    res.json({ games });
  } catch (err) {
    console.error('list games error:', err.message);
    res.status(500).json({ error: 'Không tải được lịch sử' });
  }
});

// Chi tiết 1 ván (kèm pgn) để xem lại — chỉ chủ ván mới xem được.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const game = await gameService.getById(req.session.userId, parseInt(req.params.id, 10));
    if (!game) return res.status(404).json({ error: 'Không tìm thấy ván đấu' });
    res.json({ game });
  } catch (err) {
    console.error('get game error:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

module.exports = router;
