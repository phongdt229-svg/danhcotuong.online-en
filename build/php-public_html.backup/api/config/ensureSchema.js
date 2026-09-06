/*
 * ensureSchema.js — Tự tạo các bảng cần thiết khi khởi động (idempotent).
 *
 * Hữu ích khi deploy lên cloud mà không chạy được `npm run init-db`:
 * chỉ cần database đã tồn tại (nhà cung cấp DB cấp sẵn), app sẽ tự tạo bảng.
 * Dùng CREATE TABLE IF NOT EXISTS nên chạy nhiều lần vẫn an toàn.
 * (Bảng `sessions` do express-mysql-session tự tạo riêng.)
 */
const pool = require('./db');

const USERS = `CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  elo           INT          NOT NULL DEFAULT 1000,
  wins          INT          NOT NULL DEFAULT 0,
  losses        INT          NOT NULL DEFAULT 0,
  draws         INT          NOT NULL DEFAULT 0,
  points        INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const GAMES = `CREATE TABLE IF NOT EXISTS games (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  opponent_type VARCHAR(40)  NOT NULL DEFAULT 'ai',
  result        ENUM('win','loss','draw') NOT NULL,
  moves_count   INT          NOT NULL DEFAULT 0,
  duration_sec  INT          NOT NULL DEFAULT 0,
  pgn           TEXT         NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_games_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_games_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/*
 * Sổ cái nạp điểm. `order_id` UNIQUE là chốt chặn chống cộng điểm hai lần:
 * dù client gọi capture lặp lại, hàng đã 'completed' sẽ không cộng thêm.
 */
const POINT_TRANSACTIONS = `CREATE TABLE IF NOT EXISTS point_transactions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT           NOT NULL,
  provider     VARCHAR(20)   NOT NULL DEFAULT 'paypal',
  order_id     VARCHAR(64)   NOT NULL,
  capture_id   VARCHAR(64)   NULL,
  amount_usd   DECIMAL(10,2) NOT NULL,
  points       INT           NOT NULL,
  status       ENUM('created','completed','failed') NOT NULL DEFAULT 'created',
  fail_reason  VARCHAR(190)  NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME      NULL,
  UNIQUE KEY uq_provider_order (provider, order_id),
  CONSTRAINT fk_ptx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ptx_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/*
 * Sổ cái ván cược điểm (đấu với người).
 * Điểm bị TRỪ khi ván bắt đầu và chỉ được chia lại đúng một lần khi ván kết thúc —
 * cột `status` là chốt chặn chống chia điểm hai lần.
 */
const STAKE_MATCHES = `CREATE TABLE IF NOT EXISTS stake_matches (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  code           VARCHAR(12) NOT NULL,
  stake          INT         NOT NULL,
  pot            INT         NOT NULL DEFAULT 0,
  red_user_id    INT         NULL,
  black_user_id  INT         NULL,
  status         ENUM('playing','settled','refunded') NOT NULL DEFAULT 'playing',
  outcome        ENUM('win','draw','abort') NULL,
  winner_user_id INT         NULL,
  winner_points  INT         NOT NULL DEFAULT 0,
  house_points   INT         NOT NULL DEFAULT 0,
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at     DATETIME    NULL,
  INDEX idx_stake_code (code, status),
  INDEX idx_stake_red (red_user_id, created_at),
  INDEX idx_stake_black (black_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/*
 * Sổ cái điểm — ghi TỪNG biến động điểm của mỗi người.
 *
 * Mỗi dòng được ghi trong CÙNG transaction với lệnh đổi users.points, nên
 * tổng các delta luôn khớp số dư hiện tại. `balance_after` lưu số dư ngay sau
 * biến động để tra cứu lịch sử không cần cộng dồn lại.
 */
const POINT_LEDGER = `CREATE TABLE IF NOT EXISTS point_ledger (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT         NOT NULL,
  delta         INT         NOT NULL,
  balance_after INT         NOT NULL,
  kind          ENUM('topup','stake_hold','stake_win','stake_refund','house_fee','adjust') NOT NULL,
  ref_type      VARCHAR(20) NULL,
  ref_id        INT         NULL,
  note          VARCHAR(190) NULL,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ledger_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/*
 * Yêu cầu rút điểm về PayPal (admin duyệt tay).
 * Điểm bị GIỮ (trừ khỏi số dư) ngay khi gửi yêu cầu nên không thể tiêu hai lần.
 * 'paid' = đã chuyển tiền (không hoàn điểm); 'rejected'/'cancelled' = hoàn lại điểm.
 */
const WITHDRAWALS = `CREATE TABLE IF NOT EXISTS withdrawals (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT           NOT NULL,
  points       INT           NOT NULL,
  amount_usd   DECIMAL(10,2) NOT NULL,
  paypal_email VARCHAR(190)  NOT NULL,
  status       ENUM('pending','paid','rejected','cancelled') NOT NULL DEFAULT 'pending',
  admin_note   VARCHAR(190)  NULL,
  payout_ref   VARCHAR(120)  NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME      NULL,
  processed_by INT           NULL,
  CONSTRAINT fk_wd_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_wd_user (user_id, id),
  INDEX idx_wd_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/*
 * Thêm cột vào bảng đã tồn tại từ trước.
 * Không dùng "ADD COLUMN IF NOT EXISTS" vì đó là cú pháp riêng của MariaDB —
 * hỏi information_schema để chạy được trên cả MySQL khi deploy cloud.
 */
async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  if (rows.length) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`✓ Đã thêm cột ${table}.${column}`);
}

module.exports = async function ensureSchema() {
  await pool.query(USERS);
  await pool.query(GAMES);
  await pool.query(POINT_TRANSACTIONS);
  await pool.query(STAKE_MATCHES);
  await addColumnIfMissing('users', 'points', 'INT NOT NULL DEFAULT 0 AFTER draws');
  await pool.query(POINT_LEDGER); // sau users vì có khoá ngoại tới users
  await pool.query(WITHDRAWALS);

  // Bổ sung 2 loại biến động mới cho sổ cái đã tạo từ trước (bản cũ chỉ có 6 loại).
  await pool
    .query(
      `ALTER TABLE point_ledger MODIFY COLUMN kind
       ENUM('topup','stake_hold','stake_win','stake_refund','house_fee','adjust','withdraw_hold','withdraw_refund') NOT NULL`
    )
    .catch(() => {}); // đã đủ loại thì bỏ qua
};
