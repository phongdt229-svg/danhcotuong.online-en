<?php
/*
 * withdraw.php — Rút điểm về PayPal (admin duyệt tay).
 *
 * Luồng:
 *   1. Người dùng gửi yêu cầu -> điểm bị TRỪ NGAY và ghi sổ 'withdraw_hold'.
 *      Trừ ngay để cùng số điểm không thể vừa rút vừa đem cược.
 *   2. Admin xem trang quản trị, tự chuyển tiền PayPal, rồi bấm "Đã trả".
 *   3. Nếu từ chối / người dùng tự huỷ -> HOÀN lại điểm, ghi sổ 'withdraw_refund'.
 *
 * Điểm chỉ rời khỏi tài khoản đúng một lần: mọi chuyển trạng thái đều dùng
 * SELECT ... FOR UPDATE và chỉ chấp nhận khi đang ở 'pending'.
 */

require_once __DIR__ . '/points.php';

function wd_points_per_usd() { return max(1, (int) pay_cfg('WITHDRAW_POINTS_PER_USD', pay_cfg('POINTS_PER_USD', '10'))); }
function wd_min_points()     { return max(1, (int) pay_cfg('WITHDRAW_MIN_POINTS', '1000')); }
function wd_enabled()        { return pay_cfg('WITHDRAW_ENABLED', '1') === '1'; }
// Tài khoản quản trị: xem admin_user_id() trong points.php (theo tên 'admin' hoặc id chỉ định).

function wd_usd_for($points) { return round($points / wd_points_per_usd(), 2); }

function wd_rules()
{
    return [
        'enabled' => wd_enabled(),
        'minPoints' => wd_min_points(),
        'pointsPerUsd' => wd_points_per_usd(),
        'minUsd' => wd_usd_for(wd_min_points()),
    ];
}

// Chỉ tài khoản quản trị được vào khu admin.
function wd_require_admin($pdo)
{
    $admin = admin_user_id($pdo);
    if ($admin <= 0) out(['error' => 'Admin account is not configured on this server.'], 503);
    if ((int) current_user_id() !== $admin) out(['error' => 'Admin only.'], 403);
    return $admin;
}

function wd_is_admin($pdo)
{
    $admin = admin_user_id($pdo);
    return $admin > 0 && (int) current_user_id() === $admin;
}

function wd_row_public($r)
{
    return [
        'id' => (int) $r['id'],
        'points' => (int) $r['points'],
        'amountUsd' => (float) $r['amount_usd'],
        'paypalEmail' => $r['paypal_email'],
        'status' => $r['status'],
        'adminNote' => $r['admin_note'],
        'payoutRef' => $r['payout_ref'],
        'createdAt' => $r['created_at'],
        'processedAt' => $r['processed_at'],
    ];
}

