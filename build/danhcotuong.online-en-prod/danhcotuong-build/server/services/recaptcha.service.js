/*
 * recaptcha.service.js — Xác minh Google reCAPTCHA v3 cho form đăng ký / đăng nhập.
 *
 * v3 không hiện ô tích: trình duyệt lấy token ngầm, server hỏi Google và nhận lại
 * điểm 0.0–1.0 (càng cao càng giống người thật).
 *
 * Ba chốt kiểm, thiếu một cái là bỏ lọt bot:
 *   1. success — token hợp lệ, chưa dùng, chưa hết hạn
 *   2. score   — phải >= ngưỡng cấu hình
 *   3. action  — phải khớp hành động, để token lấy ở trang này không đem dùng chỗ khác
 */
require('dotenv').config();

const SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const SECRET = process.env.RECAPTCHA_SECRET_KEY || '';
const ENABLED = String(process.env.RECAPTCHA_ENABLED || '1') === '1' && SITE_KEY !== '' && SECRET !== '';
// Google không gọi được thì CHO QUA (mặc định) hay CHẶN?
const FAIL_OPEN = String(process.env.RECAPTCHA_FAIL_OPEN || '1') === '1';

function minScore() {
  const v = Number(process.env.RECAPTCHA_MIN_SCORE);
  return v > 0 && v <= 1 ? v : 0.5;
}

function config() {
  return { enabled: ENABLED, siteKey: ENABLED ? SITE_KEY : '' };
}

/*
 * Trả về { ok: true } nếu hợp lệ (hoặc reCAPTCHA đang tắt),
 * { ok: false, error } nếu bị từ chối.
 */
async function verify(token, expectedAction, remoteIp) {
  if (!ENABLED) return { ok: true }; // chưa cấu hình -> không chặn ai

  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Captcha missing. Please reload the page and try again.' };

  let data;
  try {
    const body = new URLSearchParams({ secret: SECRET, response: t });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    // Không hỏi được Google (mạng chặn, Google sập...).
    console.error('reCAPTCHA unreachable:', err.message);
    return FAIL_OPEN ? { ok: true } : { ok: false, error: 'Cannot verify captcha right now. Please try again later.' };
  }

  if (!data || !data.success) {
    const codes = (data && data['error-codes']) || [];
    // Khoá sai / cấu hình sai là lỗi của mình, log lại để còn sửa.
    if (codes.includes('invalid-input-secret') || codes.includes('invalid-keys')) {
      console.error('reCAPTCHA misconfigured:', codes.join(','));
      return FAIL_OPEN ? { ok: true } : { ok: false, error: 'Captcha is misconfigured.' };
    }
    return { ok: false, error: 'Captcha check failed. Please reload the page and try again.' };
  }

  if (expectedAction && data.action && data.action !== expectedAction) {
    return { ok: false, error: 'Captcha action mismatch. Please reload the page.' };
  }

  const score = Number(data.score) || 0;
  if (score < minScore()) {
    console.error('reCAPTCHA low score', score, 'for action', data.action);
    return { ok: false, error: 'Your request looked automated. Please try again.' };
  }

  return { ok: true, score };
}

// Middleware factory: chặn request nếu captcha không qua.
function requireCaptcha(action) {
  return async (req, res, next) => {
    try {
      const r = await verify(req.body.captcha, action, req.ip);
      if (!r.ok) return res.status(400).json({ error: r.error, captchaFailed: true });
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { config, verify, requireCaptcha, ENABLED };
