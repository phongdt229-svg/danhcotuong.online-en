<?php
/*
 * dev-login.php — ĐĂNG NHẬP NHANH CHỈ DÀNH CHO MÁY DEV.
 *
 * ⚠ TUYỆT ĐỐI KHÔNG UPLOAD FILE NÀY LÊN SERVER THẬT.
 *   Nó cho phép vào bất kỳ tài khoản nào mà không cần mật khẩu.
 *
 * Hai lớp chặn, phải qua CẢ HAI mới chạy:
 *   1. php_sapi_name() === 'cli-server' — tức là đang chạy bằng `php -S`.
 *      Apache/LiteSpeed/PHP-FPM trên hosting KHÔNG BAO GIỜ trả về giá trị này,
 *      nên dù file có bị upload nhầm thì nó vẫn từ chối chạy.
 *   2. Người gọi phải từ máy nội bộ (127.0.0.1 / ::1).
 *
 * Lớp 1 là lớp quan trọng. Chỉ kiểm tra IP là không đủ: nhiều hosting chạy PHP
 * sau reverse proxy cùng máy, lúc đó REMOTE_ADDR cũng là 127.0.0.1.
 */

$sapi = php_sapi_name();
$ip   = $_SERVER['REMOTE_ADDR'] ?? '';
$isLoopback = in_array($ip, ['127.0.0.1', '::1', 'localhost'], true);

if ($sapi !== 'cli-server' || !$isLoopback) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Disabled. This page only runs on a local development server.\n";
    echo "sapi=$sapi ip=$ip\n";
    exit;
}

require __DIR__ . '/api/db.php'; // $pdo + session

$msg = '';

// Đăng xuất
if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: dev-login.php');
    exit;
}

// Đăng nhập vào tài khoản đã chọn
if (isset($_GET['as'])) {
    $id = (int) $_GET['as'];
    $st = $pdo->prepare('SELECT id, username FROM users WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    if ($u = $st->fetch()) {
        $_SESSION['userId'] = (int) $u['id'];
        $go = $_GET['go'] ?? 'profile.html';
        if (!preg_match('/^[a-z0-9._-]+\.html$/i', $go)) $go = 'profile.html';
        header('Location: ' . $go);
        exit;
    }
    $msg = 'Không tìm thấy tài khoản đó.';
}

