-- schema.sql — Tạo DATABASE cho ứng dụng.
-- Chạy: npm run init-db
--
-- Lưu ý: các BẢNG do server tự tạo khi khởi động (server/config/ensureSchema.js),
-- nên file này chỉ cần lo tạo database. Nhờ vậy schema không bị lệch hai nơi
-- mỗi khi thêm bảng mới (point_transactions, stake_matches, point_ledger...).
--
-- Tên database lấy từ DB_NAME trong .env; init-db.js sẽ thay vào chỗ {{DB_NAME}}.

CREATE DATABASE IF NOT EXISTS `{{DB_NAME}}`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
