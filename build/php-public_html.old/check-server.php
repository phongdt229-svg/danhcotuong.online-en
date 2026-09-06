<?php
/*
 * check-server.php — Kiểm tra nhanh hosting có đủ điều kiện chạy app không.
 *
 * Cách dùng: upload lên thư mục gốc, mở https://TENMIEN/check-server.php
 * ⚠ XOÁ FILE NÀY SAU KHI KIỂM TRA XONG (nó lộ thông tin máy chủ).
 */
header('Content-Type: text/plain; charset=utf-8');

function line($label, $ok, $detail = '')
{
    $mark = $ok === null ? '  ?  ' : ($ok ? ' OK  ' : 'LỖI  ');
    echo $mark . str_pad($label, 34) . $detail . "\n";
}

echo "=== KIỂM TRA HOSTING — Chinesechess Online ===\n\n";

/* --- PHP --- */
$phpOk = version_compare(PHP_VERSION, '7.4', '>=');
line('PHP >= 7.4', $phpOk, 'đang chạy ' . PHP_VERSION);
line('PDO MySQL (kết nối DB)', extension_loaded('pdo_mysql'));
line('cURL (gọi PayPal)', extension_loaded('curl'));
line('mbstring', extension_loaded('mbstring'));
line('session', function_exists('session_start'));

/* --- mod_rewrite --- */
$rw = null;
if (function_exists('apache_get_modules')) {
    $rw = in_array('mod_rewrite', apache_get_modules(), true);
    line('mod_rewrite', $rw, $rw ? 'đang bật' : 'ĐANG TẮT (app vẫn chạy được)');
} else {
    line('mod_rewrite', null, 'không kiểm tra được (PHP chạy dạng CGI/FPM)');
}
echo "     -> App KHÔNG phụ thuộc mod_rewrite: js/api.js gọi thẳng api/index.php.\n";
echo "        Tắt cũng không sao, chỉ mất phần chống cache trong .htaccess.\n\n";

/* --- File của app --- */
echo "--- File cần có ---\n";
foreach ([
    'api/index.php', 'api/db.php', 'api/config.php', 'api/payment-config.php',
    'api/points.php', 'api/stake.php', 'api/match.php', 'api/xiangqi.php', 'api/withdraw.php',
    'js/api.js', 'css/style.css', 'index.html', '.htaccess',
] as $f) {
    line($f, is_file(__DIR__ . '/' . $f));
}

/* --- Kết nối DB --- */
echo "\n--- Cơ sở dữ liệu ---\n";
$cfgFile = __DIR__ . '/api/config.php';
if (!is_file($cfgFile)) {
    line('api/config.php', false, 'không tìm thấy');
} else {
    $cfg = require $cfgFile;
    if (strpos((string) $cfg['DB_NAME'], 'DIEN_') === 0 || strpos((string) $cfg['DB_USER'], 'DIEN_') === 0) {
        line('Đã điền thông tin DB', false, 'api/config.php vẫn còn chỗ trống DIEN_...');
    } else {
        try {
            $dsn = "mysql:host={$cfg['DB_HOST']};port={$cfg['DB_PORT']};dbname={$cfg['DB_NAME']};charset=utf8mb4";
            $pdo = new PDO($dsn, $cfg['DB_USER'], $cfg['DB_PASS'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            line('Kết nối MySQL', true, 'DB: ' . $cfg['DB_NAME']);

            $need = ['users', 'games', 'matches', 'point_transactions', 'stake_matches', 'point_ledger', 'withdrawals'];
            $have = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
            foreach ($need as $t) line('  bảng ' . $t, in_array($t, $have, true));

            // Sổ điểm có khớp số dư không
            if (in_array('point_ledger', $have, true) && in_array('users', $have, true)) {
                $bad = $pdo->query('SELECT COUNT(*) FROM (
                        SELECT u.id FROM users u LEFT JOIN point_ledger l ON l.user_id = u.id
                         GROUP BY u.id, u.points HAVING u.points <> COALESCE(SUM(l.delta),0)
                    ) x')->fetchColumn();
                line('Sổ điểm khớp số dư', $bad == 0, $bad == 0 ? '' : "$bad tài khoản bị lệch");
            }
        } catch (Throwable $e) {
            line('Kết nối MySQL', false, $e->getMessage());
        }
    }
}

/* --- PayPal --- */
echo "\n--- Nạp điểm (PayPal) ---\n";
$pc = is_file(__DIR__ . '/api/payment-config.php') ? (require __DIR__ . '/api/payment-config.php') : [];
$hasKey = !empty($pc['PAYPAL_CLIENT_ID']) && !empty($pc['PAYPAL_CLIENT_SECRET']);
line('Đã điền key PayPal', $hasKey, $hasKey ? '' : 'trang Buy Points sẽ báo "not configured"');
$mode = $pc['PAYPAL_MODE'] ?? 'sandbox';
line('Chế độ', $mode === 'live', 'đang là "' . $mode . '"' . ($mode === 'live' ? ' (tiền thật)' : ' — TIỀN GIẢ, chưa thu được tiền'));

if ($hasKey) {
    $base = $mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    $ch = curl_init($base . '/v1/oauth2/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_USERPWD => $pc['PAYPAL_CLIENT_ID'] . ':' . $pc['PAYPAL_CLIENT_SECRET'],
        CURLOPT_POSTFIELDS => 'grant_type=client_credentials',
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($code === 200) line('Gọi được PayPal', true, 'key hợp lệ');
    elseif ($code === 401) line('Gọi được PayPal', false, 'key SAI hoặc nhầm sandbox/live');
    elseif ($code === 0) line('Gọi được PayPal', false, 'host chặn kết nối ra ngoài: ' . $err);
    else line('Gọi được PayPal', false, 'HTTP ' . $code);
}

echo "\n=== XONG — NHỚ XOÁ FILE NÀY ===\n";
