/*
 * recaptcha.js — Lấy token Google reCAPTCHA v3 cho form đăng ký / đăng nhập.
 *
 * v3 không hiện ô tích: thư viện chạy ngầm, chấm điểm rồi trả về một token
 * dùng-một-lần. Token gửi kèm request, server hỏi lại Google để xác minh.
 *
 * Token chỉ sống ~2 phút nên PHẢI lấy ngay lúc bấm nút, không lấy sẵn từ đầu.
 *
 * Nếu server chưa cấu hình khoá, mọi hàm ở đây trả token rỗng và form vẫn chạy
 * bình thường — không chặn ai chỉ vì thiếu cấu hình.
 */
(function (root) {
  'use strict';

  let siteKey = null;
  let ready = null; // Promise nạp thư viện, chỉ nạp một lần

  // Hỏi server xem có bật reCAPTCHA không và khoá công khai là gì.
  async function loadConfig() {
    if (siteKey !== null) return siteKey;
    try {
      const cfg = await root.API.recaptchaConfig();
      siteKey = cfg && cfg.enabled && cfg.siteKey ? cfg.siteKey : '';
    } catch (e) {
      siteKey = ''; // không hỏi được -> coi như tắt, để form còn dùng được
    }
    return siteKey;
  }

  function loadScript(key) {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(key);
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load reCAPTCHA'));
      document.head.appendChild(s);
    });
    return ready;
  }

  /*
   * Nạp sẵn thư viện khi mở trang, để lúc bấm nút không phải chờ tải.
   * Gọi được nhiều lần, chỉ nạp một lần.
   */
  async function prepare() {
    const key = await loadConfig();
    if (!key) return false;
    try {
      await loadScript(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  /*
   * Lấy token cho một hành động ('login' | 'register').
   * Trả về chuỗi rỗng nếu reCAPTCHA tắt hoặc không nạp được — server sẽ tự
   * quyết định cho qua hay chặn (xem RECAPTCHA_FAIL_OPEN).
   */
  async function token(action) {
    const key = await loadConfig();
    if (!key) return '';
    try {
      await loadScript(key);
      await new Promise((r) => root.grecaptcha.ready(r));
      return await root.grecaptcha.execute(key, { action: action });
    } catch (e) {
      return '';
    }
  }

  root.Captcha = { prepare, token };
})(window);
