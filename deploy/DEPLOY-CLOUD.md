# Deploy bản ĐẦY ĐỦ (đăng nhập + lịch sử) lên cloud miễn phí

Mục tiêu: chạy toàn bộ app (frontend + backend Node + MySQL) trên cloud miễn phí,
giữ domain **danhcotuong.online**. Vì host hiện tại chỉ tĩnh nên ta đưa app lên
**Render** (chạy Node) + **MySQL cloud miễn phí** (TiDB hoặc Aiven).

> App đã được chỉnh sẵn cho cloud: hỗ trợ **DB qua TLS** (`DB_SSL=true`) và **tự tạo
> bảng khi khởi động** (không cần chạy lệnh import SQL).

---

## A. Đưa mã nguồn lên GitHub (không cần gõ lệnh)

Cách dễ nhất — dùng **GitHub Desktop** (giao diện đồ hoạ):
1. Tạo tài khoản tại github.com (nếu chưa có).
2. Tải & cài **GitHub Desktop**, đăng nhập.
3. Menu **File → Add local repository** → chọn thư mục dự án
   `c:\xampp\htdocs\danhcotuong.online`.
4. Bấm **Publish repository** (chọn Private cũng được).
   - `node_modules`, `.env`, `build/` sẽ tự bị loại nhờ file `.gitignore` — đúng ý.

(Hoặc upload thủ công: tạo repo trống trên github.com → "uploading an existing file"
→ kéo thả thư mục `server`, `public` và các file `package.json`, `package-lock.json`,
`.env.example`, `README.md`. **Không** kéo `node_modules`.)

---

## B. Tạo MySQL miễn phí (chọn 1 nhà cung cấp)

Lấy đủ **5 thông số**: HOST, PORT, USER, PASSWORD, DATABASE.

- **TiDB Cloud Serverless** (khuyên dùng — miễn phí, bền, tương thích MySQL):
  tidbcloud.com → tạo cluster Serverless (free) → **Connect** → lấy Host,
  Port (**4000**), User (dạng `xxx.root`), Password, và tên Database (tạo 1 database,
  ví dụ `danhcotuong`). Bắt buộc TLS.

- **Aiven** (cũng có gói free MySQL): aiven.io → tạo service MySQL (Free) → lấy
  Host, Port, User (`avnadmin`), Password, Database (`defaultdb`). Có sẵn CA cert.

---

## C. Tạo Web Service trên Render

1. Vào render.com → đăng ký bằng **GitHub**.
2. **New → Web Service** → chọn repo bạn vừa publish ở bước A.
3. Cấu hình:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Mở mục **Environment → Add Environment Variable**, thêm các biến sau
   (lấy giá trị DB từ bước B):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | (chuỗi đã sinh sẵn — xem cuối file) |
   | `COOKIE_SECURE` | `true` |
   | `DB_HOST` | host DB của bạn |
   | `DB_PORT` | port DB (TiDB = `4000`) |
   | `DB_USER` | user DB |
   | `DB_PASSWORD` | mật khẩu DB |
   | `DB_NAME` | tên database (vd `danhcotuong`) |
   | `DB_SSL` | `true` |

   (Aiven nếu muốn xác thực chặt: thêm `DB_SSL_CA` = dán nội dung CA cert. Để nhanh
   thì chỉ cần `DB_SSL=true` là kết nối được.)

5. **Create Web Service** → chờ build xong → Render cấp URL dạng
   `https://danhcotuong.onrender.com`.
6. App **tự tạo bảng** khi chạy. Kiểm tra:
   - Mở `https://<app>.onrender.com/api/health` → thấy `{"ok":true}`.
   - Thử **Đăng ký → Đăng nhập → chơi 1 ván → xem Hồ sơ** có lưu lịch sử.

> ⚠️ **Gói Free của Render "ngủ"** sau ~15 phút không ai truy cập. Lần mở đầu sau khi
> ngủ sẽ chậm ~30–60 giây rồi chạy bình thường. Đây là giới hạn của gói miễn phí.

---

## D. Trỏ domain danhcotuong.online về Render

1. Trong Render: **Settings → Custom Domains → Add** `danhcotuong.online` (và `www.danhcotuong.online`).
2. Render sẽ hiện bản ghi DNS cần thêm. Vào **cPanel → Zone Editor** của domain và thêm
   đúng theo hướng dẫn Render:
   - `www` → **CNAME** trỏ tới `<app>.onrender.com`
   - `danhcotuong.online` (apex) → theo giá trị Render cấp (A record hoặc ALIAS/ANAME).
3. Chờ DNS lan truyền + Render tự cấp SSL (vài phút đến vài giờ).
   Xong: `https://danhcotuong.online` chạy bản đầy đủ. ✅

> Lưu ý: một domain chỉ trỏ được về **một** nơi. Khi đã trỏ về Render thì bản web tĩnh
> đang ở `public_html` không còn được dùng nữa (không sao, bản trên Render đầy đủ hơn).

---

## SESSION_SECRET đã sinh sẵn (dán vào Render ở bước C)

```
55cf883f712b2d0e45f8d608067e264ecd71fc58354168dddb70c77ac6f72eecebca1d1e8e9e438ec81cc3f136bec95b
```

## Cập nhật code về sau
Sửa code ở máy → trong GitHub Desktop bấm **Commit** rồi **Push** → Render tự build lại.
