/*
 * ssl.js — Cấu hình TLS cho kết nối MySQL khi chạy trên cloud (DB cloud bắt buộc SSL).
 *
 * Bật bằng biến môi trường:
 *   DB_SSL=true                      -> bật TLS (đa số DB cloud miễn phí cần dòng này)
 *   DB_SSL_CA=<nội dung cert CA>     -> (tuỳ chọn) bật xác thực CA chặt chẽ
 *   DB_SSL_REJECT_UNAUTHORIZED=true|false  -> (tuỳ chọn) ép bật/tắt xác thực cert
 *
 * Khi chạy local (XAMPP) KHÔNG đặt DB_SSL -> trả về undefined -> kết nối thường như cũ.
 */
module.exports = function buildSsl() {
  const enabled = process.env.DB_SSL === 'true' || !!process.env.DB_SSL_CA;
  if (!enabled) return undefined;

  // Mặc định không xác thực CA để cấu hình nhanh (đủ an toàn cho dự án nhỏ:
  // dữ liệu vẫn được mã hoá trên đường truyền). Có CA thì bật xác thực chặt.
  const ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: false };
  if (process.env.DB_SSL_CA) {
    ssl.ca = process.env.DB_SSL_CA;
    ssl.rejectUnauthorized = true;
  }
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true') ssl.rejectUnauthorized = true;
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false') ssl.rejectUnauthorized = false;
  return ssl;
};
