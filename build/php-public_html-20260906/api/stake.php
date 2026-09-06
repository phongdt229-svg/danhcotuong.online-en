<?php
/*
 * stake.php — Cược điểm cho ván đấu với người (bản PHP).
 *
 * Luật chia:
 *   - Mỗi bên bị TRỪ `stake` điểm ngay khi ván bắt đầu. Tổng cược (pot) = stake x 2.
 *   - Thắng: người thắng nhận 80% pot, phần còn lại về admin.
 *   - Hòa: hoàn nguyên cược cho cả hai, admin không lấy gì.
 *   - Ván không mở được (một bên thiếu điểm): không ai bị trừ.
 *
 * Mọi thay đổi điểm nằm trong transaction có khoá dòng, và mỗi ván chỉ chia
 * đúng một lần (chốt bằng cột `status`).
 */

require_once __DIR__ . '/points.php';

function stake_min()            { return max(1, (int) pay_cfg('STAKE_MIN', '150')); }
function stake_winner_percent() { return max(0, min(100, (int) pay_cfg('STAKE_WINNER_PERCENT', '80'))); }
// Tài khoản nhận phần hoa hồng — xem admin_user_id() trong points.php.

function stake_rules()
{
    return [
        'minStake' => stake_min(),
        'winnerPercent' => stake_winner_percent(),
        'housePercent' => 100 - stake_winner_percent(),
    ];
}

function stake_is_valid($stake)
{
    return is_numeric($stake) && (int) $stake == $stake && (int) $stake >= stake_min();
}

function stake_split($pot)
{
    $winner = (int) floor(($pot * stake_winner_percent()) / 100);
    return ['winnerPoints' => $winner, 'housePoints' => $pot - $winner];
}

/**
 * Trừ điểm cược của cả hai bên và mở sổ ván.
 * Khoá hai dòng users theo id tăng dần để hai ván chạy song song không khoá chéo.
 * Trả về ['ok'=>true, 'matchId'=>..] hoặc ['ok'=>false, 'code'=>.., 'userId'=>.., 'balance'=>..].
 */
