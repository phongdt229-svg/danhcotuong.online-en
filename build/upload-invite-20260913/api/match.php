<?php
/*
 * match.php — Đấu Cờ Tướng online bằng POLLING (thuần PHP, không cần WebSocket).
 * Client cứ ~1.5s gọi 'state' để lấy nước đi mới của đối thủ.
 *
 * ⚠ MỌI TRẬN VỚI NGƯỜI ĐỀU CÓ CƯỢC ĐIỂM. Vì có tiền thật nên:
 *   1. Bắt buộc đăng nhập; danh tính lấy từ SESSION, không nhận tên do client khai.
 *   2. Server TỰ KIỂM LUẬT từng nước bằng engine (xiangqi.php) — nước phạm luật bị từ chối.
 *   3. Server TỰ KẾT LUẬN ai thắng bằng cách phát lại ván. Client KHÔNG khai được
 *      kết quả (trước đây endpoint 'over' cho client tự gửi winner — đã bỏ).
 *   4. Bỏ trận / mất tích quá lâu bị xử thua, để không ai thoát cược bằng cách rút mạng.
 */

require_once __DIR__ . '/xiangqi.php';
require_once __DIR__ . '/stake.php';

// Đối thủ không hỏi thăm quá ngần này giây thì coi như bỏ trận.
const M_ABANDON_SECONDS = 90;

/*
 * Coi là ĐANG ONLINE nếu có hoạt động trong 30 giây gần đây — gấp ~7 lần nhịp
 * poll của sảnh (4s), đủ rộng để mạng chậm không làm nhấp nháy online/offline.
 */
const M_ONLINE_SECONDS = 30;

/*
 * Lời mời sống 90 giây rồi tự hết hạn. Ngắn có chủ ý: lời mời là thứ cần trả
 * lời ngay, để lâu thì người mời đã bỏ đi mà người được mời vẫn thấy.
 */
const M_INVITE_SECONDS = 90;

// Mời rộng tay hơn mốc online một nhịp: người vừa rời mắt khỏi máy vẫn kịp nhận.
const M_INVITE_ONLINE_SECONDS = 60;

function gen_token() { return bin2hex(random_bytes(16)); }

// Đánh dấu "còn hoạt động" — bản polling không có kết nối thường trực nên mốc
// online chỉ dựa vào cột này.
function m_touch($pdo, $userId) {
    if (!$userId) return;
    $pdo->prepare('UPDATE users SET last_seen = NOW() WHERE id = ?')->execute([(int) $userId]);
}

