<?php
/*
 * book.php — "Sổ tay nước đi tự học" của AI (chơi với máy).
 * Ý tưởng: lưu thế cờ (lúc Đen/AI tới lượt) -> nước Đen đã đi -> kết quả.
 * AI tra sổ: thế cờ đã gặp và có nước thắng tốt -> đánh luôn nước đã được chứng minh.
 * Càng nhiều ván, sổ càng "thông minh". Backend chỉ cần PHP + MySQL.
 *
 * Yêu cầu: out() (định nghĩa ở index.php) đã có sẵn khi file này được require.
 */

// Chỉ ghi học các nước trong giai đoạn khai cuộc/đầu trung cuộc (nơi thế cờ hay lặp lại).
const BOOK_MAX_PLY = 30;
// Ngưỡng tin cậy để AI dùng nước trong sổ.
const BOOK_MIN_PLAYS = 2;
const BOOK_MIN_EDGE  = 1; // (wins - losses) tối thiểu

// Bàn cờ ban đầu — PHẢI khớp initialBoard() trong xiangqi.js (y0=Đen trên, y9=Đỏ dưới).
function dct_initial_board() {
    return [
        ['r', 'h', 'e', 'a', 'k', 'a', 'e', 'h', 'r'],
        [null, null, null, null, null, null, null, null, null],
        [null, 'c', null, null, null, null, null, 'c', null],
        ['p', null, 'p', null, 'p', null, 'p', null, 'p'],
        [null, null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null, null],
        ['P', null, 'P', null, 'P', null, 'P', null, 'P'],
        [null, 'C', null, null, null, null, null, 'C', null],
        [null, null, null, null, null, null, null, null, null],
        ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'],
    ];
}

// Khoá thế cờ: chuỗi 90 ký tự (hàng-trước, '.'=ô trống) rồi md5. Khớp với client gửi lên.
function dct_board_hash($board) {
    $s = '';
    for ($y = 0; $y < 10; $y++) {
        $row = $board[$y];
        for ($x = 0; $x < 9; $x++) {
            $c = isset($row[$x]) ? $row[$x] : null;
            $s .= ($c === null || $c === '') ? '.' : $c;
        }
    }
    return md5($s);
}

function dct_mv_str($m) {
    return ((int) $m['from']['x']) . ',' . ((int) $m['from']['y']) . ',' .
           ((int) $m['to']['x']) . ',' . ((int) $m['to']['y']);
}

function dct_valid_board($b) {
    if (!is_array($b) || count($b) !== 10) return false;
    for ($y = 0; $y < 10; $y++) {
        if (!isset($b[$y]) || !is_array($b[$y]) || count($b[$y]) !== 9) return false;
    }
    return true;
}

function handle_book($pdo, $action, $method, $input) {
    // -------- TRA SỔ: trả nước Đen tốt nhất đã học cho thế cờ hiện tại --------
    if ($action === 'lookup' && $method === 'POST') {
        $board = $input['board'] ?? null;
        if (!dct_valid_board($board)) out(['move' => null]);
        $hash = dct_board_hash($board);
        $st = $pdo->prepare('SELECT move, plays, wins, losses FROM ai_book WHERE pos_hash = ?');
        $st->execute([$hash]);
        $rows = $st->fetchAll();
        if (!$rows) out(['move' => null]);

        // Chọn nước có ưu thế (wins - losses) cao nhất, đủ số lần chơi.
        $bestEdge = null;
        foreach ($rows as $r) {
            $edge = (int) $r['wins'] - (int) $r['losses'];
            if ((int) $r['plays'] < BOOK_MIN_PLAYS) continue;
            if ($bestEdge === null || $edge > $bestEdge) $bestEdge = $edge;
        }
        if ($bestEdge === null || $bestEdge < BOOK_MIN_EDGE) out(['move' => null]);

        // Trong nhóm cùng ưu thế tốt nhất -> chọn ngẫu nhiên cho đa dạng.
        $ties = [];
        foreach ($rows as $r) {
            if ((int) $r['plays'] < BOOK_MIN_PLAYS) continue;
            if (((int) $r['wins'] - (int) $r['losses']) === $bestEdge) $ties[] = $r;
        }
        if (!$ties) out(['move' => null]);
        $pick = $ties[array_rand($ties)];
        $p = explode(',', $pick['move']);
        if (count($p) !== 4) out(['move' => null]);
        out([
            'move'  => ['from' => ['x' => (int) $p[0], 'y' => (int) $p[1]], 'to' => ['x' => (int) $p[2], 'y' => (int) $p[3]]],
            'plays' => (int) $pick['plays'],
            'edge'  => $bestEdge,
        ]);
    }

    // -------- HỌC: cập nhật sổ từ một ván đã kết thúc --------
    if ($action === 'learn' && $method === 'POST') {
        $moves = $input['moves'] ?? null;
        $blackWon = !empty($input['blackWon']);
        $isDraw = !empty($input['draw']);
        if (!is_array($moves) || count($moves) < 4 || count($moves) > 600) out(['ok' => false]);

        $board = dct_initial_board();
        $upd = $pdo->prepare(
            'INSERT INTO ai_book (pos_hash, move, plays, wins, losses) VALUES (?, ?, 1, ?, ?)
             ON DUPLICATE KEY UPDATE plays = plays + 1, wins = wins + VALUES(wins), losses = losses + VALUES(losses)'
        );
        $w = $isDraw ? 0 : ($blackWon ? 1 : 0);
        $l = $isDraw ? 0 : ($blackWon ? 0 : 1);

        $learned = 0;
        $n = count($moves);
        for ($i = 0; $i < $n; $i++) {
            $m = $moves[$i];
            if (!isset($m['from']['x'], $m['from']['y'], $m['to']['x'], $m['to']['y'])) break;
            $fx = (int) $m['from']['x']; $fy = (int) $m['from']['y'];
            $tx = (int) $m['to']['x'];   $ty = (int) $m['to']['y'];
            if ($fx < 0 || $fx > 8 || $tx < 0 || $tx > 8 || $fy < 0 || $fy > 9 || $ty < 0 || $ty > 9) break;

            // index chẵn = Đỏ đi trước, index lẻ = Đen (AI). Ghi học các nước Đen ở khai cuộc.
            $isBlack = ($i % 2 === 1);
            if ($isBlack && $i < BOOK_MAX_PLY) {
                $upd->execute([dct_board_hash($board), dct_mv_str($m), $w, $l]);
                $learned++;
            }
            // Áp dụng nước đi: cờ tướng không phong cấp/đặc biệt -> chỉ dời quân.
            $board[$ty][$tx] = $board[$fy][$fx];
            $board[$fy][$fx] = null;
        }
        out(['ok' => true, 'learned' => $learned]);
    }

    // -------- THỐNG KÊ (tùy chọn, để kiểm tra) --------
    if ($action === 'stats' && $method === 'GET') {
        $row = $pdo->query('SELECT COUNT(*) AS positions, COALESCE(SUM(plays),0) AS plays FROM ai_book')->fetch();
        out(['positions' => (int) $row['positions'], 'plays' => (int) $row['plays']]);
    }

    out(['error' => 'Endpoint not found (book)'], 404);
}
