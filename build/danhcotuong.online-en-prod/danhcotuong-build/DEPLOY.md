# 🚀 Hướng dẫn Deploy Production — Chinesechess Online

> Node.js + Express + MySQL + WebSocket. Không có bước build bundler (webpack/vite):
> app phục vụ file tĩnh trực tiếp. "Deploy production" = cấu hình + chạy thật.
> Stack: **VPS + PM2 + Nginx + HTTPS**.

> ⚠️ **App này xử lý TIỀN THẬT** (nạp điểm qua PayPal) và điểm có giá trị quy đổi.
> Đọc hết [mục 9 — Trước khi mở cho người thật](#9-trước-khi-mở-cho-người-thật) trước khi công khai.

---

## 0. Kiến trúc khi chạy thật

```
  Internet ──HTTPS──> Nginx (443) ──proxy──> Node/PM2 (127.0.0.1:3000) ──> MySQL
                         │                          │
                    SSL (certbot)          ├─ sessions   (phiên đăng nhập)
                                           ├─ point_ledger (sổ cái điểm)
                    /ws ──WebSocket──┘     └─ stake_matches (ván cược)
                                                      │
                                            PayPal REST API (nạp điểm)
```

- **Nginx**: nhận HTTPS, proxy về Node cổng 3000, **và phải proxy cả `/ws`**.
- **PM2**: chạy & giám sát Node. **Bắt buộc 1 instance** (xem mục 5).
- **MySQL**: dữ liệu game, điểm, phiên đăng nhập.
- **PayPal**: gọi ra ngoài Internet — server phải ra được `api-m.paypal.com`.

---

## 1. Yêu cầu trên server

| Thành phần | Phiên bản | Ghi chú |
| ---------- | --------- | ------- |
| Node.js    | ≥ 18      | cần `fetch` sẵn có để gọi PayPal |
| MySQL      | 5.7 / 8+  | hoặc MariaDB 10.4+ |
| Nginx      | bất kỳ    | reverse proxy + WebSocket |
| PM2        | mới nhất  | `npm i -g pm2` |
| certbot    | mới nhất  | SSL miễn phí (Let's Encrypt) |

Server phải **gọi ra ngoài được HTTPS** tới `api-m.paypal.com` (nhiều VPS chặn outbound mặc định).

---

## 2. Lấy code & cài thư viện

```bash
git clone <repo-url> chinesechess && cd chinesechess
npm ci --omit=dev          # chỉ dependencies production
```

---

## 3. Tạo file `.env` (KHÔNG commit)

```bash
# Sinh SESSION_SECRET mới cho production — KHÔNG dùng lại chuỗi của máy dev:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```env
NODE_ENV=production
PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=chinesechess         # tạo user MySQL riêng, KHÔNG dùng root
DB_PASSWORD=<mật-khẩu-mạnh>
DB_NAME=chinesechess

SESSION_SECRET=<chuỗi-vừa-sinh>
COOKIE_SECURE=true           # bắt buộc khi đã có HTTPS

# ===== Nạp điểm qua PayPal (TIỀN THẬT) =====
PAYPAL_MODE=live             # 'live' = tiền thật, 'sandbox' = tiền giả để test
PAYPAL_CLIENT_ID=<client-id-LIVE>
PAYPAL_CLIENT_SECRET=<secret-LIVE>
POINTS_PER_USD=10            # 1 USD = 10 điểm

# ===== Cược điểm khi đấu với người =====
STAKE_MIN=150                # mức cược tối thiểu mỗi bên
STAKE_WINNER_PERCENT=80      # người thắng ăn 80% tổng cược, 20% về admin
ADMIN_USER_ID=               # id tài khoản nhận 20% (xem mục 4)
```

> ⚠️ `COOKIE_SECURE=true` khiến cookie chỉ gửi qua HTTPS. Chưa có HTTPS mà bật thì
> **không ai đăng nhập được**. Có HTTPS rồi mới bật.

> ⚠️ Key **sandbox và live là hai bộ khác nhau**. Lấy bộ live ở
> developer.paypal.com → Apps & Credentials → **tab Live** (phải hoàn tất xác minh
> tài khoản business trước). Dùng nhầm key sandbox trên production = không nhận được tiền.

Tạo user MySQL riêng:

```sql
CREATE USER 'chinesechess'@'localhost' IDENTIFIED BY '<mật-khẩu-mạnh>';
GRANT ALL PRIVILEGES ON chinesechess.* TO 'chinesechess'@'localhost';
FLUSH PRIVILEGES;
```

---

## 4. Khởi tạo cơ sở dữ liệu

**Cách 1 — có quyền chạy lệnh (VPS):**

```bash
npm run init-db      # tạo database + toàn bộ bảng
```

**Cách 2 — hosting/cPanel không cho chạy lệnh:**

Tạo database trong cPanel, mở phpMyAdmin → chọn database → tab **Import** →
tải lên [`deploy/schema-production.sql`](deploy/schema-production.sql).

> Server cũng **tự tạo bảng khi khởi động** (`server/config/ensureSchema.js`), nên
> chỉ cần database tồn tại là chạy được. Hai cách trên là để tạo sẵn cho chắc.

Các bảng: `users`, `games`, `point_transactions`, `stake_matches`, `point_ledger`, `sessions`.

**Đặt tài khoản admin** (để nhận 20% hoa hồng ván cược):

```bash
# 1. Đăng ký tài khoản 'admin' qua trang web như bình thường
# 2. Lấy id:
mysql -u chinesechess -p -e "SELECT id, username FROM chinesechess.users WHERE username='admin';"
# 3. Điền id đó vào ADMIN_USER_ID trong .env rồi: pm2 reload chinesechess
```

Bỏ trống `ADMIN_USER_ID` thì 20% vẫn được **ghi sổ** ở `stake_matches.house_points`
nhưng không cộng vào tài khoản nào.

---

## 5. Chạy bằng PM2

```bash
npm i -g pm2
npm run pm2:start          # pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup                # chạy lệnh nó in ra để bật cùng hệ điều hành
```

> 🚨 **BẮT BUỘC giữ `instances: 1` (fork mode). KHÔNG chuyển sang cluster / `'max'`.**
>
> Phòng đấu online giữ trạng thái **trong RAM của từng tiến trình**: danh sách phòng,
> hàng chờ ghép trận, ván cờ đang đánh. Chạy nhiều instance thì hai người chơi có thể
> rơi vào hai tiến trình khác nhau — không thấy phòng của nhau, và **ván cược điểm sẽ
> hỏng giữa chừng**. (Phiên đăng nhập thì an toàn vì lưu ở MySQL, nhưng phòng đấu thì không.)
> Muốn scale nhiều instance: phải chuyển trạng thái phòng sang Redis trước.

Lệnh hay dùng:

```bash
pm2 status
pm2 logs chinesechess       # log realtime
pm2 reload chinesechess     # reload không downtime
```

---

## 6. Nginx + HTTPS

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/chinesechess
sudo nano /etc/nginx/sites-available/chinesechess     # kiểm tra server_name
sudo ln -s /etc/nginx/sites-available/chinesechess /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d chinesechess.online -d www.chinesechess.online
```

> ⚠️ Block `location /ws` trong file mẫu là **bắt buộc**. Thiếu nó thì trang chủ vẫn
> chạy nhưng **đấu online không vào trận được** (WebSocket bị Nginx từ chối nâng cấp).

---

## 7. Kiểm tra sau khi deploy

```bash
curl https://chinesechess.online/api/health           # {"ok":true}
curl https://chinesechess.online/api/payments/config  # "configured":true, "mode":"live"
```

Nếu `configured: false` → thiếu `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`.
Nếu `mode: "sandbox"` trên production → **đang dùng nhầm key sandbox, tiền không vào thật**.

Kiểm bằng tay:

1. Đăng ký → đăng nhập (nếu không đăng nhập được: xem `COOKIE_SECURE` + HTTPS).
2. Chơi với máy (không cần điểm).
3. Nạp thử **1 USD** bằng tài khoản PayPal thật → phải nhận đúng 10 điểm.
4. Mở 2 trình duyệt khác nhau, 2 tài khoản, tạo phòng cược 150 → đánh xong kiểm điểm.
5. Vào trang **Points History** → số dư và lịch sử phải khớp.

**Soát sổ điểm** (không trả về dòng nào = sổ sách khớp):

```sql
SELECT u.id, u.points, COALESCE(SUM(l.delta),0) AS ledger_total
  FROM users u LEFT JOIN point_ledger l ON l.user_id = u.id
 GROUP BY u.id, u.points HAVING u.points <> ledger_total;
```

---

## 8. Deploy bản mới về sau

```bash
cd chinesechess
git pull
npm ci --omit=dev
npm run pm2:reload         # bảng mới tự tạo khi khởi động, không cần init-db
```

---

## 9. Trước khi mở cho người thật

### Bắt buộc

- [ ] `PAYPAL_MODE=live` + key **live** (không phải sandbox)
- [ ] `SESSION_SECRET` sinh mới cho production, chưa từng dùng ở đâu khác
- [ ] `NODE_ENV=production` (ẩn stack trace)
- [ ] `COOKIE_SECURE=true` + HTTPS đã bật
- [ ] `instances: 1` trong PM2 (xem mục 5)
- [ ] Nginx có block `/ws`
- [ ] User MySQL riêng, không dùng `root`
- [ ] Firewall chỉ mở 80/443, **chặn 3000 từ ngoài**: `sudo ufw allow 'Nginx Full'`
- [ ] Backup DB tự động — có tiền thật thì mất DB là mất tiền của người dùng:
      `mysqldump -u ... chinesechess | gzip > backup-$(date +%F).sql.gz`

### Khoảng trống đã biết (nên xử lý sớm)

- [ ] **Chưa có PayPal webhook / đối soát.** Điểm chỉ được cộng khi trình duyệt gọi
      bước capture. Nếu người dùng **đóng tab ngay sau khi trả tiền**, đơn sẽ nằm ở
      trạng thái `created` — *tiền đã trừ nhưng chưa được cộng điểm*. Kiểm định kỳ:
      ```sql
      SELECT * FROM point_transactions
       WHERE status = 'created' AND created_at < NOW() - INTERVAL 1 HOUR;
      ```
      Sửa triệt để: thêm webhook `PAYMENT.CAPTURE.COMPLETED`, hoặc job đối soát tự
      capture lại các đơn treo.
- [ ] **Chưa có rút điểm ra tiền.** Người dùng nạp vào được nhưng không rút ra được.
      Nếu định cho rút, cần thêm luồng payout + KYC.
- [ ] **Cược điểm có thể bị xem là cờ bạc** ở một số nơi. Kiểm tra quy định pháp lý
      tại thị trường bạn nhắm tới, và điều khoản PayPal về gaming/gambling —
      PayPal có thể khoá tài khoản nếu vi phạm.
- [ ] Chưa có `helmet` (security headers) và rate limit ở tầng Nginx.

---

## Phụ lục A — Docker

```bash
cp .env.docker.example .env.docker    # điền giá trị thật vào
docker compose --env-file .env.docker up -d --build
```

App chạy ở `127.0.0.1:3000` (chỉ loopback) — dựng Nginx phía trước như mục 6.
`docker-compose.yml` **không chứa secret**, mọi giá trị đọc từ `.env.docker`.

## Phụ lục B — chạy production trên Windows/XAMPP

```powershell
npm ci --omit=dev
npm run init-db
npm i -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
npm i -g pm2-windows-startup; pm2-startup install
```

Truy cập qua `http://localhost` thì để `COOKIE_SECURE=false`.
