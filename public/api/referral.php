<?php
/*
 * referral.php — Chương trình giới thiệu người chơi.
 *
 * Mã giới thiệu CHÍNH LÀ username (đã unique, đã công khai ở bảng xếp hạng),
 * nên không cần sinh mã riêng và không lo trùng. Link: /?ref=<username>
 *
 * Hoa hồng trích từ PHÍ SÀN của ván có người thắng:
 *   - ván đầu tiên sinh phí của người được giới thiệu: REFERRAL_FIRST_PERCENT (5%)
 *   - các ván sau:                                     REFERRAL_NEXT_PERCENT  (1%)
 * Hoà / ván không mở được thì không có phí -> không trả, và KHÔNG tiêu mất suất 5%.
 *
 * Ưu đãi khi người giới thiệu đấu với người mình mời (A vs B):
 *   - B thắng -> phí sàn giữ nguyên 20%
 *   - A thắng -> phí sàn chỉ 15% (người thắng nhận REFERRAL_PAIR_WINNER_PERCENT)
 *
 * SỐ LẺ ĐƯỢC CỘNG DỒN. 1% của phí 60 điểm là 0,6 điểm; làm tròn xuống sẽ thành 0
 * và hoa hồng biến mất với người cược nhỏ. Nên phần lẻ được tích vào
 * users.referral_pending, đủ 1 điểm mới cộng vào số dư.
 */

require_once __DIR__ . '/points.php';

function ref_enabled()        { return pay_cfg('REFERRAL_ENABLED', '1') === '1'; }
function ref_first_percent()  { return max(0, min(100, (float) pay_cfg('REFERRAL_FIRST_PERCENT', '5'))); }
function ref_next_percent()   { return max(0, min(100, (float) pay_cfg('REFERRAL_NEXT_PERCENT', '1'))); }
// Người giới thiệu thắng ván đấu với người mình mời -> nhận 85% pot (phí sàn 15%).
function ref_pair_winner_percent() { return max(0, min(100, (int) pay_cfg('REFERRAL_PAIR_WINNER_PERCENT', '85'))); }

function ref_rules()
{
    return [
        'enabled' => ref_enabled(),
        'firstPercent' => ref_first_percent(),
        'nextPercent' => ref_next_percent(),
        'pairWinnerPercent' => ref_pair_winner_percent(),
    ];
}

/*
 * Ghi người giới thiệu lúc đăng ký. Gọi NGAY SAU khi tạo tài khoản.
 * Trả về id người giới thiệu, hoặc 0 nếu mã không hợp lệ.
 * Mã sai thì bỏ qua im lặng — không được để việc đăng ký thất bại vì cái link.
 */
function ref_attach($pdo, $newUserId, $code)
{
    if (!ref_enabled()) return 0;
    $code = trim((string) $code);
    if ($code === '') return 0;
    try {
        $st = $pdo->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
        $st->execute([$code]);
        $r = $st->fetch();
        if (!$r) return 0;
        $refId = (int) $r['id'];
        if ($refId === (int) $newUserId) return 0; // không tự giới thiệu chính mình
        $pdo->prepare('UPDATE users SET referred_by = ? WHERE id = ?')->execute([$refId, (int) $newUserId]);
        return $refId;
    } catch (Throwable $e) {
        return 0;
    }
}

function ref_referrer_of($pdo, $userId)
{
    $st = $pdo->prepare('SELECT referred_by FROM users WHERE id = ? LIMIT 1');
    $st->execute([(int) $userId]);
    $r = $st->fetch();
    return $r && $r['referred_by'] ? (int) $r['referred_by'] : 0;
}

// Đã nạp tiền thật ít nhất một lần chưa? Tài khoản mới có 0 điểm nên muốn chơi
// ván cược buộc phải nạp; kiểm tra tường minh để sau này có tặng điểm khuyến mãi
// thì không bị lợi dụng để cày hoa hồng.
function ref_has_topup($pdo, $userId)
{
    try {
        $st = $pdo->prepare("SELECT 1 FROM point_transactions WHERE user_id = ? AND status = 'completed' LIMIT 1");
        $st->execute([(int) $userId]);
        return (bool) $st->fetch();
    } catch (Throwable $e) {
        return false;
    }
}

function ref_reward_count($pdo, $refereeUserId)
{
    $st = $pdo->prepare('SELECT COUNT(*) AS c FROM referral_rewards WHERE referee_user_id = ?');
    $st->execute([(int) $refereeUserId]);
    $r = $st->fetch();
    return $r ? (int) $r['c'] : 0;
}

/*
 * Tỷ lệ người thắng được hưởng cho MỘT ván cụ thể.
 * Chỉ giảm phí khi hai người đúng là cặp giới thiệu VÀ người thắng là người đi mời.
 * Trả về phần trăm (80 bình thường, 85 khi được ưu đãi).
 */
function ref_winner_percent_for($pdo, $redUserId, $blackUserId, $winnerUserId)
{
    $normal = stake_winner_percent();
    if (!ref_enabled()) return $normal;
    $red = (int) $redUserId; $black = (int) $blackUserId; $win = (int) $winnerUserId;
    if (!$red || !$black || !$win) return $normal;

    // Ai giới thiệu ai?
    $redRef = ref_referrer_of($pdo, $red);
    $blackRef = ref_referrer_of($pdo, $black);
    $referrer = 0;
    if ($redRef === $black) $referrer = $black;       // Đen đã mời Đỏ
    elseif ($blackRef === $red) $referrer = $red;     // Đỏ đã mời Đen
    if (!$referrer) return $normal;

    return ($win === $referrer) ? ref_pair_winner_percent() : $normal;
}

