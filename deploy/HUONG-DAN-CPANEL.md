# Deploy lên cPanel (Setup Node.js App) — gói đã kèm node_modules

Áp dụng cho gói **danhcotuong-online-production.zip** (đã có sẵn `node_modules`,
KHÔNG cần chạy lệnh). App tự tạo bảng khi khởi động — chỉ cần database tồn tại.

---

## Bước 1 — Upload & giải nén
1. cPanel → **File Manager**.
2. Tạo/chọn một thư mục RIÊNG cho app, **KHÔNG để trong `public_html`**.
   Gợi ý: `/home/TAIKHOAN/danhcotuong.online`
3. Upload file zip vào đó → chuột phải → **Extract**.
   Sau khi giải nén phải thấy: `server/`, `public/`, `node_modules/`, `.env`, `package.json`…

## Bước 2 — Tạo database (cPanel → "MySQL Databases")
> cPanel TỰ THÊM TIỀN TỐ vào tên DB và user (vd gõ `danhcotuong` → `taikhoan_danhcotuong`).

1. **Create New Database**: gõ `danhcotuong` → ghi nhớ tên đầy đủ.
2. **Add New User**: tạo user + mật khẩu mạnh → ghi nhớ tên đầy đủ.
3. **Add User To Database**: gán user vào DB, tích **ALL PRIVILEGES**.

(Không cần import SQL — app tự tạo bảng `users`, `games`, `sessions` khi chạy lần đầu.
Nếu muốn tạo tay thì import `deploy/schema-cpanel.sql`.)

## Bước 3 — Sửa file `.env`
Mở `.env` (trong thư mục app) bằng File Manager → Edit, điền **tên đầy đủ có tiền tố**:
```
NODE_ENV=production
DB_HOST=localhost
DB_USER=taikhoan_dbuser        ← user đầy đủ
DB_PASSWORD=matkhau_da_dat
DB_NAME=taikhoan_danhcotuong   ← DB đầy đủ
COOKIE_SECURE=true             ← để true vì sẽ bật HTTPS (Bước 5)
```
- `SESSION_SECRET` đã sinh sẵn — KHÔNG sửa.
- DB cùng host cPanel nên KHÔNG cần `DB_SSL`.
- `PORT` để nguyên (Passenger tự cấp, dòng này bị bỏ qua).

## Bước 4 — Tạo ứng dụng Node (cPanel → "Setup Node.js App")
**Create Application**:
- **Node.js version:** 18 trở lên (chọn bản mới nhất)
- **Application mode:** Production
- **Application root:** thư mục đã upload (vd `danhcotuong.online`)
- **Application URL:** chọn domain `danhcotuong.online`
- **Application startup file:** `server/server.js`

Bấm **CREATE** → sau đó **START / RESTART**.
> KHÔNG bấm **Run NPM Install** (đã có node_modules sẵn).
> Nếu app báo thiếu module thì mới bấm Run NPM Install một lần.

## Bước 5 — Bật HTTPS
1. Trỏ DNS domain về server (bản ghi A) nếu chưa.
2. cPanel → **SSL/TLS Status** → chọn domain + www → **Run AutoSSL**.
3. Có HTTPS rồi thì giữ `COOKIE_SECURE=true`.
   (Chưa có SSL mà muốn test tạm qua http:// → đổi `COOKIE_SECURE=false` rồi Restart.)

## Kiểm tra
- Mở `https://danhcotuong.online/api/health` → `{"ok":true}`.
- Mở trang chủ → Đăng ký → Đăng nhập → chơi thử (AI + đấu người + xem trận).

## Sự cố thường gặp
- **App không start / lỗi DB:** sai `DB_USER`/`DB_NAME` (thiếu tiền tố) hoặc chưa
  *Add User To Database* với ALL PRIVILEGES.
- **Đăng nhập xong bị văng:** `COOKIE_SECURE=true` nhưng đang vào bằng `http://`
  (chưa có SSL) → xem Bước 5.
- **Đấu online/xem trận không cập nhật:** host chặn WebSocket. Đa số cPanel + Passenger
  hỗ trợ WebSocket; nếu bị chặn, liên hệ nhà cung cấp bật WebSocket cho Node app.
- **Sửa code rồi không thấy đổi:** đã có header no-cache, chỉ cần Ctrl+F5 một lần.

## Cập nhật về sau
Upload đè file thay đổi (hoặc cả thư mục) → vào Setup Node.js App bấm **Restart**.
