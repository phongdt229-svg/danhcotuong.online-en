<?php
/*
 * config.local.php — Cấu hình DB cho MÁY DEV (XAMPP).
 *
 * File này CỐ Ý KHÔNG nằm trong gói zip upload lên hosting.
 * Nếu tồn tại, config.php sẽ ưu tiên dùng nó — nhờ vậy không phải sửa
 * config.php mỗi lần test local rồi lại phải nhớ khôi phục trước khi đóng gói.
 */
return [
    'DB_HOST' => 'localhost',
    'DB_PORT' => '3306',
    'DB_USER' => 'root',
    'DB_PASS' => '',
    'DB_NAME' => 'danhcotuong-en',
];
