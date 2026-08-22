/*
 * withdraw.service.js — Rút điểm về PayPal (admin duyệt tay).
 *
 * Luồng:
 *   1. Người dùng gửi yêu cầu -> điểm bị TRỪ NGAY, ghi sổ 'withdraw_hold'.
 *      Trừ ngay để cùng số điểm không thể vừa xin rút vừa đem đi cược.
 *   2. Admin xem trang quản trị, tự chuyển tiền PayPal, rồi đánh dấu "đã trả".
 *   3. Từ chối / người dùng tự huỷ -> HOÀN điểm, ghi sổ 'withdraw_refund'.
 *
 * Mọi chuyển trạng thái đều dùng SELECT ... FOR UPDATE và chỉ chấp nhận khi
 * đang ở 'pending', nên điểm không thể hoàn hai lần.
 */
const pool = require('../config/db');
const ledger = require('./ledger.service');

const POINTS_PER_USD = Math.max(1, Number(process.env.WITHDRAW_POINTS_PER_USD) || Number(process.env.POINTS_PER_USD) || 10);
const MIN_POINTS = Math.max(1, Number(process.env.WITHDRAW_MIN_POINTS) || 1000);
const ENABLED = String(process.env.WITHDRAW_ENABLED || '1') === '1';
// Tài khoản quản trị: mặc định nhận diện theo TÊN 'admin', đổi được qua .env.
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();

const usdFor = (points) => Math.round((points / POINTS_PER_USD) * 100) / 100;

function rules() {
  return { enabled: ENABLED, minPoints: MIN_POINTS, pointsPerUsd: POINTS_PER_USD, minUsd: usdFor(MIN_POINTS) };
}

/*
 * Tìm id tài khoản quản trị: ưu tiên ADMIN_USER_ID, không có thì tra theo tên.
 * Trả về 0 nếu chưa có tài khoản nào khớp.
 */
let adminIdCache = null;
async function adminUserId() {
  const byId = Number(process.env.ADMIN_USER_ID) || 0;
  if (byId > 0) return byId;
  if (adminIdCache !== null) return adminIdCache;
  if (!ADMIN_USERNAME) return (adminIdCache = 0);
  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [ADMIN_USERNAME]);
    return (adminIdCache = rows.length ? rows[0].id : 0);
  } catch (e) {
    return (adminIdCache = 0);
  }
}

async function isAdmin(userId) {
  const admin = await adminUserId();
  return admin > 0 && Number(userId) === admin;
}

