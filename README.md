# Đánh Cờ Tướng Online ♟

Website chơi **Cờ Tướng (Xiangqi)** online: chơi với máy (AI) 3 mức độ, đầy đủ luật,
lịch sử nước đi, đồng hồ thi đấu, đăng nhập và lưu thống kê. Xây dựng bằng **Node.js +
Express + MySQL**, giao diện hiện đại responsive (tiếng Việt).

> Phiên bản **v1** tập trung phần cốt lõi (chơi với AI + tài khoản). Nền tảng đã dựng sẵn
> WebSocket để mở rộng **đấu người thật real-time** ở giai đoạn 2.

## Tính năng

- 🤖 **AI 3 mức độ** (Dễ / Trung bình / Khó) — minimax + cắt tỉa alpha-beta, chạy trong Web Worker.
- 📜 **Luật cờ tướng đầy đủ**: mã cản chân, pháo cần ngòi, tượng không qua sông, sĩ/tướng trong cung,
  tốt qua sông, **luật tướng đối mặt**, phát hiện chiếu & chiếu hết.
- ⏱️ Đồng hồ 5 / 10 / 15 phút mỗi bên.
- 🔁 Lịch sử nước đi, hoàn nước, hiển thị quân bị bắt.
- 🔊 Hiệu ứng âm thanh (Web Audio, không cần file).
- 👤 Đăng ký / đăng nhập (session + bcrypt), hồ sơ thống kê thắng/thua + lịch sử ván.

## Yêu cầu

- **Node.js** 18+ (đã có `node` trong PATH).
- **MySQL** đang chạy (XAMPP đã kèm sẵn — bật MySQL trong XAMPP Control Panel).

## Cài đặt & chạy

```bash
# 1. Cài thư viện
npm install

# 2. Cấu hình môi trường (sao chép rồi sửa nếu cần)
cp .env.example .env
#   Mặc định XAMPP: DB_USER=root, DB_PASSWORD= (rỗng)

# 3. Tạo cơ sở dữ liệu & bảng
npm run init-db

# 4. Khởi động máy chủ
npm start
```

Mở trình duyệt: **http://localhost:3000**

> Lưu ý: dù thư mục nằm trong `htdocs` của XAMPP, ứng dụng chạy bằng **Node.js** (cổng 3000),
> KHÔNG chạy qua Apache. XAMPP chỉ dùng để cung cấp **MySQL**.

## Cấu trúc thư mục

```
server/                 # Backend Node.js
  server.js             # Express + static + WebSocket (nền GĐ2)
  config/               # db pool, schema.sql
  middleware/, routes/, services/, scripts/
public/                 # Frontend tĩnh
  index, play, login, register, profile (.html)
  css/                  # style.css, board.css
  js/
    engine/xiangqi.js   # Luật cờ tướng thuần (dùng chung)
    engine/ai.worker.js # AI minimax (Web Worker)
    board.js, play.js, api.js, ui.js
```

## API chính

| Method | Đường dẫn               | Mô tả                         |
| ------ | ----------------------- | ----------------------------- |
| POST   | `/api/register`         | Đăng ký                       |
| POST   | `/api/login`            | Đăng nhập                     |
| POST   | `/api/logout`           | Đăng xuất                     |
| GET    | `/api/me`               | Người dùng hiện tại           |
| POST   | `/api/games`            | Lưu kết quả ván (cần đăng nhập)|
| GET    | `/api/games`            | Lịch sử ván của tôi           |
| GET    | `/api/users/:id/stats`  | Thống kê người dùng           |

## Triển khai production (VPS + PM2 + Nginx)

Ứng dụng là Node.js phục vụ file tĩnh trực tiếp — **không có bước "build" bundler**.
"Build production" = cấu hình & deploy chạy thật. Đã hardening sẵn: session lưu vào MySQL,
secure cookie, `trust proxy`, error handler ẩn stack trace, graceful shutdown.

```bash
# 1. Trên VPS: cài Node 18+, MySQL, rồi clone code và cài thư viện production
npm ci --omit=dev

# 2. Tạo .env (KHÔNG commit). Sinh secret ngẫu nhiên:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   Đặt NODE_ENV=production, SESSION_SECRET=<chuỗi vừa sinh>, COOKIE_SECURE=true,
#   và thông tin MySQL thật (DB_USER/DB_PASSWORD/DB_NAME).

# 3. Tạo DB & bảng (bảng `sessions` tự tạo khi chạy lần đầu)
npm run init-db

# 4. Chạy bằng PM2 (tự restart, tự bật lại sau reboot)
npm i -g pm2
npm run pm2:start          # = pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup    # bật cùng hệ điều hành

# Cập nhật code về sau: git pull && npm ci --omit=dev && npm run pm2:reload
```

**Nginx + HTTPS:** dùng mẫu [`deploy/nginx.conf.example`](deploy/nginx.conf.example) (đã có reverse
proxy `/`, WebSocket `/ws`, redirect HTTP→HTTPS). Cấp chứng chỉ:
`sudo certbot --nginx -d danhcotuong.online`.

> ⚠️ `COOKIE_SECURE=true` chỉ hoạt động khi truy cập qua HTTPS. Nếu test production qua HTTP
> thuần, tạm đặt `COOKIE_SECURE=false` nếu không sẽ không đăng nhập được.

## Giai đoạn sau (ngoài v1)

Đấu người thật real-time (WebSocket), sảnh ghép trận, chat, xếp hạng cao thủ, giải đấu,
xem trận, bài học cờ, trang quản trị.
