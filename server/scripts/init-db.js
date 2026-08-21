/*
 * init-db.js — Tạo database rồi tạo toàn bộ bảng.
 * Dùng: npm run init-db
 *
 * Bước 1 kết nối KHÔNG chỉ định database (để CREATE DATABASE được).
 * Bước 2 gọi ensureSchema() — cùng một hàm server chạy lúc khởi động, nên
 * bảng tạo ở đây luôn khớp với bảng server mong đợi.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_NAME = process.env.DB_NAME || 'danhcotuong';

async function main() {
  // Tên database không thể truyền dạng tham số (?) nên phải chèn thẳng —
  // chỉ cho phép ký tự an toàn để không mở đường SQL injection qua .env.
  if (!/^[A-Za-z0-9_-]+$/.test(DB_NAME)) {
    throw new Error(`DB_NAME không hợp lệ: "${DB_NAME}" (chỉ cho phép chữ, số, _ và -)`);
  }

  const sql = fs
    .readFileSync(path.join(__dirname, '..', 'config', 'schema.sql'), 'utf8')
    .split('{{DB_NAME}}')
    .join(DB_NAME);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  console.log(`→ Tạo database \`${DB_NAME}\`…`);
  await conn.query(sql);
  await conn.end();

  // Tạo bảng bằng đúng hàm server dùng (nạp sau khi database đã tồn tại).
  const ensureSchema = require('../config/ensureSchema');
  const pool = require('../config/db');
  console.log('→ Tạo các bảng…');
  await ensureSchema();
  await pool.end();

  console.log('✓ Khởi tạo cơ sở dữ liệu thành công.');
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Lỗi khởi tạo DB:', err.message);
  console.error('  Kiểm tra MySQL đã chạy và thông tin DB_* trong .env đúng chưa.');
  process.exit(1);
});
