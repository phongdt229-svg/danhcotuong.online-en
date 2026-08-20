/*
 * auth.js — Middleware xác thực dựa trên session.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Bạn cần đăng nhập' });
}

module.exports = { requireAuth };