const rowPublic = (r) => ({
  id: r.id,
  points: r.points,
  amountUsd: Number(r.amount_usd),
  paypalEmail: r.paypal_email,
  status: r.status,
  adminNote: r.admin_note,
  payoutRef: r.payout_ref,
  createdAt: r.created_at,
  processedAt: r.processed_at,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- Người dùng gửi yêu cầu ---------- */
async function request(userId, points, paypalEmail) {
  if (!ENABLED) {
    const e = new Error('Withdrawals are temporarily unavailable.');
    e.status = 503;
    throw e;
  }
  const email = String(paypalEmail || '').trim();
  const pts = Math.floor(Number(points) || 0);
  if (!EMAIL_RE.test(email) || email.length > 190) {
    const e = new Error('Enter a valid PayPal email address.');
    e.status = 400;
    throw e;
  }
  if (pts < MIN_POINTS) {
    const e = new Error(`Minimum withdrawal is ${MIN_POINTS} points.`);
    e.status = 400;
    throw e;
  }

  // Chỉ cho một yêu cầu đang chờ tại một thời điểm — dễ soát, tránh spam.
  const [pending] = await pool.query("SELECT id FROM withdrawals WHERE user_id = ? AND status = 'pending' LIMIT 1", [userId]);
  if (pending.length) {
    const e = new Error('You already have a withdrawal awaiting review.');
    e.status = 409;
    throw e;
  }

  const usd = usdFor(pts);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Khoá dòng người dùng để số dư không đổi giữa lúc kiểm và lúc trừ.
    const [rows] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!rows.length) {
      const e = new Error('Account not found.');
      e.status = 404;
      throw e;
    }
    if (rows[0].points < pts) {
      const e = new Error(`Not enough points. You have ${rows[0].points}.`);
      e.status = 400;
      throw e;
    }

    await conn.query('UPDATE users SET points = points - ? WHERE id = ?', [pts, userId]);
    const [res] = await conn.query(
      `INSERT INTO withdrawals (user_id, points, amount_usd, paypal_email, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [userId, pts, usd.toFixed(2), email]
    );
    await ledger.record(conn, {
      userId,
      delta: -pts,
      kind: 'withdraw_hold',
      refType: 'withdrawal',
      refId: res.insertId,
      note: `Withdrawal request $${usd.toFixed(2)}`,
    });

    const [bal] = await conn.query('SELECT points FROM users WHERE id = ? LIMIT 1', [userId]);
    await conn.commit();
    return { ok: true, id: res.insertId, points: pts, amountUsd: usd, balance: bal[0].points };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function mine(userId) {
  const [rows] = await pool.query('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 20', [userId]);
  const [bal] = await pool.query('SELECT points FROM users WHERE id = ? LIMIT 1', [userId]);
  return {
    withdrawals: rows.map(rowPublic),
    balance: bal.length ? bal[0].points : 0,
    ...rules(),
  };
}

/* ---------- Admin xem danh sách ---------- */
async function adminList(status = 'pending') {
  const valid = ['pending', 'paid', 'rejected', 'cancelled', 'all'];
  if (!valid.includes(status)) status = 'pending';

  let sql = `SELECT w.*, u.username, u.email AS user_email, u.points AS user_balance
               FROM withdrawals w JOIN users u ON u.id = w.user_id`;
  const args = [];
  if (status !== 'all') {
    sql += ' WHERE w.status = ?';
    args.push(status);
  }
  sql += ' ORDER BY w.id DESC LIMIT 100';
  const [rows] = await pool.query(sql, args);

  const [sum] = await pool.query(`SELECT
      COALESCE(SUM(CASE WHEN status='pending' THEN points ELSE 0 END),0) AS pending_points,
      COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0)      AS pending_count,
      COALESCE(SUM(CASE WHEN status='paid'    THEN amount_usd ELSE 0 END),0) AS paid_usd
    FROM withdrawals`);
  const s = sum[0] || {};

  return {
    withdrawals: rows.map((r) => ({
      ...rowPublic(r),
      userId: r.user_id,
      username: r.username,
      userEmail: r.user_email,
      userBalance: r.user_balance,
    })),
    summary: {
      pendingCount: Number(s.pending_count) || 0,
      pendingPoints: Number(s.pending_points) || 0,
      pendingUsd: usdFor(Number(s.pending_points) || 0),
      paidUsd: Number(s.paid_usd) || 0,
    },
    ...rules(),
  };
}

/*
 * Chuyển một yêu cầu từ 'pending' sang trạng thái cuối.
 *   'paid'                 -> KHÔNG hoàn điểm (điểm đã trừ, tiền đã chuyển tay)
 *   'rejected'/'cancelled' -> HOÀN lại điểm
 * ownerId khác null = người dùng tự huỷ, chỉ được đụng yêu cầu của chính mình.
 */
async function close(id, newStatus, { note = null, ref = null, ownerId = null, adminId = null } = {}) {
  const wid = Number(id) || 0;
  if (wid <= 0) {
    const e = new Error('Missing withdrawal id.');
    e.status = 400;
    throw e;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM withdrawals WHERE id = ? FOR UPDATE', [wid]);
    const w = rows[0];
    if (!w || (ownerId !== null && w.user_id !== ownerId)) {
      const e = new Error('Withdrawal not found.');
      e.status = 404;
      throw e;
    }
    if (w.status !== 'pending') {
      const e = new Error(`This withdrawal was already ${w.status}.`);
      e.status = 409;
      throw e;
    }

    const refund = newStatus !== 'paid';
    if (refund) {
      await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [w.points, w.user_id]);
      await ledger.record(conn, {
        userId: w.user_id,
        delta: w.points,
        kind: 'withdraw_refund',
        refType: 'withdrawal',
        refId: wid,
        note: newStatus === 'cancelled' ? 'Withdrawal cancelled' : 'Withdrawal rejected',
      });
    }

    await conn.query(
      'UPDATE withdrawals SET status = ?, admin_note = ?, payout_ref = ?, processed_at = NOW(), processed_by = ? WHERE id = ?',
      [newStatus, note ? String(note).slice(0, 190) : null, ref ? String(ref).slice(0, 120) : null, adminId, wid]
    );

    const [bal] = await conn.query('SELECT points FROM users WHERE id = ? LIMIT 1', [w.user_id]);
    await conn.commit();
    return { ok: true, id: wid, status: newStatus, refunded: refund, balance: bal.length ? bal[0].points : 0 };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { rules, usdFor, adminUserId, isAdmin, request, mine, adminList, close, MIN_POINTS };
