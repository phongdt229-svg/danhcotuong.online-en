# Deploy lên cPanel (Setup Node.js App) — gói đã kèm node_modules

Áp dụng cho gói **`build/chinesechess-production.zip`** (đã có sẵn `node_modules`,
KHÔNG cần chạy lệnh). App tự tạo bảng khi khởi động — chỉ cần database tồn tại.

> ⚠️ **App này xử lý TIỀN THẬT** (nạp điểm qua PayPal). Đọc kỹ Bước 3 và Bước 6.

> ⚠️ Gói phải được **đóng lại từ mã nguồn mới nhất** mỗi lần deploy. Đừng dùng lại
> zip cũ — các bản build trong `build/danhcotuong-online/` và `build/php-public_html/`
> là bản tháng 6–7, **không có** tính năng nạp điểm / cược điểm / lịch sử điểm.

---

## Bước 1 — Upload & giải nén
1. cPanel → **File Manager**.
2. Tạo/chọn một thư mục RIÊNG cho app, **KHÔNG để trong `public_html`**.
   Gợi ý: `/home/TAIKHOAN/chinesechess.online`
3. Upload `chinesechess-production.zip` vào đó → chuột phải → **Extract**.
   Sau khi giải nén phải thấy: `server/`, `public/`, `node_modules/`, `.env`, `package.json`…

## Bước 2 — Tạo database (cPanel → "MySQL Databases")
> cPanel TỰ THÊM TIỀN TỐ vào tên DB và user (vd gõ `chinesechess` → `taikhoan_chinesechess`).

1. **Create New Database**: gõ `chinesechess` → ghi nhớ tên đầy đủ.
2. **Add New User**: tạo user + mật khẩu mạnh → ghi nhớ tên đầy đủ.
3. **Add User To Database**: gán user vào DB, tích **ALL PRIVILEGES**.

Không cần import SQL — app tự tạo 6 bảng khi chạy lần đầu:
`users`, `games`, `point_transactions`, `stake_matches`, `point_ledger`, `sessions`.

Muốn tạo sẵn bằng tay: phpMyAdmin → chọn DB → tab **Import** →
tải lên `deploy/schema-production.sql`.

## Bước 3 — Sửa file `.env`
Mở `.env` (trong thư mục app) bằng File Manager → Edit:

```
NODE_ENV=production
DB_HOST=localhost
DB_USER=taikhoan_dbuser          ← user ĐẦY ĐỦ (có tiền tố)
DB_PASSWORD=matkhau_da_dat
DB_NAME=taikhoan_chinesechess    ← DB ĐẦY ĐỦ (có tiền tố)
COOKIE_SECURE=true               ← để true vì sẽ bật HTTPS (Bước 5)

PAYPAL_MODE=live
PAYPAL_CLIENT_ID=<client-id-LIVE>
PAYPAL_CLIENT_SECRET=<secret-LIVE>
```

- `SESSION_SECRET` đã sinh sẵn riêng cho gói này — **KHÔNG sửa, KHÔNG chia sẻ**.
- `PORT` để nguyên (Passenger tự cấp, dòng này bị bỏ qua).
- DB cùng host cPanel nên KHÔNG cần `DB_SSL`.

> 🚨 **Key PayPal live khác hoàn toàn key sandbox.** Lấy ở developer.paypal.com →
> Apps & Credentials → **tab Live** (cần hoàn tất xác minh tài khoản business).
> Để trống 2 dòng key thì trang nạp điểm hiện "Payments are not available" —
> phần chơi cờ vẫn chạy bình thường.

## Bước 4 — Tạo ứng dụng Node (cPanel → "Setup Node.js App")
**Create Application**:
- **Node.js version:** 18 trở lên (bắt buộc — code dùng `fetch` sẵn có của Node 18)
- **Application mode:** Production
- **Application root:** thư mục đã upload (vd `chinesechess.online`)
- **Application URL:** chọn domain `chinesechess.online`
- **Application startup file:** `server/server.js`

