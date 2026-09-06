<?php
// db.php — Kết nối PDO, khởi tạo session, tự tạo bảng (idempotent).
// Trả về biến $pdo cho các handler dùng.

require_once __DIR__ . '/config.php';
$cfg = require __DIR__ . '/config.php';

// Đồng bộ múi giờ PHP & MySQL (tránh lệch giờ làm sai bộ lọc/dọn phòng đấu online).
date_default_timezone_set('UTC');

// ----- Session (đăng nhập) -----
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 7, // 7 ngày
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        // 'secure' => true, // bật khi chạy HTTPS
    ]);
    session_start();
}

// ----- Kết nối MySQL -----
try {
    $dsn = "mysql:host={$cfg['DB_HOST']};port={$cfg['DB_PORT']};dbname={$cfg['DB_NAME']};charset=utf8mb4";
    $pdo = new PDO($dsn, $cfg['DB_USER'], $cfg['DB_PASS'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'"); // khớp với date_default_timezone_set('UTC')
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Không kết nối được cơ sở dữ liệu. Kiểm tra thông tin trong api/config.php']);
    exit;
}

// ----- Tự tạo bảng (chạy lần đầu) -----
$pdo->exec("CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    email         VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    elo           INT          NOT NULL DEFAULT 1000,
    wins          INT          NOT NULL DEFAULT 0,
    losses        INT          NOT NULL DEFAULT 0,
    draws         INT          NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

$pdo->exec("CREATE TABLE IF NOT EXISTS games (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT          NOT NULL,
    opponent_type VARCHAR(40)  NOT NULL DEFAULT 'ai',
    result        ENUM('win','loss','draw') NOT NULL,
    moves_count   INT          NOT NULL DEFAULT 0,
    duration_sec  INT          NOT NULL DEFAULT 0,
    pgn           TEXT         NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_games_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_games_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// Bàn đấu online (đồng bộ bằng polling — thay cho WebSocket).
$pdo->exec("CREATE TABLE IF NOT EXISTS matches (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(8)   NOT NULL UNIQUE,
    status      ENUM('waiting','playing','ended') NOT NULL DEFAULT 'waiting',
    is_quick    TINYINT      NOT NULL DEFAULT 0,
    host_name   VARCHAR(30)  NULL,
    red_name    VARCHAR(30)  NULL,
    black_name  VARCHAR(30)  NULL,
    red_token   VARCHAR(40)  NULL,
    black_token VARCHAR(40)  NULL,
    stake       INT          NOT NULL DEFAULT 0,
    red_user_id   INT        NULL,
    black_user_id INT        NULL,
    turn        CHAR(1)      NOT NULL DEFAULT 'r',
    moves       MEDIUMTEXT   NULL,
    result_text VARCHAR(120) NULL,
    winner      CHAR(1)      NULL,
    chat        MEDIUMTEXT   NULL,
    red_seen    DATETIME     NULL,
    black_seen  DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
// Bổ sung cột chat cho bảng matches đã tồn tại (bỏ qua nếu đã có).
try { $pdo->exec("ALTER TABLE matches ADD COLUMN chat MEDIUMTEXT NULL"); } catch (Throwable $e) { /* đã có */ }

// ----- Điểm & thanh toán -----

// Số dư điểm của người dùng. Thêm cột cho DB đã tồn tại từ bản cũ (bỏ qua nếu đã có).
try { $pdo->exec("ALTER TABLE users ADD COLUMN points INT NOT NULL DEFAULT 0 AFTER draws"); } catch (Throwable $e) { /* đã có */ }

// Dấu thời gian "còn hoạt động" — bản polling không có kết nối thường trực nên
// dùng cột này để biết ai đang online (cập nhật mỗi lần sảnh hỏi danh sách phòng).
try { $pdo->exec("ALTER TABLE users ADD COLUMN last_seen DATETIME NULL"); } catch (Throwable $e) { /* đã có */ }
try { $pdo->exec("CREATE INDEX idx_users_last_seen ON users (last_seen)"); } catch (Throwable $e) { /* đã có */ }

// Đơn nạp điểm qua PayPal.
// UNIQUE (provider, order_id) là chốt chặn chống cộng điểm hai lần cho cùng một đơn.
$pdo->exec("CREATE TABLE IF NOT EXISTS point_transactions (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT           NOT NULL,
    provider     VARCHAR(20)   NOT NULL DEFAULT 'paypal',
    order_id     VARCHAR(64)   NOT NULL,
    capture_id   VARCHAR(64)   NULL,
    amount_usd   DECIMAL(10,2) NOT NULL,
    points       INT           NOT NULL,
    status       ENUM('created','completed','failed') NOT NULL DEFAULT 'created',
    fail_reason  VARCHAR(190)  NULL,
    created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME      NULL,
    UNIQUE KEY uq_provider_order (provider, order_id),
    CONSTRAINT fk_ptx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_ptx_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// Sổ ván cược điểm. Điểm bị TRỪ khi ván bắt đầu, chỉ chia lại một lần khi kết thúc
// — cột `status` là chốt chặn chống chia hai lần.
$pdo->exec("CREATE TABLE IF NOT EXISTS stake_matches (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    code           VARCHAR(12) NOT NULL,
    stake          INT         NOT NULL,
    pot            INT         NOT NULL DEFAULT 0,
    red_user_id    INT         NULL,
    black_user_id  INT         NULL,
    status         ENUM('playing','settled','refunded') NOT NULL DEFAULT 'playing',
    outcome        ENUM('win','draw','abort') NULL,
    winner_user_id INT         NULL,
    winner_points  INT         NOT NULL DEFAULT 0,
    house_points   INT         NOT NULL DEFAULT 0,
    created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at     DATETIME    NULL,
    UNIQUE KEY uq_stake_code (code),
    INDEX idx_stake_red (red_user_id, created_at),
    INDEX idx_stake_black (black_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// Sổ cái điểm: ghi TỪNG biến động. Mỗi dòng ghi trong CÙNG transaction với lệnh
// đổi users.points, nên SUM(delta) của một người luôn bằng users.points của người đó.
$pdo->exec("CREATE TABLE IF NOT EXISTS point_ledger (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT         NOT NULL,
    delta         INT         NOT NULL,
    balance_after INT         NOT NULL,
    kind          ENUM('topup','stake_hold','stake_win','stake_refund','house_fee','adjust') NOT NULL,
    ref_type      VARCHAR(20) NULL,
    ref_id        INT         NULL,
    note          VARCHAR(190) NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_ledger_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// Yêu cầu rút điểm về PayPal.
// Điểm bị GIỮ (trừ khỏi số dư) ngay khi gửi yêu cầu, nên không thể tiêu hai lần.
// Admin duyệt tay: 'paid' = đã chuyển tiền, 'rejected'/'cancelled' = hoàn lại điểm.
$pdo->exec("CREATE TABLE IF NOT EXISTS withdrawals (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT           NOT NULL,
    points       INT           NOT NULL,
    amount_usd   DECIMAL(10,2) NOT NULL,
    paypal_email VARCHAR(190)  NOT NULL,
    status       ENUM('pending','paid','rejected','cancelled') NOT NULL DEFAULT 'pending',
    admin_note   VARCHAR(190)  NULL,
    payout_ref   VARCHAR(120)  NULL,
    created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME      NULL,
    processed_by INT           NULL,
    CONSTRAINT fk_wd_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_wd_user (user_id, id),
    INDEX idx_wd_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// Bổ sung 2 loại biến động mới cho sổ cái (DB cũ chỉ có 6 loại).
try {
    $pdo->exec("ALTER TABLE point_ledger MODIFY COLUMN kind
        ENUM('topup','stake_hold','stake_win','stake_refund','house_fee','adjust','withdraw_hold','withdraw_refund') NOT NULL");
} catch (Throwable $e) { /* đã đủ loại */ }

// Cột cược cho bảng matches đã tồn tại từ bản cũ (bỏ qua nếu đã có).
try { $pdo->exec("ALTER TABLE matches ADD COLUMN stake INT NOT NULL DEFAULT 0"); } catch (Throwable $e) { /* đã có */ }
try { $pdo->exec("ALTER TABLE matches ADD COLUMN red_user_id INT NULL"); } catch (Throwable $e) { /* đã có */ }
try { $pdo->exec("ALTER TABLE matches ADD COLUMN black_user_id INT NULL"); } catch (Throwable $e) { /* đã có */ }

// Sổ tay nước đi tự học của AI (chơi với máy). Khoá = thế cờ (lúc Đen tới lượt) + nước đi.
$pdo->exec("CREATE TABLE IF NOT EXISTS ai_book (
    pos_hash  CHAR(32)   NOT NULL,
    move      VARCHAR(12) NOT NULL,
    plays     INT        NOT NULL DEFAULT 0,
    wins      INT        NOT NULL DEFAULT 0,
    losses    INT        NOT NULL DEFAULT 0,
    updated_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (pos_hash, move),
    INDEX idx_pos (pos_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

// Nạp "sổ khai cuộc" dựng sẵn lần đầu (idempotent, chỉ chạy tới khi nạp xong nhờ marker file).
(function ($pdo) {
    try {
        $marker = sys_get_temp_dir() . '/dct_book_seeded_v1';
        if (is_file($marker)) return;
        $cnt = (int) $pdo->query('SELECT COUNT(*) AS c FROM ai_book')->fetch()['c'];
        if ($cnt === 0) {
            $seedFile = __DIR__ . '/seed_book.json';
            if (is_file($seedFile)) {
                $seed = json_decode(file_get_contents($seedFile), true);
                if (is_array($seed) && $seed) {
                    $ins = $pdo->prepare('INSERT IGNORE INTO ai_book (pos_hash, move, plays, wins, losses) VALUES (?, ?, ?, ?, ?)');
                    $pdo->beginTransaction();
                    foreach ($seed as $r) {
                        if (!isset($r['pos_hash'], $r['move'])) continue;
                        $ins->execute([$r['pos_hash'], $r['move'], (int) ($r['plays'] ?? 1), (int) ($r['wins'] ?? 1), (int) ($r['losses'] ?? 0)]);
                    }
                    $pdo->commit();
                }
            }
        }
        @file_put_contents($marker, '1');
    } catch (Throwable $e) { /* không chặn app nếu nạp seed lỗi */ }
})($pdo);
