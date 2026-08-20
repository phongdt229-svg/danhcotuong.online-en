# 🚀 Hướng dẫn Build & Deploy Production

> **Đánh Cờ Tướng Online** — Node.js + Express + MySQL.
> Ứng dụng phục vụ file tĩnh trực tiếp nên **KHÔNG có bước build bundler** (webpack/vite).
> "Build production" = cấu hình + deploy chạy thật. Stack triển khai: **VPS + PM2 + Nginx + HTTPS**.

---

## 0. Tổng quan kiến trúc khi chạy thật

```
  Internet ──HTTPS──> Nginx (443) ──proxy──> Node/PM2 (127.0.0.1:3000) ──> MySQL
                         │                          │
                    SSL (certbot)            session lưu ở bảng `sessions`
```

- **Nginx**: nhận HTTPS, chuyển tiếp về Node ở cổng 3000, xử lý WebSocket `/ws`.
- **PM2**: chạy & giám sát tiến trình Node (tự restart, bật lại sau reboot).
- **MySQL**: lưu dữ liệu game + phiên đăng nhập (`sessions`).

---

## 1. Yêu cầu trên server

| Thành phần | Phiên bản | Ghi chú |
| ---------- | --------- | ------- |
| Node.js    | ≥ 18      | `node -v` |
| MySQL      | 5.7 / 8+  | hoặc MariaDB |
| Nginx      | bất kỳ    | reverse proxy |
| PM2        | mới nhất  | `npm i -g pm2` |
| certbot    | mới nhất  | cấp SSL miễn phí (Let's Encrypt) |

---

## 2. Lấy code & cài thư viện

```bash
git clone <repo-url> danhcotuong && cd danhcotuong

# Chỉ cài dependencies production (bỏ devDependencies)
npm ci --omit=dev
```

---

## 3. Tạo file `.env` (KHÔNG commit lên git)

```bash
# Sinh SESSION_SECRET ngẫu nhiên:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Nội dung `.env` cho production:

```env
NODE_ENV=production
PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=danhcotuong          # nên tạo user MySQL riêng, KHÔNG dùng root
DB_PASSWORD=<mật-khẩu-mạnh>
DB_NAME=danhcotuong

SESSION_SECRET=<chuỗi-vừa-sinh-ở-trên>
COOKIE_SECURE=true           # bắt buộc HTTPS; đặt false nếu tạm test qua HTTP
```

> ⚠️ `COOKIE_SECURE=true` khiến cookie chỉ gửi qua HTTPS. Nếu chưa có HTTPS mà để `true`
> thì **không đăng nhập được**. Có HTTPS rồi mới bật.

(Tuỳ chọn) tạo user MySQL riêng thay vì dùng `root`:

```sql
CREATE USER 'danhcotuong'@'localhost' IDENTIFIED BY '<mật-khẩu-mạnh>';
GRANT ALL PRIVILEGES ON danhcotuong.* TO 'danhcotuong'@'localhost';
FLUSH PRIVILEGES;
```

---

## 4. Khởi tạo cơ sở dữ liệu

```bash
npm run init-db      # tạo database + các bảng (users, games, ...)
```

> Bảng `sessions` **tự tạo** khi server chạy lần đầu (`createDatabaseTable: true`).

---

## 5. Chạy bằng PM2

```bash
npm i -g pm2

npm run pm2:start          # = pm2 start ecosystem.config.js --env production
pm2 save                   # lưu danh sách app
pm2 startup                # chạy lệnh nó in ra để bật cùng hệ điều hành
```

Các lệnh PM2 hay dùng:

```bash
pm2 status                 # xem trạng thái
pm2 logs danhcotuong       # xem log realtime
pm2 reload danhcotuong     # reload KHÔNG downtime sau khi cập nhật code
pm2 restart danhcotuong    # restart
pm2 stop danhcotuong       # dừng
```

---

## 6. Cấu hình Nginx + HTTPS

```bash
# Copy file mẫu, sửa server_name cho đúng domain
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/danhcotuong
sudo nano /etc/nginx/sites-available/danhcotuong      # đổi danhcotuong.online -> domain của bạn

sudo ln -s /etc/nginx/sites-available/danhcotuong /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Cấp chứng chỉ HTTPS miễn phí
sudo certbot --nginx -d danhcotuong.online -d www.danhcotuong.online
```

File mẫu: [`deploy/nginx.conf.example`](deploy/nginx.conf.example) — đã có redirect HTTP→HTTPS,
proxy `/` và WebSocket `/ws`.

---

## 7. Kiểm tra hoạt động

```bash
curl https://danhcotuong.online/api/health     # mong đợi: {"ok":true}
```

Mở trình duyệt vào domain → đăng ký / đăng nhập → chơi với AI. Kiểm tra log nếu lỗi:
`pm2 logs danhcotuong`.

---

## 8. Cập nhật code về sau (deploy bản mới)

```bash
cd danhcotuong
git pull
npm ci --omit=dev
npm run init-db            # chỉ khi có thay đổi schema
npm run pm2:reload         # reload không downtime
```

---

## 9. Checklist bảo mật trước khi mở công khai

- [x] `SESSION_SECRET` ngẫu nhiên, đủ dài
- [x] `NODE_ENV=production` (ẩn stack trace lỗi)
- [x] `COOKIE_SECURE=true` + HTTPS bật
- [x] Session lưu MySQL (không dùng MemoryStore)
- [x] `trust proxy` bật (chạy sau Nginx)
- [ ] User MySQL riêng (không dùng `root`) — *khuyến nghị*
- [ ] Firewall: chỉ mở 80/443, **chặn 3000 từ ngoài** (`sudo ufw allow 'Nginx Full'`)
- [ ] Backup DB định kỳ (`mysqldump`)
- [ ] (Khuyến nghị thêm) rate limit cho `/api/login`, security headers (helmet)

---

## Phụ lục — chạy production ngay trên Windows/XAMPP (không VPS)

Nếu deploy thẳng trên máy Windows hiện tại (MySQL của XAMPP):

```powershell
# .env để COOKIE_SECURE=false nếu truy cập qua http://localhost
npm ci --omit=dev
npm run init-db
npm i -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
# Tự khởi động cùng Windows:
npm i -g pm2-windows-startup && pm2-startup install
```