// Người này đang đánh dở một ván nào đó? (đang đánh thì không mời được)
function m_is_playing($pdo, $userId) {
    $st = $pdo->prepare("SELECT id FROM matches
                          WHERE status = 'playing'
                            AND updated_at > (NOW() - INTERVAL 1 MINUTE)
                            AND (red_user_id = ? OR black_user_id = ?)
                          LIMIT 1");
    $st->execute([(int) $userId, (int) $userId]);
    return (bool) $st->fetch();
}

/*
 * Mã phòng: 4 CHỮ SỐ (0000–9999), không có chữ cái.
 * Chỉ 10.000 mã nên phải thử lại khi trùng — vòng lặp dưới kiểm tra trong DB.
 * Phòng cũ bị dọn sau 30 phút nên số mã đang dùng cùng lúc rất nhỏ, gần như
 * không bao giờ chạm giới hạn.
 */
const CODE_LEN = 4;

function gen_code($pdo) {
    for ($i = 0; $i < 50; $i++) {
        $c = str_pad((string) random_int(0, 9999), CODE_LEN, '0', STR_PAD_LEFT);
        $st = $pdo->prepare('SELECT id FROM matches WHERE code = ? LIMIT 1');
        $st->execute([$c]);
        if (!$st->fetch()) return $c;
    }
    // Dự phòng cực hiếm: vẫn phải là SỐ (bản cũ trả hex nên lẫn chữ cái).
    return str_pad((string) random_int(0, 9999), CODE_LEN, '0', STR_PAD_LEFT);
}

function m_find($pdo, $code) {
    $st = $pdo->prepare('SELECT * FROM matches WHERE code = ? LIMIT 1');
    $st->execute([strtoupper(trim((string) $code))]);
    return $st->fetch() ?: null;
}

// Màu của người chơi theo token; null nếu là khán giả.
function m_color($m, $token) {
    if ($token && $token === $m['red_token']) return 'r';
    if ($token && $token === $m['black_token']) return 'b';
    return null;
}

// Bắt buộc đăng nhập. Trả về thông tin user (id, username, points), hoặc 401.
function m_require_user($pdo) {
    $uid = $_SESSION['userId'] ?? null;
    if (!$uid) out(['error' => 'Sign in to play staked games against other players.', 'needLogin' => true], 401);
    $st = $pdo->prepare('SELECT id, username, points FROM users WHERE id = ? LIMIT 1');
    $st->execute([$uid]);
    $u = $st->fetch();
    if (!$u) out(['error' => 'Your session is no longer valid.', 'needLogin' => true], 401);
    return $u;
}

// Đọc & kiểm mức cược do client gửi; kèm kiểm số dư để báo lỗi sớm, dễ hiểu.
function m_read_stake($input, $user) {
    $stake = $input['stake'] ?? null;
    if (!stake_is_valid($stake)) {
        out(['error' => 'Stake must be a whole number of at least ' . stake_min() . ' points.'], 400);
    }
    $stake = (int) $stake;
    if ((int) $user['points'] < $stake) {
        out(['error' => 'You need ' . $stake . ' points for this game — you have ' . (int) $user['points'] . '.'], 400);
    }
    return $stake;
}

function m_user_id_of($m, $color) {
    return $color === 'r' ? (int) $m['red_user_id'] : (int) $m['black_user_id'];
}

/*
 * Kết thúc ván + chia điểm. Luôn đi qua đây để không chỗ nào quên chia.
 * $winnerColor = 'r' | 'b' | null (null = hòa).
 */
function m_finish($pdo, $m, $winnerColor, $text, $outcome = null) {
    $now = date('Y-m-d H:i:s');
    if ($m['status'] !== 'ended') {
        $pdo->prepare("UPDATE matches SET status='ended', winner=?, result_text=?, updated_at=? WHERE id=?")
            ->execute([$winnerColor, mb_substr($text, 0, 120), $now, $m['id']]);
    }
    if ((int) $m['stake'] > 0) {
        $outcome = $outcome ?: ($winnerColor ? 'win' : 'draw');
        $winnerUserId = $winnerColor ? m_user_id_of($m, $winnerColor) : null;
        return stake_settle($pdo, $m['code'], $outcome, $winnerUserId);
    }
    return null;
}

/*
 * Phát lại ván từ DB bằng engine để biết thế cờ hiện tại.
 * Đây là nguồn sự thật duy nhất — không tin gì từ client.
 */
function m_replay($m) {
    $moves = json_decode($m['moves'] ?: '[]', true);
    if (!is_array($moves)) $moves = [];
    return Xiangqi::replay($moves);
}

function handle_match($pdo, $sub, $method, $input) {
    $now = date('Y-m-d H:i:s');

    // ---- Luật cược (cho client hiện lên giao diện) ----
    if ($sub === 'rules' && $method === 'GET') {
        $uid = $_SESSION['userId'] ?? null;
        $balance = $uid ? points_balance($pdo, $uid) : 0;
        out(stake_rules() + ['loggedIn' => (bool) $uid, 'balance' => $balance]);
    }

    if ($sub === 'create' && $method === 'POST') {
        $u = m_require_user($pdo);
        $stake = m_read_stake($input, $u);
        $code = gen_code($pdo);
        $token = gen_token();
        $pdo->prepare("INSERT INTO matches (code, status, is_quick, host_name, red_name, red_token, red_user_id, stake, turn, moves, red_seen, created_at, updated_at)
                       VALUES (?, 'waiting', 0, ?, ?, ?, ?, ?, 'r', '[]', ?, ?, ?)")
            ->execute([$code, $u['username'], $u['username'], $token, $u['id'], $stake, $now, $now, $now]);
        out(['code' => $code, 'token' => $token, 'color' => 'r', 'stake' => $stake]);
    }

    if ($sub === 'join' && $method === 'POST') {
        $u = m_require_user($pdo);
        $m = m_find($pdo, $input['code'] ?? '');
        if (!$m) out(['error' => 'No room found with that code'], 404);
        if ($m['status'] !== 'waiting' || $m['black_token']) out(['error' => 'That room is already full or has started'], 409);
        if ((int) $m['red_user_id'] === (int) $u['id']) out(['error' => 'You cannot join your own room'], 409);

        /*
         * Phòng mời riêng: CHỈ người được mời vào được.
         * Chốt chặn thật sự của tính năng mời đấu — mã phòng chỉ có 4 chữ số,
         * thiếu dòng này thì dò 10.000 mã là chiếm được suất người khác đã mời.
         */
        $invited = (int) ($m['invited_user_id'] ?? 0);
        if ($invited && $invited !== (int) $u['id']) {
            out(['error' => 'That room is reserved for another player.'], 403);
        }

        $stake = (int) $m['stake'];
        if ((int) $u['points'] < $stake) {
            out(['error' => 'You need ' . $stake . ' points for this room — you have ' . (int) $u['points'] . '.'], 400);
        }

        // TRỪ điểm cược của cả hai TRƯỚC, chỉ khi thành công mới mở ván.
        $open = stake_open($pdo, $m['code'], $stake, (int) $m['red_user_id'], (int) $u['id']);
        if (!$open['ok']) {
            if ($open['code'] === 'INSUFFICIENT') {
                $mine = (int) $open['userId'] === (int) $u['id'];
                out(['error' => $mine
                    ? 'You need ' . $stake . ' points for this game — you have ' . $open['balance'] . '.'
                    : 'Your opponent no longer has enough points for this stake.'], 409);
            }
            out(['error' => 'Could not start the staked game.'], 409);
        }

        $token = gen_token();
        $st = $pdo->prepare("UPDATE matches SET black_name=?, black_token=?, black_user_id=?, status='playing', black_seen=?, updated_at=? WHERE id=? AND status='waiting'");
        $st->execute([$u['username'], $token, $u['id'], $now, $now, $m['id']]);
        if ($st->rowCount() === 0) {
            // Ai đó vào trước mất rồi -> hoàn cược, không để treo điểm.
            stake_settle($pdo, $m['code'], 'abort');
            out(['error' => 'That room was just taken.'], 409);
        }
        out(['code' => $m['code'], 'token' => $token, 'color' => 'b', 'stake' => $stake]);
    }

    if ($sub === 'quick' && $method === 'POST') {
        $u = m_require_user($pdo);
        $stake = m_read_stake($input, $u);
        $token = gen_token();

        // Chỉ ghép người cược BẰNG NHAU, và không ghép với chính mình.
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare("SELECT * FROM matches
                                  WHERE status='waiting' AND is_quick=1 AND black_token IS NULL
                                    AND stake = ? AND red_user_id <> ?
                                    AND updated_at > (NOW() - INTERVAL 2 MINUTE)
                                  ORDER BY id ASC LIMIT 1 FOR UPDATE");
            $st->execute([$stake, $u['id']]);
            $m = $st->fetch();

            if ($m) {
                $pdo->prepare("UPDATE matches SET black_name=?, black_token=?, black_user_id=?, status='playing', black_seen=?, updated_at=? WHERE id=?")
                    ->execute([$u['username'], $token, $u['id'], $now, $now, $m['id']]);
                $pdo->commit();

                // Trừ cược SAU khi ghép xong (stake_open tự mở transaction riêng).
                $open = stake_open($pdo, $m['code'], $stake, (int) $m['red_user_id'], (int) $u['id']);
                if (!$open['ok']) {
                    $pdo->prepare("UPDATE matches SET status='ended', result_text=? WHERE id=?")
                        ->execute(['Could not start: not enough points.', $m['id']]);
                    out(['error' => 'Could not start the staked game — one side is short on points.'], 409);
                }
                out(['code' => $m['code'], 'token' => $token, 'color' => 'b', 'waiting' => false, 'stake' => $stake]);
            } else {
                $code = gen_code($pdo);
                $pdo->prepare("INSERT INTO matches (code, status, is_quick, host_name, red_name, red_token, red_user_id, stake, turn, moves, red_seen, created_at, updated_at)
                               VALUES (?, 'waiting', 1, ?, ?, ?, ?, ?, 'r', '[]', ?, ?, ?)")
                    ->execute([$code, $u['username'], $u['username'], $token, $u['id'], $stake, $now, $now, $now]);
                $pdo->commit();
                out(['code' => $code, 'token' => $token, 'color' => 'r', 'waiting' => true, 'stake' => $stake]);
            }
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            out(['error' => 'Could not find a match.'], 500);
        }
    }

    if ($sub === 'list' && $method === 'GET') {
        // Dọn phòng chờ quá cũ (chưa ai vào nên chưa trừ điểm ai).
        $pdo->exec("DELETE FROM matches WHERE status='waiting' AND updated_at < (NOW() - INTERVAL 30 MINUTE)");

        // Sảnh hỏi danh sách mỗi ~4s -> dùng luôn làm nhịp tim để biết ai đang online.
        m_touch($pdo, $_SESSION['userId'] ?? null);
        $onlineRows = $pdo->query("SELECT username FROM users
                                    WHERE last_seen > (NOW() - INTERVAL " . (int) M_ONLINE_SECONDS . " SECOND)
                                    ORDER BY username LIMIT 100")->fetchAll();

        // invited_user_id IS NULL: phòng mời riêng KHÔNG hiện ở danh sách công khai,
        // nếu không thì người ngoài thấy và bấm vào chỉ để nhận lỗi "dành cho người khác".
        $rooms = $pdo->query("SELECT code, host_name, stake FROM matches WHERE status='waiting' AND is_quick=0 AND invited_user_id IS NULL AND updated_at > (NOW() - INTERVAL 2 MINUTE) ORDER BY id DESC LIMIT 50")->fetchAll();
        $liveRows = $pdo->query("SELECT code, red_name, black_name, moves, stake FROM matches WHERE status='playing' AND updated_at > (NOW() - INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 50")->fetchAll();
        out([
            'rooms' => array_map(fn($r) => ['code' => $r['code'], 'host' => $r['host_name'], 'stake' => (int) $r['stake']], $rooms),
            'live' => array_map(function ($r) {
                $mv = json_decode($r['moves'] ?: '[]', true);
                return ['code' => $r['code'], 'red' => $r['red_name'], 'black' => $r['black_name'],
                        'moves' => is_array($mv) ? count($mv) : 0, 'stake' => (int) $r['stake']];
            }, $liveRows),
            'online' => array_column($onlineRows, 'username'),
        ]);
    }

    if ($sub === 'state' && $method === 'GET') {
        $m = m_find($pdo, $_GET['code'] ?? '');
        if (!$m) out(['error' => 'Game not found'], 404);
        $token = $_GET['token'] ?? '';
        $since = max(0, (int) ($_GET['since'] ?? 0));
        $color = m_color($m, $token);

        /*
         * Đang ở trong phòng cũng là đang online. Cần dòng này vì sảnh chỉ gọi
         * 'list' (nhịp tim cũ) khi CHƯA vào phòng — thiếu nó thì người đang chờ
         * trong phòng của mình sẽ rơi khỏi danh sách "đang online" sau 30 giây.
         */
        m_touch($pdo, $_SESSION['userId'] ?? null);

        // cập nhật "đang xem" cho người chơi
        if ($color === 'r') $pdo->prepare("UPDATE matches SET red_seen=? WHERE id=?")->execute([$now, $m['id']]);
        elseif ($color === 'b') $pdo->prepare("UPDATE matches SET black_seen=? WHERE id=?")->execute([$now, $m['id']]);

        // Đối thủ mất tích quá lâu -> xử thua, chia điểm ngay (chống rút mạng để né cược).
        if ($color && $m['status'] === 'playing') {
            $oppSeen = $color === 'r' ? $m['black_seen'] : $m['red_seen'];
            if ($oppSeen && (strtotime($now) - strtotime($oppSeen)) > M_ABANDON_SECONDS) {
                m_finish($pdo, $m, $color, 'Opponent left the game.');
                $m = m_find($pdo, $m['code']);
            }
        }

        $moves = json_decode($m['moves'] ?: '[]', true);
        if (!is_array($moves)) $moves = [];
        $oppSeen = $color === 'r' ? $m['black_seen'] : ($color === 'b' ? $m['red_seen'] : null);
        $oppOnline = $oppSeen ? (strtotime($now) - strtotime($oppSeen) <= 15) : false;

        $payload = [
            'status' => $m['status'],
            'color' => $color,
            'red' => $m['red_name'],
            'black' => $m['black_name'],
            'turn' => $m['turn'],
            'total' => count($moves),
            'moves' => array_slice($moves, $since),
            'result' => $m['result_text'],
            'winner' => $m['winner'],
            'opponentOnline' => $oppOnline,
            'stake' => (int) $m['stake'],
            'pot' => (int) $m['stake'] * 2,
            'chat' => (json_decode(($m['chat'] ?? '') ?: '[]', true) ?: []),
        ];

        // Ván xong: kèm chi tiết chia điểm + số dư mới cho đúng người.
        if ($color && $m['status'] === 'ended' && (int) $m['stake'] > 0) {
            $st = $pdo->prepare('SELECT * FROM stake_matches WHERE code = ? LIMIT 1');
            $st->execute([$m['code']]);
            if ($sm = $st->fetch()) {
                $myId = m_user_id_of($m, $color);
                $payload['settlement'] = [
                    'outcome' => $sm['outcome'],
                    'stake' => (int) $sm['stake'],
                    'pot' => (int) $sm['pot'],
                    'won' => $sm['winner_user_id'] !== null && (int) $sm['winner_user_id'] === $myId,
                    'winnerPoints' => (int) $sm['winner_points'],
                    'housePoints' => (int) $sm['house_points'],
                    'balance' => points_balance($pdo, $myId),
                ];
            }
        }
        out($payload);
    }

    // ---- Chat trong phòng ----
    if ($sub === 'chat' && $method === 'POST') {
        $m = m_find($pdo, $input['code'] ?? '');
        if (!$m) out(['error' => 'Game not found'], 404);
        $color = m_color($m, $input['token'] ?? '');
        if (!$color) out(['error' => 'You are not in this game'], 403);
        $text = trim((string) ($input['text'] ?? ''));
        if ($text === '') out(['ok' => false]);
        if (mb_strlen($text) > 200) $text = mb_substr($text, 0, 200);
        $name = $color === 'r' ? ($m['red_name'] ?: 'Red') : ($m['black_name'] ?: 'Black');
        $chat = json_decode(($m['chat'] ?? '') ?: '[]', true);
        if (!is_array($chat)) $chat = [];
        $chat[] = ['who' => $color, 'name' => $name, 'text' => $text, 'ts' => time()];
        if (count($chat) > 60) $chat = array_slice($chat, -60); // giữ 60 tin gần nhất
        $pdo->prepare("UPDATE matches SET chat=?, updated_at=? WHERE id=?")
            ->execute([json_encode($chat, JSON_UNESCAPED_UNICODE), $now, $m['id']]);
        out(['ok' => true]);
    }

    /*
     * Đi một nước. Server PHÁT LẠI toàn bộ ván bằng engine rồi mới nhận nước mới —
     * nước phạm luật bị từ chối, và server tự phát hiện chiếu hết để chia điểm.
     */
    if ($sub === 'move' && $method === 'POST') {
        $m = m_find($pdo, $input['code'] ?? '');
        if (!$m) out(['error' => 'Game not found'], 404);
        if ($m['status'] !== 'playing') out(['error' => 'This game is not in progress'], 409);
        $color = m_color($m, $input['token'] ?? '');
        if (!$color) out(['error' => 'You are not in this game'], 403);
        if ($color !== $m['turn']) out(['error' => 'It is not your turn'], 409);

        list($game, $applied) = m_replay($m);
        if ($game->turn !== $color) out(['error' => 'Board is out of sync, please reload'], 409);

        $rec = $game->move($input['from'] ?? null, $input['to'] ?? null);
        if ($rec === null) out(['error' => 'Illegal move', 'illegal' => true], 400);

        $moves = json_decode($m['moves'] ?: '[]', true);
        if (!is_array($moves)) $moves = [];
        $moves[] = ['from' => $rec['from'], 'to' => $rec['to']];
        $next = $game->turn;
        $seenCol = $color === 'r' ? 'red_seen' : 'black_seen';
        $pdo->prepare("UPDATE matches SET moves=?, turn=?, $seenCol=?, updated_at=? WHERE id=?")
            ->execute([json_encode($moves), $next, $now, $now, $m['id']]);

        // Server tự kết luận ván đã xong chưa — không đợi client báo.
        $stt = $game->status();
        $ended = false;
        if (!empty($stt['over'])) {
            $winner = $stt['loser'] === 'r' ? 'b' : 'r';
            $wName = $winner === 'r' ? ($m['red_name'] ?: 'Red') : ($m['black_name'] ?: 'Black');
            $reason = $stt['reason'] === 'checkmate' ? 'checkmate' : 'stalemate';
            $m['moves'] = json_encode($moves);
            m_finish($pdo, $m, $winner, $wName . ' won (' . $reason . ').');
            $ended = true;
        }
        out(['ok' => true, 'total' => count($moves), 'ended' => $ended]);
    }

    if ($sub === 'resign' && $method === 'POST') {
        $m = m_find($pdo, $input['code'] ?? '');
        if (!$m) out(['error' => 'Game not found'], 404);
        $color = m_color($m, $input['token'] ?? '');
        if (!$color) out(['error' => 'You are not in this game'], 403);
        if ($m['status'] === 'ended') out(['ok' => true]);
        $loser = $color === 'r' ? ($m['red_name'] ?: 'Red') : ($m['black_name'] ?: 'Black');
        m_finish($pdo, $m, $color === 'r' ? 'b' : 'r', $loser . ' resigned.');
        out(['ok' => true]);
    }

    // Hai bên đồng ý hòa -> hoàn cược. Chỉ chấp nhận khi CẢ HAI cùng bấm.
    if ($sub === 'draw' && $method === 'POST') {
        $m = m_find($pdo, $input['code'] ?? '');
        if (!$m) out(['error' => 'Game not found'], 404);
        $color = m_color($m, $input['token'] ?? '');
        if (!$color) out(['error' => 'You are not in this game'], 403);
        if ($m['status'] === 'ended') out(['ok' => true]);

        $chat = json_decode(($m['chat'] ?? '') ?: '[]', true);
        if (!is_array($chat)) $chat = [];
        $offers = array_filter($chat, fn($c) => ($c['text'] ?? '') === '__draw_offer__');
        $byOther = array_filter($offers, fn($c) => ($c['who'] ?? '') !== $color);

        if ($byOther) {
            m_finish($pdo, $m, null, 'Both players agreed to a draw.', 'draw');
            out(['ok' => true, 'agreed' => true]);
        }
        // Ghi lời đề nghị của mình, chờ đối thủ bấm.
        $chat[] = ['who' => $color, 'name' => '', 'text' => '__draw_offer__', 'ts' => time()];
        $pdo->prepare("UPDATE matches SET chat=?, updated_at=? WHERE id=?")
            ->execute([json_encode($chat, JSON_UNESCAPED_UNICODE), $now, $m['id']]);
        out(['ok' => true, 'agreed' => false]);
    }

    /* ==================== MỜI ĐẤU TRỰC TIẾP ====================
     * Chọn người đang online -> mở phòng GIỮ RIÊNG cho người đó.
     * Điểm cược CHƯA bị trừ lúc mời; chỉ trừ khi người kia bấm nhận (đi qua
     * 'join' như phòng thường). Nên từ chối / hết hạn không tốn của ai đồng nào.
     */

    /*
     * ---- Trạng thái sảnh của RIÊNG mình ----
     * Gộp 3 thứ vào một lượt hỏi (ai đang online + lời mời đang chờ mình + số dư)
     * vì sảnh gọi endpoint này mỗi 4 giây — tách ra là nhân ba số request.
     */
    if ($sub === 'players' && $method === 'GET') {
        $u = m_require_user($pdo);
        m_touch($pdo, $u['id']); // ngồi ở sảnh chờ lời mời cũng là đang online

        /*
         * KHÔNG trả về số điểm của người khác: biết ai nhiều điểm là biết nên
         * nhắm vào ai. Người được mời có đủ điểm hay không thì lúc bấm nhận
         * ('join') server kiểm và báo cho chính họ.
         */
        $st = $pdo->prepare(
            "SELECT u.id, u.username, u.elo, u.wins, u.losses,
                    EXISTS(SELECT 1 FROM matches m
                            WHERE m.status = 'playing'
                              AND m.updated_at > (NOW() - INTERVAL 1 MINUTE)
                              AND (m.red_user_id = u.id OR m.black_user_id = u.id)) AS playing,
                    EXISTS(SELECT 1 FROM matches i
                            WHERE i.status = 'waiting' AND i.black_token IS NULL
                              AND i.red_user_id = ? AND i.invited_user_id = u.id
                              AND i.created_at > (NOW() - INTERVAL " . (int) M_INVITE_SECONDS . " SECOND)) AS invited
               FROM users u
              WHERE u.last_seen > (NOW() - INTERVAL " . (int) M_ONLINE_SECONDS . " SECOND)
                AND u.id <> ?
              ORDER BY u.username
              LIMIT 100"
        );
        $st->execute([$u['id'], $u['id']]);
        $players = array_map(function ($r) {
            return [
                'id'      => (int) $r['id'],
                'name'    => $r['username'],
                'elo'     => (int) $r['elo'],
                'wins'    => (int) $r['wins'],
                'losses'  => (int) $r['losses'],
                'busy'    => (bool) $r['playing'],
                'invited' => (bool) $r['invited'],
            ];
        }, $st->fetchAll());

        // Lời mời đang chờ MÌNH trả lời.
        $st = $pdo->prepare("SELECT code, host_name, stake FROM matches
                              WHERE invited_user_id = ? AND status = 'waiting' AND black_token IS NULL
                                AND created_at > (NOW() - INTERVAL " . (int) M_INVITE_SECONDS . " SECOND)
                              ORDER BY id DESC LIMIT 5");
        $st->execute([$u['id']]);
        $invites = array_map(function ($r) {
            return ['code' => $r['code'], 'from' => $r['host_name'], 'stake' => (int) $r['stake']];
        }, $st->fetchAll());

        out(['players' => $players, 'invites' => $invites, 'balance' => (int) $u['points']]);
    }

    // ---- Mời một người cụ thể ----
    if ($sub === 'invite' && $method === 'POST') {
        $u = m_require_user($pdo);
        m_touch($pdo, $u['id']);
        $stake = m_read_stake($input, $u); // kiểm mức cược + số dư của CHÍNH mình

        $toId = (int) ($input['toUserId'] ?? 0);
        if ($toId <= 0) out(['error' => 'Pick a player to invite.'], 400);
        if ($toId === (int) $u['id']) out(['error' => 'You cannot invite yourself.'], 400);

        $st = $pdo->prepare('SELECT id, username, last_seen FROM users WHERE id = ? LIMIT 1');
        $st->execute([$toId]);
        $to = $st->fetch();
        if (!$to) out(['error' => 'That player no longer exists.'], 404);
        if (!$to['last_seen'] || (time() - strtotime($to['last_seen'])) > M_INVITE_ONLINE_SECONDS) {
            out(['error' => $to['username'] . ' just went offline.'], 409);
        }
        if (m_is_playing($pdo, $toId)) {
            out(['error' => $to['username'] . ' is in a game right now.'], 409);
        }

        // Bấm mời hai lần -> trả lại đúng lời mời đang treo, không mở phòng thứ hai.
        $st = $pdo->prepare("SELECT code, red_token, stake FROM matches
                              WHERE status = 'waiting' AND black_token IS NULL
                                AND red_user_id = ? AND invited_user_id = ?
                                AND created_at > (NOW() - INTERVAL " . (int) M_INVITE_SECONDS . " SECOND)
                              ORDER BY id DESC LIMIT 1");
        $st->execute([$u['id'], $toId]);
        if ($old = $st->fetch()) {
            out(['code' => $old['code'], 'token' => $old['red_token'], 'color' => 'r',
                 'stake' => (int) $old['stake'], 'to' => $to['username'], 'resent' => true]);
        }

        /*
         * Dọn lời mời cũ của chính mình -> mỗi người chỉ treo một lời mời.
         * Chỉ xoá dòng CÓ invited_user_id: phòng công khai đang chờ (tạo bằng
         * 'create') không được biến mất chỉ vì người ta mời thêm ai đó.
         */
        $pdo->prepare("DELETE FROM matches
                        WHERE status = 'waiting' AND black_token IS NULL
                          AND red_user_id = ? AND invited_user_id IS NOT NULL")
            ->execute([$u['id']]);

        $code = gen_code($pdo);
        $token = gen_token();
        $pdo->prepare("INSERT INTO matches (code, status, is_quick, host_name, red_name, red_token, red_user_id, invited_user_id, stake, turn, moves, red_seen, created_at, updated_at)
                       VALUES (?, 'waiting', 0, ?, ?, ?, ?, ?, ?, 'r', '[]', ?, ?, ?)")
            ->execute([$code, $u['username'], $u['username'], $token, $u['id'], $toId, $stake, $now, $now, $now]);

        out(['code' => $code, 'token' => $token, 'color' => 'r', 'stake' => $stake,
             'to' => $to['username'], 'expiresIn' => M_INVITE_SECONDS]);
    }

    // ---- Từ chối lời mời ----
    if ($sub === 'invite/decline' && $method === 'POST') {
        $u = m_require_user($pdo);
        $m = m_find($pdo, $input['code'] ?? '');
        if (!$m) out(['ok' => true]); // đã hết hạn hoặc bị dọn -> coi như xong
        if ((int) ($m['invited_user_id'] ?? 0) !== (int) $u['id']) {
            out(['error' => 'That invite is not for you.'], 403);
        }
        /*
         * Đóng phòng lại là đủ: chưa ai bị trừ điểm (điểm chỉ trừ ở 'join').
         * Giữ lại dòng thay vì xoá để người mời poll 'state' là biết bị từ chối
         * — result_text chính là câu hiện lên cho họ.
         */
        if ($m['status'] === 'waiting') {
            $pdo->prepare("UPDATE matches SET status='ended', result_text=?, updated_at=? WHERE id=? AND status='waiting'")
                ->execute([$u['username'] . ' declined your invite.', $now, $m['id']]);
        }
        out(['ok' => true]);
    }

    out(['error' => 'Endpoint not found (match)'], 404);
}
