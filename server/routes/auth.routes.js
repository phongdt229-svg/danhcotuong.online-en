/*
 * auth.routes.js — Đăng ký, đăng nhập, đăng xuất, lấy người dùng hiện tại.
 */
const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Giới hạn số lần thử theo IP (chống dò mật khẩu / spam đăng ký).
const attempts = new Map(); // ip -> { count, ts }
const RL_WINDOW = 15 * 60 * 1000; // 15 phút
const RL_MAX = 12;
function rateLimit(req, res, next) {
  const key = req.ip || (req.socket && req.socket.remoteAddress) || 'x';
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.ts > RL_WINDOW) {
    attempts.set(key, { count: 1, ts: now });
  } else {
    rec.count += 1;
    if (rec.count > RL_MAX) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
  }
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now - v.ts > RL_WINDOW) attempts.delete(k);
  }
  next();
}

router.post('/register', rateLimit, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!USERNAME_RE.test(username))
      return res.status(400).json({ error: 'Username must be 3-50 characters (letters, digits, _ and .)' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    if (await userService.findByUsername(username))
      return res.status(409).json({ error: 'That username is already taken' });
    if (await userService.emailExists(email))
      return res.status(409).json({ error: 'That email is already in use' });

    const user = await userService.createUser({ username, email, password });
    req.session.userId = user.id;
    res.status(201).json({ user });
  } catch (err) {
    console.error('register error:', err.message);
    res.status(500).json({ error: 'Server error while signing up' });
  }
});

router.post('/login', rateLimit, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';
    const user = await userService.verifyCredentials(username, password);
    if (!user) return res.status(401).json({ error: 'Wrong username or password' });
    req.session.userId = user.id;
    res.json({ user });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Server error while signing in' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ user: null });
  const user = await userService.findById(req.session.userId);
  res.json({ user });
});

module.exports = router;
