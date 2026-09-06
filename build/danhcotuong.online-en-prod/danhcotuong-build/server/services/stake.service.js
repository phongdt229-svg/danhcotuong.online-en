/*
 * stake.service.js — Cược điểm cho ván đấu với người.
 *
 * Luật chia:
 *   - Mỗi bên bị TRỪ `stake` điểm ngay khi ván bắt đầu. Tổng cược (pot) = stake x 2.
 *   - Thắng: người thắng nhận 80% pot, 20% còn lại về admin.
 *   - Hòa: hoàn nguyên tiền cược cho cả hai, admin không lấy gì.
 *   - Ván không bắt đầu được (một bên thiếu điểm): không ai bị trừ.
 *
 * Nguyên tắc an toàn: mọi thay đổi điểm nằm trong transaction có khoá dòng,
 * và mỗi ván chỉ được chia đúng một lần (chốt bằng cột `status`).
 */
const pool = require('./../config/db');
const ledger = require('./ledger.service');

// Cược tối thiểu và tỉ lệ ăn chia — chỉnh được qua .env.
const MIN_STAKE = Math.max(1, Number(process.env.STAKE_MIN) || 150);
const WINNER_PERCENT = Math.min(100, Math.max(0, Number(process.env.STAKE_WINNER_PERCENT) || 80));
// Nếu đặt ADMIN_USER_ID trong .env, phần của admin sẽ cộng thẳng vào tài khoản đó.
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID) || 0;

function isValidStake(stake) {
  const n = Number(stake);
  return Number.isInteger(n) && n >= MIN_STAKE;
}

function splitPot(pot) {
  const winnerPoints = Math.floor((pot * WINNER_PERCENT) / 100);
  return { winnerPoints, housePoints: pot - winnerPoints };
}

function rules() {
  return { minStake: MIN_STAKE, winnerPercent: WINNER_PERCENT, housePercent: 100 - WINNER_PERCENT };
}

