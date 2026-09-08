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
    $mark = $ok === null ? '  ?  ' : ($ok ? ' OK  ' : 'FAIL ');
    echo $mark . str_pad($label, 34) . $detail . "\n";
}

echo "=== HOSTING CHECK — Chinesechess Online ===\n\n";

/* --- PHP --- */
$phpOk = version_compare(PHP_VERSION, '7.4', '>=');
line('PHP >= 7.4', $phpOk, 'running ' . PHP_VERSION);
line('PDO MySQL (database)', extension_loaded('pdo_mysql'));
line('cURL (PayPal calls)', extension_loaded('curl'));
line('mbstring', extension_loaded('mbstring'));
line('session', function_exists('session_start'));

/* --- mod_rewrite --- */
$rw = null;
if (function_exists('apache_get_modules')) {
    $rw = in_array('mod_rewrite', apache_get_modules(), true);
    line('mod_rewrite', $rw, $rw ? 'enabled' : 'DISABLED (app still works)');
} else {
    line('mod_rewrite', null, 'cannot detect (PHP running as CGI/FPM)');
}
echo "     -> The app does NOT depend on mod_rewrite: js/api.js calls api/index.php directly.\n";
echo "        Disabled is fine; you only lose the cache headers in .htaccess.\n\n";

/* --- File của app --- */
echo "--- Required files ---\n";
foreach ([
    'api/index.php', 'api/db.php', 'api/config.php', 'api/payment-config.php',
    'api/points.php', 'api/stake.php', 'api/match.php', 'api/xiangqi.php', 'api/withdraw.php',
    'js/api.js', 'css/style.css', 'index.html', '.htaccess',
] as $f) {
    line($f, is_file(__DIR__ . '/' . $f));
}

/* --- Kết nối DB --- */
echo "\n--- Database ---\n";
$cfgFile = __DIR__ . '/api/config.php';
if (!is_file($cfgFile)) {
    line('api/config.php', false, 'not found');
} else {
    $cfg = require $cfgFile;
    if (strpos((string) $cfg['DB_NAME'], 'DIEN_') === 0 || strpos((string) $cfg['DB_USER'], 'DIEN_') === 0) {
        line('Database details filled in', false, 'api/config.php still has DIEN_... placeholders');
    } else {
        try {
            $dsn = "mysql:host={$cfg['DB_HOST']};port={$cfg['DB_PORT']};dbname={$cfg['DB_NAME']};charset=utf8mb4";
            $pdo = new PDO($dsn, $cfg['DB_USER'], $cfg['DB_PASS'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            line('MySQL connection', true, 'DB: ' . $cfg['DB_NAME']);

            $need = ['users', 'games', 'matches', 'point_transactions', 'stake_matches', 'point_ledger', 'withdrawals'];
            $have = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
            foreach ($need as $t) line('  table ' . $t, in_array($t, $have, true));

            // Sổ điểm có khớp số dư không
            if (in_array('point_ledger', $have, true) && in_array('users', $have, true)) {
                $bad = $pdo->query('SELECT COUNT(*) FROM (
                        SELECT u.id FROM users u LEFT JOIN point_ledger l ON l.user_id = u.id
                         GROUP BY u.id, u.points HAVING u.points <> COALESCE(SUM(l.delta),0)
                    ) x')->fetchColumn();
                line('Ledger matches balances', $bad == 0, $bad == 0 ? '' : "$bad account(s) out of sync");
            }
        } catch (Throwable $e) {
            line('MySQL connection', false, $e->getMessage());
        }
    }
}

/* --- PayPal --- */
echo "\n--- Buying points (PayPal) ---\n";
$pc = is_file(__DIR__ . '/api/payment-config.php') ? (require __DIR__ . '/api/payment-config.php') : [];
$hasKey = !empty($pc['PAYPAL_CLIENT_ID']) && !empty($pc['PAYPAL_CLIENT_SECRET']);
line('PayPal keys filled in', $hasKey, $hasKey ? '' : 'the Buy Points page will show "not configured"');
$mode = $pc['PAYPAL_MODE'] ?? 'sandbox';
line('Mode', $mode === 'live', 'currently "' . $mode . '"' . ($mode === 'live' ? ' (real money)' : ' — FAKE MONEY, you are not collecting anything'));

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
    if ($code === 200) line('PayPal reachable', true, 'keys are valid');
    elseif ($code === 401) line('PayPal reachable', false, 'wrong keys, or sandbox/live mixed up');
    elseif ($code === 0) line('PayPal reachable', false, 'host blocks outbound connections: ' . $err);
    else line('PayPal reachable', false, 'HTTP ' . $code);
}

echo "\n=== DONE — REMEMBER TO DELETE THIS FILE ===\n";
