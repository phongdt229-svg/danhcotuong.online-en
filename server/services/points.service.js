/*
 * points.service.js — Nghiệp vụ nạp điểm qua PayPal.
 *
 * Nguyên tắc an toàn:
 *  1. Số tiền do MÁY CHỦ quyết định khi tạo đơn — client chỉ chọn gói, không gửi số tiền.
 *  2. Điểm chỉ cộng SAU KHI PayPal xác nhận capture COMPLETED, và tính theo số tiền
 *     PayPal thực sự thu được (không tin số tiền do client gửi lên).
 *  3. Mỗi order_id chỉ cộng điểm đúng một lần — chặn bằng UNIQUE KEY + SELECT ... FOR UPDATE.
 */
const pool = require('../config/db');
const paypal = require('./paypal.service');

// 1 USD = 10 điểm (đổi được qua .env nếu sau này thay tỉ giá).
const POINTS_PER_USD = Math.max(1, Number(process.env.POINTS_PER_USD) || 10);

// Các gói cho phép. Client gửi lên `amount`, server chỉ chấp nhận giá trị nằm trong danh sách này.
const PACKAGES = [1, 5, 10, 20, 50];

function pointsFor(amountUsd) {
  return Math.floor(Number(amountUsd) * POINTS_PER_USD);
}

function isValidPackage(amountUsd) {
  const n = Number(amountUsd);
  return Number.isFinite(n) && PACKAGES.some((p) => Math.abs(p - n) < 0.001);
}

function catalog() {
  return {
    pointsPerUsd: POINTS_PER_USD,
    currency: 'USD',
    packages: PACKAGES.map((amount) => ({ amount, points: pointsFor(amount) })),
  };
}

async function getBalance(userId) {
  const [rows] = await pool.query('SELECT points FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0].points : 0;
}

async function history(userId, limit = 20) {
  const [rows] = await pool.query(
    `SELECT id, order_id, amount_usd, points, status, created_at, completed_at
       FROM point_transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, Math.max(1, Math.min(100, limit))]
  );
  return rows;
}

/*
 * Bước 1 — Tạo đơn PayPal và ghi sổ ở trạng thái 'created'.
 * Trả về orderId để nút PayPal ở trình duyệt mở luồng thanh toán.
 */
async function createTopUp(userId, amountUsd) {
  if (!isValidPackage(amountUsd)) {
    const err = new Error('Invalid top-up package.');
    err.status = 400;
    throw err;
  }
  const amount = Number(amountUsd);
  const points = pointsFor(amount);

  const order = await paypal.createOrder({
    amountUsd: amount,
    referenceId: `user-${userId}`,
    description: `${points} points — Xiangqi Online`,
  });

  await pool.query(
    `INSERT INTO point_transactions (user_id, provider, order_id, amount_usd, points, status)
     VALUES (?, 'paypal', ?, ?, ?, 'created')`,
    [userId, order.id, amount.toFixed(2), points]
  );

  return { orderId: order.id, amount, points };
}

/*
 * Bước 2 — Capture đơn rồi cộng điểm.
 * Gọi lại nhiều lần với cùng orderId vẫn an toàn: lần sau chỉ trả về kết quả cũ.
 */
async function completeTopUp(userId, orderId) {
  // Ràng đơn với đúng chủ nhân — người dùng khác không capture hộ được.
  const [rows] = await pool.query(
    'SELECT * FROM point_transactions WHERE provider = ? AND order_id = ? LIMIT 1',
    ['paypal', String(orderId)]
  );
  const tx = rows[0];
  if (!tx || tx.user_id !== userId) {
    const err = new Error('Order not found.');
    err.status = 404;
    throw err;
  }
  if (tx.status === 'completed') {
    return { alreadyCredited: true, points: tx.points, balance: await getBalance(userId) };
  }

  // Gọi PayPal. Nếu đơn đã capture trước đó (mạng chập chờn, bấm hai lần) thì
  // đọc lại đơn để lấy capture cũ thay vì báo lỗi cho người dùng.
  let result = await paypal.captureOrder(tx.order_id);
  let capture = paypal.extractCompletedCapture(result.data);
  if (!capture) {
    const detail = Array.isArray(result.data && result.data.details) && result.data.details[0];
    if (detail && detail.issue === 'ORDER_ALREADY_CAPTURED') {
      const fetched = await paypal.getOrder(tx.order_id);
      capture = paypal.extractCompletedCapture(fetched.data);
    }
  }

  if (!capture) {
    const reason = paypal.describeError(result.data).slice(0, 190);
    await pool
      .query('UPDATE point_transactions SET status = ?, fail_reason = ? WHERE id = ? AND status = ?', [
        'failed',
        reason,
        tx.id,
        'created',
      ])
      .catch(() => {});
    const err = new Error('Payment was not completed. You have not been charged for points.');
    err.status = 402;
    throw err;
  }

  // Tính điểm theo số tiền PayPal THỰC SỰ thu, không theo số đã ghi lúc tạo đơn.
  const paidCurrency = (capture.amount && capture.amount.currency_code) || '';
  const paidValue = Number((capture.amount && capture.amount.value) || 0);
  if (paidCurrency !== 'USD' || !Number.isFinite(paidValue) || paidValue <= 0) {
    const err = new Error('Unexpected payment currency. Please contact support.');
    err.status = 422;
    throw err;
  }
  const creditPoints = pointsFor(paidValue);

  return creditAtomically({
    txId: tx.id,
    userId,
    captureId: capture.id || null,
    paidValue,
    creditPoints,
  });
}

/*
 * Cộng điểm trong một transaction có khoá dòng.
 * SELECT ... FOR UPDATE giữ hàng sổ cái lại, nên hai request capture chạy song song
 * thì chỉ một request thấy trạng thái 'created' và cộng điểm.
 */
async function creditAtomically({ txId, userId, captureId, paidValue, creditPoints }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [locked] = await conn.query('SELECT status, points FROM point_transactions WHERE id = ? FOR UPDATE', [txId]);
    if (locked.length && locked[0].status === 'completed') {
      await conn.commit();
      return { alreadyCredited: true, points: locked[0].points, balance: await getBalance(userId) };
    }

    await conn.query(
      `UPDATE point_transactions
          SET status = 'completed', capture_id = ?, amount_usd = ?, points = ?, completed_at = NOW()
        WHERE id = ?`,
      [captureId, paidValue.toFixed(2), creditPoints, txId]
    );
    await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [creditPoints, userId]);

    const [balRows] = await conn.query('SELECT points FROM users WHERE id = ? LIMIT 1', [userId]);
    await conn.commit();

    return {
      alreadyCredited: false,
      points: creditPoints,
      amount: paidValue,
      balance: balRows.length ? balRows[0].points : 0,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  POINTS_PER_USD,
  PACKAGES,
  catalog,
  pointsFor,
  getBalance,
  history,
  createTopUp,
  completeTopUp,
};
