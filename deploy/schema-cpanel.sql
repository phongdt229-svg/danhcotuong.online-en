-- schema-cpanel.sql — DÀNH RIÊNG cho cPanel/Plesk
-- KHÔNG có CREATE DATABASE / USE, vì trên cPanel bạn tạo database qua panel
-- (tên sẽ có tiền tố, vd: taikhoan_danhcotuong). Các bước:
--   1. cPanel -> MySQL Databases: tạo database + user, gán user vào database (ALL PRIVILEGES).
--   2. phpMyAdmin -> chọn database vừa tạo -> tab Import -> chọn file này -> Go.
-- (Bảng "sessions" sẽ tự tạo khi app chạy lần đầu — không cần làm gì.)

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  elo           INT          NOT NULL DEFAULT 1000,
  wins          INT          NOT NULL DEFAULT 0,
  losses        INT          NOT NULL DEFAULT 0,
  draws         INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
