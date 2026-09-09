<?php
/*
 * config.php — Thông tin kết nối MySQL. SỬA cho khớp hosting của bạn.
 *
 * ⚠ File này chứa MẬT KHẨU. Đừng gửi nội dung cho ai, đừng đưa lên git.
 *
 * Trên cPanel, tên database và user đều bị THÊM TIỀN TỐ tài khoản —
 * phải điền TÊN ĐẦY ĐỦ (vd: taikhoan_chinesechess), không phải tên bạn gõ lúc tạo.
 *
 * Thứ tự ưu tiên:
 *   1. api/config.local.php  — chỉ có trên máy dev, KHÔNG nằm trong gói upload
 *   2. biến môi trường DB_*  — nếu hosting cho đặt
 *   3. các giá trị bên dưới  — điền tay sau khi upload
 */

// Máy dev: nếu có config.local.php thì dùng nó, khỏi phải sửa file này.
$local = __DIR__ . '/config.local.php';
if (is_file($local)) {
    return require $local;
}

return [
    'DB_HOST' => getenv('DB_HOST') ?: 'localhost',
    'DB_PORT' => getenv('DB_PORT') ?: '3306',
    'DB_USER' => getenv('DB_USER') ?: 'chin_home',
    'DB_PASS' => getenv('DB_PASS') !== false ? getenv('DB_PASS') : '9kzGINmFvAL0mmOA',
    'DB_NAME' => getenv('DB_NAME') ?: 'chin_home',
];