function handle_withdraw($pdo, $sub, $method, $input)
{
    /* ---------- Luật rút (cho giao diện hiển thị) ---------- */
    if ($sub === 'rules' && $method === 'GET') {
        $uid = current_user_id();
        out(wd_rules() + [
            'balance' => $uid ? points_balance($pdo, $uid) : 0,
            'isAdmin' => wd_is_admin($pdo),
        ]);
    }

    /* ---------- Gửi yêu cầu rút ---------- */
    if ($sub === 'request' && $method === 'POST') {
        require_auth();
        if (!wd_enabled()) out(['error' => 'Withdrawals are temporarily unavailable.'], 503);

        $uid = (int) current_user_id();
        $points = (int) ($input['points'] ?? 0);
        $email = trim((string) ($input['paypalEmail'] ?? ''));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190) {
            out(['error' => 'Enter a valid PayPal email address.'], 400);
        }
        if ($points < wd_min_points()) {
            out(['error' => 'Minimum withdrawal is ' . wd_min_points() . ' points.'], 400);
        }

        // Chỉ cho một yêu cầu đang chờ tại một thời điểm — dễ soát, tránh spam.
        $st = $pdo->prepare("SELECT id FROM withdrawals WHERE user_id = ? AND status = 'pending' LIMIT 1");
        $st->execute([$uid]);
        if ($st->fetch()) out(['error' => 'You already have a withdrawal awaiting review.'], 409);

        $usd = wd_usd_for($points);

        $pdo->beginTransaction();
        try {
            // Khoá dòng người dùng để số dư không đổi giữa lúc kiểm và lúc trừ.
            $st = $pdo->prepare('SELECT points FROM users WHERE id = ? FOR UPDATE');
            $st->execute([$uid]);
            $row = $st->fetch();
            if (!$row) { $pdo->rollBack(); out(['error' => 'Account not found.'], 404); }
            if ((int) $row['points'] < $points) {
                $pdo->rollBack();
                out(['error' => 'Not enough points. You have ' . (int) $row['points'] . '.'], 400);
            }

            $pdo->prepare('UPDATE users SET points = points - ? WHERE id = ?')->execute([$points, $uid]);
            $pdo->prepare("INSERT INTO withdrawals (user_id, points, amount_usd, paypal_email, status)
                           VALUES (?, ?, ?, ?, 'pending')")
                ->execute([$uid, $points, $usd, $email]);
            $wid = (int) $pdo->lastInsertId();
            ledger_record($pdo, $uid, -$points, 'withdraw_hold', 'withdrawal', $wid,
                          'Withdrawal request $' . number_format($usd, 2, '.', ''));

            $balance = points_balance($pdo, $uid);
            $pdo->commit();
            out(['ok' => true, 'id' => $wid, 'points' => $points, 'amountUsd' => $usd, 'balance' => $balance], 201);
        } catch (Throwable $e) {
            $pdo->rollBack();
            out(['error' => 'Could not submit your withdrawal. Please try again.'], 500);
        }
    }

    /* ---------- Danh sách yêu cầu của tôi ---------- */
    if ($sub === 'mine' && $method === 'GET') {
        require_auth();
        $st = $pdo->prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 20');
        $st->execute([current_user_id()]);
        out([
            'withdrawals' => array_map('wd_row_public', $st->fetchAll()),
            'balance' => points_balance($pdo, current_user_id()),
        ] + wd_rules());
    }

    /* ---------- Người dùng tự huỷ khi chưa được duyệt ---------- */
    if ($sub === 'cancel' && $method === 'POST') {
        require_auth();
        $uid = (int) current_user_id();
        $id = (int) ($input['id'] ?? 0);
        out(wd_close($pdo, $id, 'cancelled', null, null, $uid));
    }

    /* ---------- ADMIN: danh sách yêu cầu ---------- */
    if ($sub === 'admin/list' && $method === 'GET') {
        require_auth();
        wd_require_admin($pdo);
        $status = $_GET['status'] ?? 'pending';
        if (!in_array($status, ['pending', 'paid', 'rejected', 'cancelled', 'all'], true)) $status = 'pending';

        $sql = 'SELECT w.*, u.username, u.email AS user_email, u.points AS user_balance
                  FROM withdrawals w JOIN users u ON u.id = w.user_id';
        $args = [];
        if ($status !== 'all') { $sql .= ' WHERE w.status = ?'; $args[] = $status; }
        $sql .= ' ORDER BY w.id DESC LIMIT 100';
        $st = $pdo->prepare($sql);
        $st->execute($args);

        $rows = array_map(function ($r) {
            return wd_row_public($r) + [
                'userId' => (int) $r['user_id'],
                'username' => $r['username'],
                'userEmail' => $r['user_email'],
                'userBalance' => (int) $r['user_balance'],
            ];
        }, $st->fetchAll());

        $sum = $pdo->query("SELECT
                COALESCE(SUM(CASE WHEN status='pending' THEN points ELSE 0 END),0) AS pending_points,
                COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0)      AS pending_count,
                COALESCE(SUM(CASE WHEN status='paid'    THEN amount_usd ELSE 0 END),0) AS paid_usd
              FROM withdrawals")->fetch();

        out([
            'withdrawals' => $rows,
            'summary' => [
                'pendingCount' => (int) $sum['pending_count'],
                'pendingPoints' => (int) $sum['pending_points'],
                'pendingUsd' => wd_usd_for((int) $sum['pending_points']),
                'paidUsd' => (float) $sum['paid_usd'],
            ],
        ] + wd_rules());
    }

    /* ---------- ADMIN: đánh dấu ĐÃ TRẢ ---------- */
    if ($sub === 'admin/paid' && $method === 'POST') {
        require_auth();
        $admin = wd_require_admin($pdo);
        $id = (int) ($input['id'] ?? 0);
        $ref = trim((string) ($input['payoutRef'] ?? ''));
        $note = trim((string) ($input['note'] ?? ''));
        out(wd_close($pdo, $id, 'paid', $note, $ref, null, $admin));
    }

    /* ---------- ADMIN: TỪ CHỐI (hoàn điểm) ---------- */
    if ($sub === 'admin/reject' && $method === 'POST') {
        require_auth();
        $admin = wd_require_admin($pdo);
        $id = (int) ($input['id'] ?? 0);
        $note = trim((string) ($input['note'] ?? ''));
        out(wd_close($pdo, $id, 'rejected', $note, null, null, $admin));
    }

    out(['error' => 'Không tìm thấy đường dẫn rút điểm'], 404);
}

