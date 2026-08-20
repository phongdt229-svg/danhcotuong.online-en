-- schema.sql — Tạo cơ sở dữ liệu & bảng cho Đánh Cờ Tướng Online
-- Chạy: mysql -u root < server/config/schema.sql  (hoặc dùng `npm run init-db`)

CREATE DATABASE IF NOT EXISTS danhcotuong
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE danhcotuong;

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
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;