/*
 * Trả hoa hồng cho ván vừa kết thúc. PHẢI gọi BÊN TRONG transaction của
 * stake_settle() — nếu tách ra ngoài sẽ có lúc trừ của sàn mà không cộng được
 * cho người giới thiệu.
 *
 * Trả về TỔNG SỐ ĐIỂM NGUYÊN đã thực cộng, để nơi gọi trừ đúng số đó khỏi
 * phần của sàn (sổ cái luôn cân: SUM(delta) = users.points).
 */
function ref_pay_for_match($pdo, $matchCode, $matchId, $redUserId, $blackUserId, $housePoints)
{
    if (!ref_enabled() || $housePoints <= 0) return 0;

    $paidTotal = 0;
    foreach ([(int) $redUserId, (int) $blackUserId] as $refereeId) {
        if (!$refereeId) continue;
        $referrerId = ref_referrer_of($pdo, $refereeId);
        if (!$referrerId || $referrerId === $refereeId) continue;
        if (!ref_has_topup($pdo, $refereeId)) continue;

        $isFirst = ref_reward_count($pdo, $refereeId) === 0;
        $rate = $isFirst ? ref_first_percent() : ref_next_percent();
        if ($rate <= 0) continue;

        $exact = round(($housePoints * $rate) / 100, 4);
        if ($exact <= 0) continue;

        /*
         * UNIQUE(match_code, referee_user_id) là chốt chặn chống trả hai lần.
         * stake_settle() có thể được gọi lại cho cùng một ván; lần sau INSERT
         * này ném lỗi trùng khoá và ta bỏ qua, không cộng thêm đồng nào.
         */
        try {
            $pdo->prepare('INSERT INTO referral_rewards
                    (referee_user_id, referrer_user_id, match_code, is_first, house_points, rate_percent, bonus_exact, bonus_paid)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
                ->execute([$refereeId, $referrerId, mb_substr((string) $matchCode, 0, 12),
                           $isFirst ? 1 : 0, (int) $housePoints, $rate, $exact]);
        } catch (Throwable $e) {
            continue; // đã trả cho ván này rồi
        }
        $rewardId = (int) $pdo->lastInsertId();

        // Cộng phần lẻ vào ví chờ, rồi rút ra phần nguyên (nếu đã đủ 1 điểm).
        $pdo->prepare('UPDATE users SET referral_pending = referral_pending + ? WHERE id = ?')
            ->execute([$exact, $referrerId]);
        $st = $pdo->prepare('SELECT referral_pending FROM users WHERE id = ? LIMIT 1');
        $st->execute([$referrerId]);
        $row = $st->fetch();
        if (!$row) continue;

        $whole = (int) floor((float) $row['referral_pending']);
        if ($whole >= 1) {
            $pdo->prepare('UPDATE users SET points = points + ?, referral_pending = referral_pending - ? WHERE id = ?')
                ->execute([$whole, $whole, $referrerId]);
            ledger_record($pdo, $referrerId, $whole, 'referral_bonus', 'match', (int) $matchId,
                          'Referral bonus from game ' . $matchCode);
            $pdo->prepare('UPDATE referral_rewards SET bonus_paid = ? WHERE id = ?')->execute([$whole, $rewardId]);
            $paidTotal += $whole;
        }
    }
    return $paidTotal;
}

/* ---------------- API cho trang hồ sơ ---------------- */

function handle_referral($pdo, $sub, $method, $input)
{
    if ($sub === 'me' && $method === 'GET') {
        require_auth();
        $uid = (int) current_user_id();

        $st = $pdo->prepare('SELECT username, referral_pending, referred_by FROM users WHERE id = ? LIMIT 1');
        $st->execute([$uid]);
        $me = $st->fetch();
        if (!$me) out(['error' => 'Account not found.'], 404);

        // Người mình đã mời + tổng đã nhận.
        $st = $pdo->prepare('SELECT COUNT(*) AS c FROM users WHERE referred_by = ?');
        $st->execute([$uid]);
        $invited = (int) $st->fetch()['c'];

        $st = $pdo->prepare('SELECT COUNT(DISTINCT referee_user_id) AS players, COUNT(*) AS games,
                                    COALESCE(SUM(bonus_paid), 0) AS paid,
                                    COALESCE(SUM(bonus_exact), 0) AS earned
                               FROM referral_rewards WHERE referrer_user_id = ?');
        $st->execute([$uid]);
        $agg = $st->fetch();

        // Ai đã mời mình (để hiện "bạn được X mời").
        $invitedBy = null;
        if ($me['referred_by']) {
            $st = $pdo->prepare('SELECT username FROM users WHERE id = ? LIMIT 1');
            $st->execute([(int) $me['referred_by']]);
            $r = $st->fetch();
            if ($r) $invitedBy = $r['username'];
        }

        out(ref_rules() + [
            'code' => $me['username'],
            'invitedCount' => $invited,
            'activePlayers' => (int) $agg['players'],
            'rewardedGames' => (int) $agg['games'],
            'pointsPaid' => (int) $agg['paid'],
            'pointsEarned' => (float) $agg['earned'],
            'pendingFraction' => (float) $me['referral_pending'],
            'invitedBy' => $invitedBy,
        ]);
    }

    out(['error' => 'Endpoint not found (referral)'], 404);
}
