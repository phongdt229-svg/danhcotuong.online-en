/*
 * db.js — Tạo connection pool MySQL (mysql2/promise) từ biến môi trường.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();
const buildSsl = require('./ssl');

const ssl = buildSsl();
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'danhcotuong',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ...(ssl ? { ssl } : {}),
});

module.exports = pool;
