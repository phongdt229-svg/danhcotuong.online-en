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
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<link rel="stylesheet" href="css/style.css?v=' . $v . '"><title>Clear CSS/JS cache</title></head>'
        . '<body><main class="container" style="max-width:560px;padding-top:48px">'
        . '<div class="card center" style="padding:32px">' . $body . '</div></main></body></html>';
    exit;
}

if (empty($_SESSION['userId'])) {
    page('<h2>🔒 Sign in required</h2><p class="text-muted">You need to sign in to use this feature.</p>'
        . '<a class="btn btn-primary" href="login.html">Sign in</a>');
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
    page('<h2>✅ Cache cleared</h2>'
        . '<p class="text-muted">Updated <b>' . $count . '</b> files to version <code>v=' . $ts . '</code>.<br>'
        . 'Everyone will load the new CSS/JS the next time they open the site.</p>'
        . '<a class="btn btn-primary" href="index.html">Back to home</a>');
}

page('<h2>🔄 Clear CSS/JS cache</h2>'
    . '<p class="text-muted">Press the button below to force every browser to reload the latest CSS/JS '
    . '(use this after you upload new code to the host).</p>'
    . '<form method="post"><button class="btn btn-primary btn-lg" type="submit">Clear cache now</button></form>'
    . '<p class="text-muted" style="margin-top:14px;font-size:0.85rem">After that, visitors only need to reload the page (a normal F5) to get the new version.</p>');
