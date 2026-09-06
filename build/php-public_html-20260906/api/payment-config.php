<?php
/*
 * payment-config.php — Cấu hình nạp điểm & cược điểm.
 * SỬA file này sau khi upload lên hosting. KHÔNG chia sẻ nội dung ra ngoài.
 *
 * Nếu hosting cho đặt biến môi trường thì đặt ở đó — biến môi trường được ưu tiên
 * hơn giá trị trong file này.
 */
return [
    // ===== PayPal =====
    // 'sandbox' = tiền giả để test | 'live' = TIỀN THẬT
    // Key LIVE lấy ở developer.paypal.com > Apps & Credentials > tab Live
    // (khác hoàn toàn key sandbox — dùng nhầm sandbox thì tiền KHÔNG vào thật).
    'PAYPAL_MODE' => 'sandbox',
    'PAYPAL_CLIENT_ID' => 'AVN-nsLxWWZ3Y_Vh8uHZt2VkDhVl6xoM-u-PWjdINQ-1IWsZAi2LZo22v6egb-2cggypuoeN1vpVa5ik',
    'PAYPAL_CLIENT_SECRET' => 'EO1mm1127pnNrvVStKwzT8MSvQKanyjOAgxjvIV6Lhcsn-Yh5J4wG2dRjZQGiu4dHRXF0Hn1TAA6_ig2',

    // Tỉ giá quy đổi: 1 USD = bao nhiêu điểm
    'POINTS_PER_USD' => '10',

    // ===== Google reCAPTCHA v3 (chống bot ở form đăng ký / đăng nhập) =====
    // Khoá lấy tại google.com/recaptcha/admin, phải đúng loại "reCAPTCHA v3"
    // (khoá v2 KHÔNG dùng được cho v3). Nhớ khai báo tên miền trong mục Domains,
    // thêm cả 'localhost' nếu muốn test ở máy.
    // Để trống SITE_KEY hoặc SECRET_KEY = tắt reCAPTCHA, form vẫn chạy bình thường.
    'RECAPTCHA_ENABLED' => '1',
    'RECAPTCHA_SITE_KEY' => '6LcBsJItAAAAABgqnnoeEMUZ01YwqNF3TK-9_9f5',
    'RECAPTCHA_SECRET_KEY' => '6LcBsJItAAAAAKDtH40KcUKL-RTl1UWFmaAgw1_n',
    // Điểm tối thiểu để được qua (0.0–1.0). 0.5 là mức Google khuyến nghị.
    // Chặn nhầm người thật thì hạ xuống 0.3; bot lọt nhiều thì nâng lên 0.7.
    'RECAPTCHA_MIN_SCORE' => '0.5',
    // Khi KHÔNG gọi được Google (host chặn outbound, Google sập):
    // '1' = vẫn cho đăng nhập, '0' = chặn.
    // Để '1' để một sự cố phía Google không khoá toàn bộ người dùng.
    'RECAPTCHA_FAIL_OPEN' => '1',

    // ===== Rút điểm về PayPal =====
    // Bao nhiêu điểm đổi được 1 USD khi RÚT RA. Để bằng POINTS_PER_USD là đúng
    // tỷ giá nạp vào; đặt cao hơn (vd '12') nếu muốn rút ra thiệt hơn nạp vào.
    'WITHDRAW_POINTS_PER_USD' => '10',
    // Mức rút tối thiểu mỗi lần (điểm).
    'WITHDRAW_MIN_POINTS' => '1000',
    // Bật/tắt tính năng rút: '1' = bật, '0' = tắt (trang vẫn hiện nhưng báo tạm ngừng).
    'WITHDRAW_ENABLED' => '1',

    // ===== Cược điểm khi đấu với người =====
    // Mức cược tối thiểu mỗi bên
    'STAKE_MIN' => '150',
    // Người thắng nhận bao nhiêu % tổng cược (phần còn lại về admin)
    'STAKE_WINNER_PERCENT' => '80',
    // Tài khoản quản trị: nhận 20% hoa hồng ván cược VÀ được vào admin.html
    // để duyệt yêu cầu rút điểm.
    //
    // Mặc định nhận diện theo TÊN tài khoản 'admin' — cứ đăng ký tài khoản tên
    // 'admin' trên web là xong, không phải sửa file này.
    'ADMIN_USERNAME' => 'admin',
    // (tuỳ chọn) Chỉ định thẳng bằng id, sẽ được ưu tiên hơn ADMIN_USERNAME.
    // Dùng khi tài khoản quản trị của bạn mang tên khác.
    'ADMIN_USER_ID' => '',
];