Bấm **CREATE** → sau đó **START / RESTART**.
> KHÔNG bấm **Run NPM Install** (đã có node_modules sẵn).
> Chỉ bấm khi app báo thiếu module.

> ⚠️ Nếu cPanel cho chỉnh số instance/worker: **giữ đúng 1**. Phòng đấu online giữ
> trạng thái trong RAM của từng tiến trình — chạy nhiều instance sẽ làm hai người
> chơi không thấy nhau và **ván cược điểm hỏng giữa chừng**.

## Bước 5 — Bật HTTPS
1. Trỏ DNS domain về server (bản ghi A) nếu chưa.
2. cPanel → **SSL/TLS Status** → chọn domain + www → **Run AutoSSL**.
3. Có HTTPS rồi thì giữ `COOKIE_SECURE=true`.
   (Chưa có SSL mà muốn test tạm qua http:// → đổi `COOKIE_SECURE=false` rồi Restart.)

## Bước 6 — Kiểm tra sau khi lên

```
https://chinesechess.online/api/health           → {"ok":true}
https://chinesechess.online/api/payments/config  → "configured":true, "mode":"live"
```

- `configured: false` → chưa điền key PayPal.
- `mode: "sandbox"` → **đang dùng nhầm key sandbox, tiền KHÔNG vào thật**.

Kiểm bằng tay:
1. Đăng ký → đăng nhập (không đăng nhập được → xem `COOKIE_SECURE` + HTTPS).
2. Chơi với máy (không cần điểm).
3. Nạp thử **1 USD** bằng PayPal thật → phải nhận đúng 10 điểm.
4. Hai trình duyệt khác nhau, hai tài khoản → tạo phòng cược 150 → đánh xong kiểm điểm.
5. Vào trang **Points History** — số dư và lịch sử phải khớp.

**Đặt tài khoản admin** (nhận 20% hoa hồng ván cược): đăng ký tài khoản `admin` trên
web, lấy id trong phpMyAdmin (`SELECT id FROM users WHERE username='admin'`), điền vào
`ADMIN_USER_ID` trong `.env` rồi **Restart**.

## Sự cố thường gặp
- **App không start / lỗi DB:** sai `DB_USER`/`DB_NAME` (thiếu tiền tố) hoặc chưa
  *Add User To Database* với ALL PRIVILEGES.
- **Đăng nhập xong bị văng:** `COOKIE_SECURE=true` nhưng đang vào bằng `http://` → xem Bước 5.
- **Nạp điểm báo lỗi / không tạo được đơn:** host chặn kết nối ra ngoài. Server phải
  gọi được HTTPS tới `api-m.paypal.com` — liên hệ nhà cung cấp mở outbound.
- **Đấu online không vào trận / không cập nhật:** host chặn WebSocket (`/ws`).
  Đa số cPanel + Passenger hỗ trợ; nếu bị chặn, yêu cầu nhà cung cấp bật WebSocket.
  **Không có WebSocket thì tính năng cược điểm không dùng được.**
- **Sửa code rồi không thấy đổi:** đã có header no-cache, Ctrl+F5 một lần là được.

## Cập nhật về sau
Đóng gói lại từ mã nguồn mới → upload đè (giữ nguyên `.env`) → **Restart**.
Bảng mới tự tạo khi khởi động, không cần import lại SQL.

## Đối soát định kỳ (có tiền thật nên nên làm)

```sql
-- Sổ điểm có khớp số dư không? (không trả về dòng nào = khớp)
SELECT u.id, u.points, COALESCE(SUM(l.delta),0) AS ledger_total
  FROM users u LEFT JOIN point_ledger l ON l.user_id = u.id
 GROUP BY u.id, u.points HAVING u.points <> ledger_total;

-- Đơn nạp bị treo (đã trả tiền nhưng chưa cộng điểm)
SELECT * FROM point_transactions
 WHERE status = 'created' AND created_at < NOW() - INTERVAL 1 HOUR;
```
