/*
 * init-db.js — Tạo database & bảng từ schema.sql.
 * Dùng: npm run init-db
 * Kết nối KHÔNG chỉ định database để có thể CREATE DATABASE.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'config', 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  console.log('→ Đang chạy schema.sql…');
  await conn.query(sql);
  await conn.end();
  console.log('✓ Khởi tạo cơ sở dữ liệu thành công.');
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Lỗi khởi tạo DB:', err.message);
  console.error('  Kiểm tra MySQL (XAMPP) đã chạy và thông tin trong .env đúng chưa.');
  process.exit(1);
});
