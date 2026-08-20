/*
 * game.service.js — Lưu & đọc ván đấu.
 */
const pool = require('../config/db');

async function saveGame(userId, g) {
  const [res] = await pool.query(
    `INSERT INTO games (user_id, opponent_type, result, moves_count, duration_sec, pgn)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      g.opponent_type || 'ai',
      g.result,
      g.moves_count || 0,
      g.duration_sec || 0,
      g.pgn || null,
    ]
  );
  return res.insertId;
}

async function listByUser(userId, limit = 20) {
  const [rows] = await pool.query(
    `SELECT id, opponent_type, result, moves_count, duration_sec, created_at
     FROM games WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows;
}

// Lấy 1 ván của chính người dùng (kèm pgn để xem lại).
async function getById(userId, id) {
  const [rows] = await pool.query(
    `SELECT id, opponent_type, result, moves_count, duration_sec, pgn, created_at
     FROM games WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId]
  );
  return rows[0] || null;
}

module.exports = { saveGame, listByUser, getById };