async function getPoints(userId) {
  const [rows] = await pool.query('SELECT points FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0].points : 0;
}

/*
 * Trừ điểm cược của cả hai bên và mở sổ ván.
 * Khoá cả hai dòng users theo thứ tự id tăng dần để hai ván chạy song song
 * không khoá chéo nhau (deadlock).
 * Ném lỗi kèm err.userId nếu một bên không đủ điểm — để báo đúng người.
 */
async function openMatch({ code, stake, redUserId, blackUserId }) {
  if (!isValidStake(stake)) {
    const err = new Error(`Stake must be at least ${MIN_STAKE} points.`);
    err.code = 'BAD_STAKE';
    throw err;
  }
  if (!redUserId || !blackUserId || redUserId === blackUserId) {
    const err = new Error('Both players must be signed in.');
    err.code = 'BAD_PLAYERS';
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const ids = [redUserId, blackUserId].sort((a, b) => a - b);
    const [rows] = await conn.query('SELECT id, points FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE', ids);
    if (rows.length !== 2) {
      const err = new Error('Player account not found.');
      err.code = 'NO_USER';
      throw err;
    }
    const short = rows.find((r) => r.points < stake);
    if (short) {
      const err = new Error('Not enough points for this stake.');
      err.code = 'INSUFFICIENT';
      err.userId = short.id;
      err.balance = short.points;
      throw err;
    }

    await conn.query('UPDATE users SET points = points - ? WHERE id IN (?, ?)', [stake, redUserId, blackUserId]);
    const [res] = await conn.query(
      `INSERT INTO stake_matches (code, stake, pot, red_user_id, black_user_id, status)
       VALUES (?, ?, ?, ?, ?, 'playing')`,
      [String(code).slice(0, 12), stake, stake * 2, redUserId, blackUserId]
    );

    await ledger.recordMany(conn, [redUserId, blackUserId], {
      delta: -stake,
      kind: 'stake_hold',
      refType: 'match',
      refId: res.insertId,
      note: `Stake for game ${code}`,
    });

    await conn.commit();
    return { matchId: res.insertId, stake, pot: stake * 2 };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/*
 * Chia điểm khi ván kết thúc.
 *   outcome 'win'   -> winnerUserId nhận 80% pot, admin 20%.
 *   outcome 'draw'  -> hoàn nguyên cược cho cả hai.
 *   outcome 'abort' -> hoàn nguyên cược (ván không đánh được).
 * Gọi lại nhiều lần cho cùng matchId vẫn an toàn: lần sau không chia thêm.
 */
async function settle(matchId, outcome, winnerUserId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM stake_matches WHERE id = ? FOR UPDATE', [matchId]);
    const m = rows[0];
    if (!m) {
      await conn.commit();
      return null;
    }
    if (m.status !== 'playing') {
      await conn.commit();
      return { alreadySettled: true, outcome: m.outcome, winnerPoints: m.winner_points, housePoints: m.house_points };
    }

    let winnerPoints = 0;
    let housePoints = 0;

    if (outcome === 'win' && (winnerUserId === m.red_user_id || winnerUserId === m.black_user_id)) {
      const split = splitPot(m.pot);
      winnerPoints = split.winnerPoints;
      housePoints = split.housePoints;

      await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [winnerPoints, winnerUserId]);
      await ledger.record(conn, {
        userId: winnerUserId,
        delta: winnerPoints,
        kind: 'stake_win',
        refType: 'match',
        refId: matchId,
        note: `Won game ${m.code} (pot ${m.pot})`,
      });

      if (ADMIN_USER_ID && housePoints > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [housePoints, ADMIN_USER_ID]);
        await ledger.record(conn, {
          userId: ADMIN_USER_ID,
          delta: housePoints,
          kind: 'house_fee',
          refType: 'match',
          refId: matchId,
          note: `House fee from game ${m.code}`,
        });
      }
      await conn.query(
        `UPDATE stake_matches
            SET status = 'settled', outcome = 'win', winner_user_id = ?,
                winner_points = ?, house_points = ?, settled_at = NOW()
          WHERE id = ?`,
        [winnerUserId, winnerPoints, housePoints, matchId]
      );
    } else {
      // Hòa hoặc ván hỏng -> trả lại đúng số đã trừ, admin không ăn.
      await conn.query('UPDATE users SET points = points + ? WHERE id IN (?, ?)', [
        m.stake,
        m.red_user_id,
        m.black_user_id,
      ]);
      await ledger.recordMany(conn, [m.red_user_id, m.black_user_id], {
        delta: m.stake,
        kind: 'stake_refund',
        refType: 'match',
        refId: matchId,
        note: outcome === 'draw' ? `Draw in game ${m.code}` : `Game ${m.code} could not be played`,
      });
      await conn.query(
        `UPDATE stake_matches
            SET status = 'refunded', outcome = ?, settled_at = NOW()
          WHERE id = ?`,
        [outcome === 'draw' ? 'draw' : 'abort', matchId]
      );
    }

    await conn.commit();
    return { alreadySettled: false, outcome, winnerPoints, housePoints, stake: m.stake, pot: m.pot };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// Lịch sử ván cược của một người (cho trang hồ sơ).
async function historyForUser(userId, limit = 20) {
  const [rows] = await pool.query(
    `SELECT id, code, stake, pot, outcome, status, winner_user_id, winner_points, created_at, settled_at,
            (winner_user_id = ?) AS i_won
       FROM stake_matches
      WHERE red_user_id = ? OR black_user_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, userId, userId, Math.max(1, Math.min(100, limit))]
  );
  return rows;
}

module.exports = {
  MIN_STAKE,
  WINNER_PERCENT,
  rules,
  isValidStake,
  splitPot,
  getPoints,
  openMatch,
  settle,
  historyForUser,
};
