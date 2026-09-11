<?php
/*
 * index.php — Router REST API (PHP thuần) cho Chinesechess Online.
 * Thay cho backend Node: đăng ký/đăng nhập, lưu & đọc ván, bảng xếp hạng,
 * nạp/rút điểm, và đấu online.
 *
 * Bản này KHÔNG dùng WebSocket (hosting chia sẻ thường không cho). Đấu online
 * đồng bộ bằng POLLING: client hỏi 'match/state' mỗi ~1,5 giây. Xem match.php.
 */
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/db.php'; // $pdo + session

$route  = isset($_GET['_route']) ? trim($_GET['_route'], '/') : '';
$method = $_SERVER['REQUEST_METHOD'];
$input  = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];

function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function current_user_id() { return $_SESSION['userId'] ?? null; }
function require_auth() {
    if (!current_user_id()) out(['error' => 'You need to sign in'], 401);
}
function public_user($pdo, $id) {
    $st = $pdo->prepare('SELECT id, username, email, elo, wins, losses, draws, points, created_at FROM users WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}
function apply_result($pdo, $userId, $result) {
    $col = $result === 'win' ? 'wins' : ($result === 'loss' ? 'losses' : 'draws');
    $delta = $result === 'win' ? 12 : ($result === 'loss' ? -10 : 2);
    $pdo->prepare("UPDATE users SET $col = $col + 1, elo = GREATEST(100, elo + ?) WHERE id = ?")
        ->execute([$delta, $userId]);
}
// Giới hạn số lần thử theo IP (chống dò mật khẩu). Lỗi ghi file thì bỏ qua, không chặn.
function rate_limit() {
    try {
        $ip  = $_SERVER['REMOTE_ADDR'] ?? 'x';
        $f   = sys_get_temp_dir() . '/dct_rl_' . md5($ip) . '.txt';
        $now = time();
        $win = 15 * 60; $max = 12;
        $rec = @json_decode(@file_get_contents($f), true);
        if (!is_array($rec) || ($now - ($rec['ts'] ?? 0)) > $win) {
            $rec = ['count' => 1, 'ts' => $now];
        } else {
            $rec['count']++;
            if ($rec['count'] > $max) out(['error' => 'Too many attempts. Please wait a few minutes.'], 429);
        }
        @file_put_contents($f, json_encode($rec));
    } catch (Throwable $e) { /* bỏ qua */ }
}

$USERNAME_RE = '/^[a-zA-Z0-9_.]{3,50}$/';
$EMAIL_RE    = '/^[^\s@]+@[^\s@]+\.[^\s@]+$/';

// Chế độ bảo trì: chặn mọi route (trừ vài route cần cho quản trị viên đăng nhập).
// Quản trị viên và IP trong allow_ips vẫn đi tiếp bình thường.
require_once __DIR__ . '/maintenance.php';
maint_gate($pdo, $route);

try {
    // ---------- ĐẤU ONLINE (polling) ----------
    if (strpos($route, 'match/') === 0) {
        require __DIR__ . '/match.php';
        handle_match($pdo, substr($route, 6), $method, $input);
    }

    // ---------- RÚT ĐIỂM VỀ PAYPAL ----------
    if (strpos($route, 'withdraw/') === 0) {
        require __DIR__ . '/withdraw.php';
        handle_withdraw($pdo, substr($route, 9), $method, $input);
    }

    // ---------- NẠP ĐIỂM & SỔ CÁI ĐIỂM ----------
    if (strpos($route, 'payments/') === 0) {
        require __DIR__ . '/points.php';
        handle_payments($pdo, substr($route, 9), $method, $input);
    }

    // ---------- SỔ TAY TỰ HỌC (chơi với máy) ----------
    if (strpos($route, 'book/') === 0) {
        require __DIR__ . '/book.php';
        handle_book($pdo, substr($route, 5), $method, $input);
    }

    // Khoá công khai của reCAPTCHA cho trình duyệt nạp thư viện (khoá này vốn công khai).
    if ($route === 'recaptcha/config' && $method === 'GET') {
        require_once __DIR__ . '/recaptcha.php';
        out(['enabled' => rc_enabled(), 'siteKey' => rc_site_key()]);
    }

    // ---------- AUTH ----------
    if ($route === 'register' && $method === 'POST') {
        rate_limit();
        require_once __DIR__ . '/recaptcha.php';
        rc_require($input['captcha'] ?? '', 'register'); // chặn bot trước khi tạo tài khoản
        $username = trim($input['username'] ?? '');
        $email    = strtolower(trim($input['email'] ?? ''));
        $password = $input['password'] ?? '';
        if (!preg_match($USERNAME_RE, $username)) out(['error' => 'Username must be 3-50 characters (letters, digits, _ and .)'], 400);
        if (!preg_match($EMAIL_RE, $email))       out(['error' => 'Invalid email address'], 400);
        if (strlen($password) < 6)                out(['error' => 'Password must be at least 6 characters'], 400);

        $st = $pdo->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
        $st->execute([$username]);
        if ($st->fetch()) out(['error' => 'That username is already taken'], 409);
        $st = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $st->execute([$email]);
        if ($st->fetch()) out(['error' => 'That email is already in use'], 409);

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $st = $pdo->prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
        $st->execute([$username, $email, $hash]);
        $id = (int) $pdo->lastInsertId();
        $_SESSION['userId'] = $id;
        out(['user' => public_user($pdo, $id)], 201);
    }

    if ($route === 'login' && $method === 'POST') {
        rate_limit();
        require_once __DIR__ . '/recaptcha.php';
        rc_require($input['captcha'] ?? '', 'login'); // chặn dò mật khẩu tự động
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';
        $st = $pdo->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
        $st->execute([$username]);
        $u = $st->fetch();
        if (!$u || !password_verify($password, $u['password_hash'])) out(['error' => 'Wrong username or password'], 401);
        $_SESSION['userId'] = (int) $u['id'];
        out(['user' => public_user($pdo, $u['id'])]);
    }

    if ($route === 'logout' && $method === 'POST') {
        $_SESSION = [];
        session_destroy();
        out(['ok' => true]);
    }

    if ($route === 'me' && $method === 'GET') {
        $id = current_user_id();
        out(['user' => $id ? public_user($pdo, $id) : null]);
    }

    // ---------- GAMES ----------
    if ($route === 'games' && $method === 'POST') {
        require_auth();
        $result = $input['result'] ?? '';
        if (!in_array($result, ['win', 'loss', 'draw'], true)) out(['error' => 'Invalid result'], 400);
        $opp   = substr((string) ($input['opponent_type'] ?? 'ai'), 0, 40);
        $moves = max(0, (int) ($input['moves_count'] ?? 0));
        $dur   = max(0, (int) ($input['duration_sec'] ?? 0));
        $pgn   = isset($input['pgn']) ? (string) $input['pgn'] : null;
        $st = $pdo->prepare('INSERT INTO games (user_id, opponent_type, result, moves_count, duration_sec, pgn) VALUES (?, ?, ?, ?, ?, ?)');
        $st->execute([current_user_id(), $opp, $result, $moves, $dur, $pgn]);
        $gameId = (int) $pdo->lastInsertId(); // đọc NGAY sau INSERT (trước UPDATE)
        apply_result($pdo, current_user_id(), $result);
        out(['id' => $gameId], 201);
    }

    if ($route === 'games' && $method === 'GET') {
        require_auth();
        $st = $pdo->prepare('SELECT id, opponent_type, result, moves_count, duration_sec, created_at FROM games WHERE user_id = ? ORDER BY created_at DESC LIMIT 20');
        $st->execute([current_user_id()]);
        out(['games' => $st->fetchAll()]);
    }

    if (preg_match('#^games/(\d+)$#', $route, $m) && $method === 'GET') {
        require_auth();
        $st = $pdo->prepare('SELECT id, opponent_type, result, moves_count, duration_sec, pgn, created_at FROM games WHERE id = ? AND user_id = ? LIMIT 1');
        $st->execute([(int) $m[1], current_user_id()]);
        $g = $st->fetch();
        if (!$g) out(['error' => 'Game not found'], 404);
        out(['game' => $g]);
    }

    // ---------- USERS ----------
    if ($route === 'users/leaderboard' && $method === 'GET') {
        $rows = $pdo->query('SELECT id, username, elo, wins, losses, draws FROM users ORDER BY elo DESC, wins DESC, id ASC LIMIT 20')->fetchAll();
        out(['players' => $rows]);
    }

    if (preg_match('#^users/(\d+)/stats$#', $route, $m) && $method === 'GET') {
        $u = public_user($pdo, (int) $m[1]);
        if (!$u) out(['error' => 'User not found'], 404);
        out(['username' => $u['username'], 'elo' => $u['elo'], 'wins' => $u['wins'], 'losses' => $u['losses'], 'draws' => $u['draws']]);
    }

    if ($route === 'health') out(['ok' => true]);

    out(['error' => 'Endpoint not found'], 404);
} catch (Throwable $e) {
    // Ghi lỗi THẬT vào error_log của host (cPanel > Errors / file error_log) để còn tra được.
    // Khách vẫn chỉ thấy câu chung — không lộ chi tiết SQL/đường dẫn ra ngoài.
    error_log('[api] ' . $method . ' ' . $route . ' -> ' . get_class($e) . ': ' . $e->getMessage()
              . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
    out(['error' => 'Server error'], 500);
}