// Tạo nhanh một tài khoản test
if (isset($_POST['create'])) {
    $name = trim((string) ($_POST['username'] ?? ''));
    $points = max(0, (int) ($_POST['points'] ?? 0));
    $refBy = trim((string) ($_POST['ref'] ?? ''));
    if (!preg_match('/^[a-zA-Z0-9_.]{3,50}$/', $name)) {
        $msg = 'Tên tài khoản phải 3-50 ký tự (chữ, số, _ và .).';
    } else {
        try {
            $pdo->prepare('INSERT INTO users (username, email, password_hash, points) VALUES (?, ?, ?, ?)')
                ->execute([$name, $name . '@dev.local', password_hash('dev', PASSWORD_DEFAULT), $points]);
            $newId = (int) $pdo->lastInsertId();
            if ($refBy !== '') {
                require_once __DIR__ . '/api/referral.php';
                ref_attach($pdo, $newId, $refBy);
            }
            // Đánh dấu đã nạp tiền -> đủ điều kiện sinh hoa hồng giới thiệu
            if (!empty($_POST['topup'])) {
                $pdo->prepare("INSERT INTO point_transactions (user_id, provider, order_id, amount_usd, points, status)
                               VALUES (?, 'dev', ?, ?, ?, 'completed')")
                    ->execute([$newId, 'dev_' . $newId . '_' . time(), $points / 10, $points]);
            }
            $msg = 'Đã tạo ' . htmlspecialchars($name) . '.';
        } catch (Throwable $e) {
            $msg = 'Không tạo được (tên đã tồn tại?).';
        }
    }
}

$users = $pdo->query('SELECT u.id, u.username, u.points, u.referral_pending, r.username AS ref_name
                        FROM users u LEFT JOIN users r ON r.id = u.referred_by
                       ORDER BY u.id DESC LIMIT 50')->fetchAll();
$me = $_SESSION['userId'] ?? null;
$meName = '';
if ($me) {
    $st = $pdo->prepare('SELECT username FROM users WHERE id = ? LIMIT 1');
    $st->execute([$me]);
    $r = $st->fetch();
    $meName = $r ? $r['username'] : '';
}
$h = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Dev login — chỉ chạy ở local</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; padding: 24px 16px 60px; background: #0f1620; color: #e8eef6;
             font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
      .wrap { max-width: 860px; margin: 0 auto; }
      h1 { font-size: 1.4rem; margin: 0 0 4px; }
      .warn { margin: 16px 0 22px; padding: 12px 14px; border-radius: 10px;
              background: rgba(239,68,68,.1); border-left: 4px solid #ef4444; font-size: .9rem; }
      .warn b { color: #f87171; }
      .now { margin: 0 0 18px; padding: 10px 14px; border-radius: 10px;
             background: rgba(16,185,129,.1); border-left: 4px solid #10b981; font-size: .92rem; }
      .msg { margin: 0 0 16px; padding: 10px 14px; border-radius: 10px;
             background: rgba(240,180,41,.12); border-left: 4px solid #f0b429; font-size: .9rem; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0 26px; }
      th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid #2a3a4d; }
      th { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      a.btn, button { display: inline-block; padding: 6px 14px; border-radius: 8px; border: 1px solid #2a3a4d;
              background: #1c2836; color: #e8eef6; font: inherit; font-size: .85rem;
              text-decoration: none; cursor: pointer; }
      a.btn.go { background: #1f6feb; border-color: #1f6feb; }
      a.btn:hover, button:hover { filter: brightness(1.15); }
      .links a { margin-right: 10px; font-size: .85rem; }
      form { margin: 6px 0 0; padding: 14px; border: 1px solid #2a3a4d; border-radius: 10px; background: #16202d; }
      label { display: block; font-size: .8rem; opacity: .75; margin: 8px 0 3px; }
      input[type=text], input[type=number] { width: 100%; box-sizing: border-box; padding: 8px 10px;
        border-radius: 8px; border: 1px solid #2a3a4d; background: #0f1620; color: inherit; font: inherit; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; }
      .row > div { flex: 1; min-width: 150px; }
      .chk { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: .88rem; }
      h2 { font-size: 1.05rem; margin: 26px 0 6px; }
      .hint { font-size: .82rem; opacity: .7; margin: 4px 0 0; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>🔓 Dev login</h1>
      <div class="warn">
        <b>Chỉ dùng trên máy phát triển.</b> Trang này cho vào bất kỳ tài khoản nào mà không cần mật khẩu.
        Nó tự từ chối chạy nếu không phải server <code>php -S</code> chạy ở 127.0.0.1, nhưng
        <b>đừng upload file này lên hosting</b>. File nằm ở <code>public/dev-login.php</code> và
        không có trong bất kỳ gói upload nào.
      </div>

      <?php if ($me): ?>
        <p class="now">Đang đăng nhập: <b><?= $h($meName) ?></b> (id <?= (int) $me ?>)
          — <a href="?logout=1">đăng xuất</a></p>
      <?php else: ?>
        <p class="now">Chưa đăng nhập. Bấm một nút bên dưới để vào.</p>
      <?php endif; ?>

      <?php if ($msg): ?><p class="msg"><?= $h($msg) ?></p><?php endif; ?>

      <h2>Tài khoản có sẵn</h2>
      <?php if (!$users): ?>
        <p class="hint">Chưa có tài khoản nào. Tạo một cái ở khung bên dưới.</p>
      <?php else: ?>
      <table>
        <thead>
          <tr><th>#</th><th>Tài khoản</th><th class="num">Điểm</th><th>Được ai mời</th><th class="num">Hoa hồng lẻ</th><th>Vào trang</th></tr>
        </thead>
        <tbody>
        <?php foreach ($users as $u): ?>
          <tr>
            <td class="num"><?= (int) $u['id'] ?></td>
            <td><b><?= $h($u['username']) ?></b></td>
            <td class="num"><?= number_format((int) $u['points']) ?></td>
            <td><?= $u['ref_name'] ? $h($u['ref_name']) : '—' ?></td>
            <td class="num"><?= rtrim(rtrim(number_format((float) $u['referral_pending'], 4), '0'), '.') ?: '0' ?></td>
            <td class="links">
              <a class="btn go" href="?as=<?= (int) $u['id'] ?>&go=profile.html">Hồ sơ</a>
              <a class="btn" href="?as=<?= (int) $u['id'] ?>&go=play-online.html">Đấu online</a>
              <a class="btn" href="?as=<?= (int) $u['id'] ?>&go=topup.html">Nạp điểm</a>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      <?php endif; ?>

      <h2>Tạo tài khoản test</h2>
      <form method="post">
        <div class="row">
          <div>
            <label for="username">Tên tài khoản</label>
            <input type="text" id="username" name="username" placeholder="test_a" required />
          </div>
          <div>
            <label for="points">Điểm ban đầu</label>
            <input type="number" id="points" name="points" value="2000" min="0" step="50" />
          </div>
          <div>
            <label for="ref">Được ai mời (tên người giới thiệu)</label>
            <input type="text" id="ref" name="ref" placeholder="để trống nếu tự vào" />
          </div>
        </div>
        <label class="chk">
          <input type="checkbox" name="topup" value="1" checked />
          Đánh dấu đã nạp tiền — bắt buộc thì người giới thiệu mới nhận được hoa hồng
        </label>
        <p style="margin:14px 0 0"><button type="submit" name="create" value="1">Tạo tài khoản</button></p>
        <p class="hint">Mật khẩu đặt sẵn là <code>dev</code>, nhưng đăng nhập qua trang này thì không cần dùng tới.</p>
      </form>
    </div>
  </body>
</html>
