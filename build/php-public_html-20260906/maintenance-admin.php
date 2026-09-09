<?php
/*
 * maintenance-admin.php — Bật/tắt chế độ bảo trì bằng một nút bấm.
 *
 * CHỈ tài khoản quản trị (ADMIN_USER_ID / ADMIN_USERNAME trong payment-config.php)
 * mới vào được — không phải "ai đăng nhập cũng được".
 *
 * Không bấm được (PHP hỏng, mất mật khẩu...) thì vẫn bật/tắt tay được:
 *   BẬT  = tạo file  api/maintenance.flag
 *   TẮT  = xoá file  api/maintenance.flag
 */
require_once __DIR__ . '/api/db.php';          // session + $pdo
require_once __DIR__ . '/api/points.php';      // admin_user_id()
require_once __DIR__ . '/api/maintenance.php'; // maint_on(), maint_flag_path()

function page($body, $extra = '')
{
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
       . '<meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<meta name="robots" content="noindex, nofollow">'
       . '<link rel="stylesheet" href="css/style.css?v=20">'
       . '<link rel="stylesheet" href="css/style-enhanced.css?v=20">'
       . '<title>Maintenance mode — Chinesechess Online</title>' . $extra . '</head>'
       . '<body><main class="container" style="max-width:600px;padding-top:48px">'
       . '<div class="card" style="padding:32px">' . $body . '</div></main></body></html>';
    exit;
}

/* ---------- Chỉ quản trị viên ---------- */
$uid = $_SESSION['userId'] ?? null;
if (!$uid) {
    page('<h2>🔒 Sign in required</h2>'
       . '<p class="text-muted">Sign in with the admin account to use this page.</p>'
       . '<a class="btn btn-primary" href="login.html">Sign in</a>');
}
$adminId = admin_user_id($pdo);
if ($adminId <= 0 || (int) $uid !== (int) $adminId) {
    http_response_code(403);
    page('<h2>🚫 Admin only</h2>'
       . '<p class="text-muted">This page is limited to the administrator account.</p>'
       . '<a class="btn btn-ghost" href="index.html">Back to the site</a>');
}

/* ---------- Token chống CSRF ---------- */
if (empty($_SESSION['maintCsrf'])) $_SESSION['maintCsrf'] = bin2hex(random_bytes(16));
$csrf = $_SESSION['maintCsrf'];

$notice = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
        $notice = '<p class="topup-status err">Invalid form token. Please reload and try again.</p>';
    } elseif (($_POST['action'] ?? '') === 'on') {
        $msg = trim((string) ($_POST['message'] ?? ''));
        $notice = maint_write([
            'message'   => $msg !== '' ? $msg : 'We are updating the site. Please come back in a few minutes.',
            'started'   => time(),
            // IP của chính bạn được cho qua, để tự kiểm tra site trong lúc bảo trì.
            'allow_ips' => [$_SERVER['REMOTE_ADDR'] ?? ''],
        ])
            ? '<p class="topup-status ok">Maintenance mode is ON. Visitors now see maintenance.html.</p>'
            : '<p class="topup-status err">Could not write api/maintenance.flag.php — check folder permissions.</p>';
    } elseif (($_POST['action'] ?? '') === 'off') {
        $notice = maint_clear()
            ? '<p class="topup-status ok">Maintenance mode is OFF. The site is live again.</p>'
            : '<p class="topup-status err">Could not delete the flag file — check folder permissions.</p>';
    }
}

/* ---------- Giao diện ---------- */
$on = maint_on();
$d  = maint_data();
$h  = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

$state = $on
    ? '<p style="font-size:1.1rem;margin:0 0 6px"><span class="badge loss">MAINTENANCE ON</span></p>'
      . '<p class="text-muted" style="margin:0 0 18px">Visitors are being sent to maintenance.html.<br>'
      . 'Message shown: <em>' . $h($d['message']) . '</em><br>'
      . 'Since: ' . $h(date('Y-m-d H:i:s', $d['started'])) . '</p>'
    : '<p style="font-size:1.1rem;margin:0 0 6px"><span class="badge win">SITE IS LIVE</span></p>'
      . '<p class="text-muted" style="margin:0 0 18px">Everything is running normally.</p>';

$form = $on
    ? '<form method="post"><input type="hidden" name="csrf" value="' . $h($csrf) . '">'
      . '<input type="hidden" name="action" value="off">'
      . '<button class="btn btn-primary btn-lg" type="submit">Turn maintenance OFF</button></form>'
    : '<form method="post"><input type="hidden" name="csrf" value="' . $h($csrf) . '">'
      . '<input type="hidden" name="action" value="on">'
      . '<label class="text-muted" style="display:block;margin-bottom:6px;font-size:.9rem">Message for visitors (optional)</label>'
      . '<input class="input" name="message" style="width:100%;margin-bottom:14px" '
      . 'placeholder="We are updating the site. Please come back in a few minutes.">'
      . '<button class="btn btn-lg" style="background:#e8543c;color:#fff;border:none" type="submit">Turn maintenance ON</button></form>';

page(
    '<h2 style="margin-top:0">🛠 Maintenance mode</h2>'
  . $notice
  . $state
  . $form
  . '<hr style="border:none;border-top:1px solid var(--c-border);margin:24px 0">'
  . '<p class="text-muted" style="font-size:.85rem;line-height:1.7;margin:0">'
  . '<strong>While maintenance is ON:</strong><br>'
  . '• You (the admin) and your current IP still browse the site normally.<br>'
  . '• Stripe webhooks keep working, so payments are still credited.<br>'
  . '• Sign-in stays open so you can log back in if your session expires.<br><br>'
  . '<strong>If this page ever fails:</strong> create or delete the file '
  . '<code>api/maintenance.flag.php</code> in cPanel File Manager — that file <em>is</em> the switch. '
  . 'An empty file is enough to turn maintenance on.'
  . '</p>'
);
