-- =============================================================================
--  schema-production.sql — Cấu trúc DATABASE đầy đủ cho Chinesechess Online
-- =============================================================================
--
--  Dùng khi lên hosting mới, import một lần là xong.
--
--  Cách 1 — phpMyAdmin / cPanel:
--      Tạo database trước trong cPanel, mở phpMyAdmin, chọn database đó,
--      vào tab Import và tải file này lên.
--
--  Cách 2 — dòng lệnh:
--      mysql -u <user> -p <ten_database> < deploy/schema-production.sql
--
--  Ghi chú:
--   * File này chỉ tạo BẢNG, không tạo database (hosting thường tự tạo sẵn,
--     và tên database do hosting quy định, vd: user_chinesechess).
--     Nếu tự quản server, bỏ chú thích 2 dòng CREATE DATABASE/USE bên dưới.
--   * Chạy lại nhiều lần vẫn an toàn: đều là CREATE TABLE IF NOT EXISTS.
--   * Không bắt buộc phải import: server tự tạo bảng khi khởi động
--     (server/config/ensureSchema.js). File này dành cho hosting không cho
--     chạy lệnh, hoặc khi muốn tạo sẵn trước khi deploy.
--   * Thứ tự bảng đã sắp theo khoá ngoại — đừng đảo thứ tự.
--
--  Đối chiếu tổng quan:
--      users              người dùng + số dư điểm
--      games              lịch sử ván đấu (vs máy và vs người)
--      point_transactions đơn nạp điểm qua PayPal
--      stake_matches      sổ ván cược điểm (đấu với người)
--      point_ledger       sổ cái: TỪNG biến động điểm (nguồn của trang lịch sử)
--      sessions           phiên đăng nhập (express-mysql-session)
-- =============================================================================

-- CREATE DATABASE IF NOT EXISTS `chinesechess` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE `chinesechess`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- -----------------------------------------------------------------------------
-- users — tài khoản, thống kê cờ và SỐ DƯ ĐIỂM.
-- `points` là số dư hiện tại; mọi thay đổi của nó đều phải ghi kèm một dòng
-- trong point_ledger (xem server/services/ledger.service.js).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- games — lịch sử ván đã lưu (dùng cho trang Hồ sơ và Xem lại).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- point_transactions — đơn nạp điểm qua PayPal.
-- UNIQUE (provider, order_id) là chốt chặn chống cộng điểm hai lần cho cùng
-- một đơn, kể cả khi client gọi capture lặp lại.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS point_transactions (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- stake_matches — sổ ván cược điểm khi đấu với người.
-- Điểm bị TRỪ lúc ván bắt đầu và chỉ chia lại đúng một lần lúc kết thúc;
-- cột `status` là chốt chặn chống chia hai lần.
-- Cố ý KHÔNG đặt khoá ngoại tới users để lịch sử ván vẫn còn khi xoá tài khoản.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stake_matches (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- point_ledger — sổ cái điểm: ghi TỪNG biến động của mỗi người.
-- Mỗi dòng được ghi trong CÙNG transaction với lệnh đổi users.points, nên
-- SUM(delta) của một người luôn bằng users.points của người đó.
-- Dùng câu này để soát sổ:
--   SELECT u.id, u.points, COALESCE(SUM(l.delta),0) AS ledger_total
--     FROM users u LEFT JOIN point_ledger l ON l.user_id = u.id
--    GROUP BY u.id HAVING u.points <> ledger_total;
--   (không trả về dòng nào = sổ sách khớp)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS point_ledger (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- sessions — phiên đăng nhập, do express-mysql-session quản lý.
-- Collation utf8mb4_bin của session_id là bắt buộc (thư viện so khớp phân biệt
-- hoa thường). Bảng này server tự tạo được, đưa vào đây cho đủ bộ.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  expires    INT(11) UNSIGNED NOT NULL,
  data       MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
--  Sau khi import xong
-- =============================================================================
--  1. Tạo tài khoản admin: đăng ký bình thường qua trang web, rồi lấy id:
--         SELECT id, username FROM users WHERE username = 'admin';
--     Đặt id đó vào ADMIN_USER_ID trong .env để nhận 20% hoa hồng ván cược.
--
--  2. Kiểm tra nhanh:
--         SHOW TABLES;                  -- mong đợi 6 bảng
--         SELECT COUNT(*) FROM users;   -- 0 nếu là DB mới
-- =============================================================================
