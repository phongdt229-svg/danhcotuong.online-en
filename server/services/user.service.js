/*
 * user.service.js — Nghiệp vụ người dùng: đăng ký, xác thực, thống kê.
 */
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const PUBLIC_FIELDS = 'id, username, email, elo, wins, losses, draws, created_at';

async function findByUsername(username) {
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function emailExists(email) {
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  return rows.length > 0;
}

async function createUser({ username, email, password }) {
  const hash = await bcrypt.hash(password, 10);
  const [res] = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    [username, email, hash]
  );
  return findById(res.insertId);
}

async function verifyCredentials(username, password) {
  const user = await findByUsername(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return findById(user.id);
}

// Cập nhật thống kê + ELO đơn giản sau mỗi ván vs AI
async function applyResult(userId, result) {
  const col = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
  const delta = result === 'win' ? 12 : result === 'loss' ? -10 : 2;
  await pool.query(
    `UPDATE users SET ${col} = ${col} + 1, elo = GREATEST(100, elo + ?) WHERE id = ?`,
    [delta, userId]
  );
}

// Bảng xếp hạng theo ELO (cao thủ nhất lên đầu).
async function leaderboard(limit = 20) {
  const [rows] = await pool.query(
    `SELECT id, username, elo, wins, losses, draws
     FROM users ORDER BY elo DESC, wins DESC, id ASC LIMIT ?`,
    [Math.max(1, Math.min(100, limit))]
  );
  return rows;
}

module.exports = {
  findByUsername,
  findById,
  emailExists,
  createUser,
  verifyCredentials,
  applyResult,
  leaderboard,
};
