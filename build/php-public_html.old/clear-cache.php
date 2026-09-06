<?php
/*
 * clear-cache.php — Chức năng "Xóa cache CSS/JS".
 * Bấm nút -> đổi version (?v=...) trên mọi file HTML/JS sang dấu thời gian mới
 * => tất cả trình duyệt tự tải lại CSS/JS mới (không cần Ctrl+F5 thủ công).
 * Cần đăng nhập mới dùng được.
 */
require __DIR__ . '/api/db.php'; // khởi tạo session + $pdo

function page($body) {
    $v = time();
    echo '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<link rel="stylesheet" href="css/style.css?v=' . $v . '"><title>Xóa cache CSS/JS</title></head>'
        . '<body><main class="container" style="max-width:560px;padding-top:48px">'
        . '<div class="card center" style="padding:32px">' . $body . '</div></main></body></html>';
    exit;
}

if (empty($_SESSION['userId'])) {
    page('<h2>🔒 Cần đăng nhập</h2><p class="text-muted">Bạn cần đăng nhập để dùng chức năng này.</p>'
        . '<a class="btn btn-primary" href="login.html">Đăng nhập</a>');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $ts = time();
    $dir = __DIR__;
    $files = array_merge(
        glob($dir . '/*.html') ?: [],
        glob($dir . '/js/*.js') ?: [],
        glob($dir . '/js/engine/*.js') ?: []
    );
    $count = 0;
    foreach ($files as $f) {
        $s = @file_get_contents($f);
        if ($s === false) continue;
        $o = $s;
        // Đổi mọi ?v=<số> sẵn có sang dấu thời gian mới
        $s = preg_replace('/\?v=\d+/', '?v=' . $ts, $s);
        // Với HTML: thêm ?v= cho ref css/js chưa có version
        if (substr($f, -5) === '.html') {
            $s = preg_replace('/((?:src|href)="(?:js|css)\/[^"?]+\.(?:js|css))"/', '$1?v=' . $ts . '"', $s);
        }
        if ($s !== $o && @file_put_contents($f, $s) !== false) $count++;
    }
    page('<h2>✅ Đã xóa cache!</h2>'
        . '<p class="text-muted">Đã cập nhật <b>' . $count . '</b> file sang phiên bản <code>v=' . $ts . '</code>.<br>'
        . 'Mọi người sẽ tự tải CSS/JS mới khi mở lại trang.</p>'
        . '<a class="btn btn-primary" href="index.html">Về trang chủ</a>');
}

page('<h2>🔄 Xóa cache CSS/JS</h2>'
    . '<p class="text-muted">Bấm nút dưới để buộc tất cả trình duyệt tải lại CSS/JS mới nhất '
    . '(dùng sau khi bạn cập nhật code trên host).</p>'
    . '<form method="post"><button class="btn btn-primary btn-lg" type="submit">Xóa cache ngay</button></form>'
    . '<p class="text-muted" style="margin-top:14px;font-size:0.85rem">Sau đó người dùng chỉ cần mở lại trang (F5 thường) là thấy bản mới.</p>');
