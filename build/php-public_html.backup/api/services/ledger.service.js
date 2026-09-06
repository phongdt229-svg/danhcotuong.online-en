/*
 * ledger.service.js — Ghi & đọc sổ cái điểm.
 *
 * QUY TẮC: mọi lệnh đổi `users.points` phải ghi kèm một dòng sổ cái TRONG CÙNG
 * transaction (truyền `conn` vào), nếu không lịch sử sẽ lệch với số dư.
 */
const pool = require('../config/db');

const KIND_LABEL = {
  topup: 'Top-up',
  stake_hold: 'Stake placed',
  stake_win: 'Stake won',
  stake_refund: 'Stake refunded',
  house_fee: 'House fee',
  adjust: 'Adjustment',
  withdraw_hold: 'Withdrawal requested',
  withdraw_refund: 'Withdrawal returned',
};

/*
 * Ghi một dòng sổ cái. Phải gọi bên trong transaction đang mở (`conn`),
 * sau khi users.points đã được cập nhật — hàm tự đọc lại số dư mới.
 */
async function record(conn, { userId, delta, kind, refType, refId, note }) {
  const [rows] = await conn.query('SELECT points FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!rows.length) return null;
  const balanceAfter = rows[0].points;
  await conn.query(
    `INSERT INTO point_ledger (user_id, delta, balance_after, kind, ref_type, ref_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, delta, balanceAfter, kind, refType || null, refId || null, note ? String(note).slice(0, 190) : null]
  );
  return balanceAfter;
}

// Ghi cho nhiều người cùng lúc (vd trừ cược cả hai bên).
async function recordMany(conn, userIds, common) {
  for (const userId of userIds) await record(conn, { ...common, userId });
}

/*
 * Lịch sử biến động điểm, mới nhất trước. Phân trang bằng `before` (id) để
 * không lệch khi có giao dịch mới xen vào giữa các trang.
 */
async function history(userId, { limit = 25, before = null, kind = null } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 25));
  const where = ['user_id = ?'];
  const args = [userId];
  if (before) { where.push('id < ?'); args.push(Number(before)); }
  if (kind && KIND_LABEL[kind]) { where.push('kind = ?'); args.push(kind); }
  args.push(lim + 1); // lấy dư 1 dòng để biết còn trang sau không

  const [rows] = await pool.query(
    `SELECT id, delta, balance_after, kind, ref_type, ref_id, note, created_at
       FROM point_ledger
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?`,
    args
  );
  const hasMore = rows.length > lim;
  const entries = (hasMore ? rows.slice(0, lim) : rows).map((r) => ({
    ...r,
    label: KIND_LABEL[r.kind] || r.kind,
  }));
  return { entries, hasMore, nextBefore: entries.length ? entries[entries.length - 1].id : null };
}

// Tổng hợp: đã nạp bao nhiêu, được/mất bao nhiêu vì cược.
async function summary(userId) {
  const [rows] = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN kind = 'topup'         THEN delta ELSE 0 END), 0) AS topped_up,
        COALESCE(SUM(CASE WHEN kind = 'stake_win'     THEN delta ELSE 0 END), 0) AS won,
        COALESCE(SUM(CASE WHEN kind = 'stake_hold'    THEN -delta ELSE 0 END), 0) AS staked,
        COALESCE(SUM(CASE WHEN kind = 'stake_refund'  THEN delta ELSE 0 END), 0) AS refunded,
        COUNT(*) AS entries
       FROM point_ledger WHERE user_id = ?`,
    [userId]
  );
  const s = rows[0] || {};
  const staked = Number(s.staked) || 0;
  const won = Number(s.won) || 0;
  const refunded = Number(s.refunded) || 0;
  return {
    toppedUp: Number(s.topped_up) || 0,
    staked,
    won,
    refunded,
    // Lãi/lỗ ròng từ cược = nhận về (thắng + hoàn) - đã đặt.
    netFromGames: won + refunded - staked,
    entries: Number(s.entries) || 0,
  };
}

module.exports = { KIND_LABEL, record, recordMany, history, summary };