/*
 * Chuyển một yêu cầu từ 'pending' sang trạng thái cuối.
 *   'paid'                -> KHÔNG hoàn điểm (điểm đã trừ lúc gửi yêu cầu, tiền đã chuyển)
 *   'rejected'/'cancelled'-> HOÀN lại điểm
 *
 * $ownerId khác null nghĩa là người dùng tự huỷ — khi đó chỉ được đụng yêu cầu của chính mình.
 */
function wd_close($pdo, $id, $newStatus, $note, $ref, $ownerId = null, $adminId = null)
{
    if ($id <= 0) out(['error' => 'Missing withdrawal id.'], 400);

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT * FROM withdrawals WHERE id = ? FOR UPDATE');
        $st->execute([$id]);
        $w = $st->fetch();
        if (!$w) { $pdo->rollBack(); out(['error' => 'Withdrawal not found.'], 404); }
        if ($ownerId !== null && (int) $w['user_id'] !== (int) $ownerId) {
            $pdo->rollBack();
            out(['error' => 'Withdrawal not found.'], 404);
        }
        if ($w['status'] !== 'pending') {
            $pdo->rollBack();
            out(['error' => 'This withdrawal was already ' . $w['status'] . '.'], 409);
        }

        $refund = ($newStatus !== 'paid');
        if ($refund) {
            $pdo->prepare('UPDATE users SET points = points + ? WHERE id = ?')
                ->execute([(int) $w['points'], (int) $w['user_id']]);
            ledger_record($pdo, (int) $w['user_id'], (int) $w['points'], 'withdraw_refund', 'withdrawal', $id,
                          $newStatus === 'cancelled' ? 'Withdrawal cancelled' : 'Withdrawal rejected');
        }

        $pdo->prepare('UPDATE withdrawals SET status = ?, admin_note = ?, payout_ref = ?, processed_at = NOW(), processed_by = ? WHERE id = ?')
            ->execute([
                $newStatus,
                $note !== null && $note !== '' ? mb_substr($note, 0, 190) : null,
                $ref !== null && $ref !== '' ? mb_substr($ref, 0, 120) : null,
                $adminId,
                $id,
            ]);

        $balance = points_balance($pdo, (int) $w['user_id']);
        $pdo->commit();
        return ['ok' => true, 'id' => $id, 'status' => $newStatus, 'refunded' => $refund, 'balance' => $balance];
    } catch (Throwable $e) {
        $pdo->rollBack();
        out(['error' => 'Could not update the withdrawal.'], 500);
    }
}