function stake_open($pdo, $code, $stake, $redUserId, $blackUserId)
{
    if (!stake_is_valid($stake)) return ['ok' => false, 'code' => 'BAD_STAKE'];
    if (!$redUserId || !$blackUserId || (int) $redUserId === (int) $blackUserId) {
        return ['ok' => false, 'code' => 'BAD_PLAYERS'];
    }
    $stake = (int) $stake;

    $pdo->beginTransaction();
    try {
        $ids = [(int) $redUserId, (int) $blackUserId];
        sort($ids);
        $st = $pdo->prepare('SELECT id, points FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE');
        $st->execute($ids);
        $rows = $st->fetchAll();
        if (count($rows) !== 2) {
            $pdo->rollBack();
            return ['ok' => false, 'code' => 'NO_USER'];
        }
        foreach ($rows as $r) {
            if ((int) $r['points'] < $stake) {
                $pdo->rollBack();
                return ['ok' => false, 'code' => 'INSUFFICIENT', 'userId' => (int) $r['id'], 'balance' => (int) $r['points']];
            }
        }

        $pdo->prepare('UPDATE users SET points = points - ? WHERE id IN (?, ?)')
            ->execute([$stake, $redUserId, $blackUserId]);
        $pdo->prepare("INSERT INTO stake_matches (code, stake, pot, red_user_id, black_user_id, status)
                       VALUES (?, ?, ?, ?, ?, 'playing')")
            ->execute([mb_substr($code, 0, 12), $stake, $stake * 2, $redUserId, $blackUserId]);
        $matchId = (int) $pdo->lastInsertId();

        ledger_record($pdo, $redUserId,   -$stake, 'stake_hold', 'match', $matchId, "Stake for game $code");
        ledger_record($pdo, $blackUserId, -$stake, 'stake_hold', 'match', $matchId, "Stake for game $code");

        $pdo->commit();
        return ['ok' => true, 'matchId' => $matchId, 'stake' => $stake, 'pot' => $stake * 2];
    } catch (Throwable $e) {
        $pdo->rollBack();
        return ['ok' => false, 'code' => 'DB_ERROR'];
    }
}

/**
 * Chia điểm khi ván kết thúc.
 *   $outcome 'win'   -> $winnerUserId nhận phần thắng, admin nhận phần còn lại
 *   $outcome 'draw'  -> hoàn nguyên cược cho cả hai
 *   $outcome 'abort' -> hoàn nguyên cược (ván không đánh được)
 * Gọi lại nhiều lần cho cùng ván vẫn an toàn: lần sau không chia thêm.
 */
function stake_settle($pdo, $code, $outcome, $winnerUserId = null)
{
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT * FROM stake_matches WHERE code = ? FOR UPDATE');
        $st->execute([$code]);
        $m = $st->fetch();
        if (!$m) { $pdo->commit(); return null; }
        if ($m['status'] !== 'playing') {
            $pdo->commit();
            return [
                'alreadySettled' => true,
                'outcome' => $m['outcome'],
                'winnerPoints' => (int) $m['winner_points'],
                'housePoints' => (int) $m['house_points'],
                'stake' => (int) $m['stake'],
                'pot' => (int) $m['pot'],
                'winnerUserId' => $m['winner_user_id'] ? (int) $m['winner_user_id'] : null,
            ];
        }

        $winnerPoints = 0;
        $housePoints = 0;
        $isWin = $outcome === 'win'
            && ((int) $winnerUserId === (int) $m['red_user_id'] || (int) $winnerUserId === (int) $m['black_user_id']);

        if ($isWin) {
            $split = stake_split((int) $m['pot']);
            $winnerPoints = $split['winnerPoints'];
            $housePoints = $split['housePoints'];

            $pdo->prepare('UPDATE users SET points = points + ? WHERE id = ?')->execute([$winnerPoints, $winnerUserId]);
            ledger_record($pdo, $winnerUserId, $winnerPoints, 'stake_win', 'match', (int) $m['id'],
                          "Won game {$m['code']} (pot {$m['pot']})");

            $admin = admin_user_id($pdo);
            // Không cộng hoa hồng cho chính người thắng (trường hợp admin tự chơi).
            if ($admin > 0 && $admin !== (int) $winnerUserId && $housePoints > 0) {
                $pdo->prepare('UPDATE users SET points = points + ? WHERE id = ?')->execute([$housePoints, $admin]);
                ledger_record($pdo, $admin, $housePoints, 'house_fee', 'match', (int) $m['id'],
                              "House fee from game {$m['code']}");
            }

            $pdo->prepare("UPDATE stake_matches
                              SET status='settled', outcome='win', winner_user_id=?,
                                  winner_points=?, house_points=?, settled_at=NOW()
                            WHERE id=?")
                ->execute([$winnerUserId, $winnerPoints, $housePoints, $m['id']]);
        } else {
            // Hòa hoặc ván hỏng -> trả lại đúng số đã trừ, admin không ăn.
            $stake = (int) $m['stake'];
            $pdo->prepare('UPDATE users SET points = points + ? WHERE id IN (?, ?)')
                ->execute([$stake, $m['red_user_id'], $m['black_user_id']]);
            $note = $outcome === 'draw' ? "Draw in game {$m['code']}" : "Game {$m['code']} could not be played";
            ledger_record($pdo, (int) $m['red_user_id'],   $stake, 'stake_refund', 'match', (int) $m['id'], $note);
            ledger_record($pdo, (int) $m['black_user_id'], $stake, 'stake_refund', 'match', (int) $m['id'], $note);

            $pdo->prepare("UPDATE stake_matches SET status='refunded', outcome=?, settled_at=NOW() WHERE id=?")
                ->execute([$outcome === 'draw' ? 'draw' : 'abort', $m['id']]);
        }

        $pdo->commit();
        return [
            'alreadySettled' => false,
            'outcome' => $isWin ? 'win' : ($outcome === 'draw' ? 'draw' : 'abort'),
            'winnerPoints' => $winnerPoints,
            'housePoints' => $housePoints,
            'stake' => (int) $m['stake'],
            'pot' => (int) $m['pot'],
            'winnerUserId' => $isWin ? (int) $winnerUserId : null,
        ];
    } catch (Throwable $e) {
        $pdo->rollBack();
        return null;
    }
}
