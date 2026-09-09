<?php
/*
 * points.php — Nạp điểm qua PayPal + sổ cái điểm (bản PHP).
 *
 * Nguyên tắc an toàn (giống hệt bản Node):
 *  1. Số tiền do MÁY CHỦ quyết định khi tạo đơn — client chỉ chọn gói, không gửi số tiền.
 *  2. Điểm chỉ cộng SAU KHI PayPal xác nhận capture COMPLETED, và tính theo số tiền
 *     PayPal THỰC SỰ thu được (không tin số client gửi lên).
 *  3. Mỗi order_id chỉ cộng đúng một lần — chặn bằng UNIQUE KEY + SELECT ... FOR UPDATE.
 */

// ===== Cấu hình =====
function pay_cfg($key, $default = '')
{
    $v = getenv($key);
    if ($v !== false && $v !== '') return $v;
    static $file = null;
    if ($file === null) {
        $p = __DIR__ . '/payment-config.php';
        $file = is_file($p) ? (require $p) : [];
    }
    return isset($file[$key]) && $file[$key] !== '' ? $file[$key] : $default;
}

function pp_is_live()   { return strtolower(pay_cfg('PAYPAL_MODE', 'sandbox')) === 'live'; }
function pp_base()      { return pp_is_live() ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'; }
function pp_client_id() { return pay_cfg('PAYPAL_CLIENT_ID'); }
function pp_secret()    { return pay_cfg('PAYPAL_CLIENT_SECRET'); }
function pp_configured(){ return pp_client_id() !== '' && pp_secret() !== ''; }

function points_per_usd() { return max(1, (int) pay_cfg('POINTS_PER_USD', '10')); }
function points_for($usd) { return (int) floor((float) $usd * points_per_usd()); }

// Các gói cho phép. Client gửi `amount`, server chỉ nhận giá trị trong danh sách này.
function pay_packages() { return [1, 5, 10, 20, 50]; }
function is_valid_package($amount)
{
    foreach (pay_packages() as $p) if (abs($p - (float) $amount) < 0.001) return true;
    return false;
}

// ===== Gọi PayPal REST (cURL) =====
function pp_access_token()
{
    if (!pp_configured()) return null;
    $ch = curl_init(pp_base() . '/v1/oauth2/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_USERPWD => pp_client_id() . ':' . pp_secret(),
        CURLOPT_POSTFIELDS => 'grant_type=client_credentials',
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT => 30,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200) return null;
    $d = json_decode($body, true);
    return $d['access_token'] ?? null;
}

function pp_call($method, $path, $payload = null, $requestId = null)
{
    $token = pp_access_token();
    if (!$token) return ['ok' => false, 'status' => 0, 'data' => null];

    $headers = ['Authorization: Bearer ' . $token, 'Content-Type: application/json'];
    // Gọi lại cùng request-id thì PayPal không thu tiền thêm lần nữa.
    if ($requestId) $headers[] = 'PayPal-Request-Id: ' . $requestId;

    $ch = curl_init(pp_base() . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 30,
    ]);
    if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['ok' => $code >= 200 && $code < 300, 'status' => $code, 'data' => json_decode($body, true)];
}

// Rút gọn lỗi PayPal thành một dòng để ghi sổ.
function pp_describe_error($data)
{
    if (!is_array($data)) return 'no response';
    $parts = [];
    if (!empty($data['name'])) $parts[] = $data['name'];
    if (!empty($data['details'][0]['issue'])) $parts[] = $data['details'][0]['issue'];
    if (!empty($data['message'])) $parts[] = $data['message'];
    return $parts ? implode(' | ', $parts) : 'unknown error';
}

// Lấy capture đã hoàn tất (kèm số tiền thật) từ payload capture hoặc order.
function pp_completed_capture($order)
{
    $caps = $order['purchase_units'][0]['payments']['captures'] ?? null;
    if (!is_array($caps)) return null;
    foreach ($caps as $c) if (($c['status'] ?? '') === 'COMPLETED') return $c;
    return null;
}

/*
 * Tìm id tài khoản quản trị.
 * Ưu tiên ADMIN_USER_ID (nếu đặt), không có thì tra theo ADMIN_USERNAME.
 * Trả về 0 nếu chưa cấu hình hoặc tài khoản đó chưa tồn tại.
 * Kết quả được nhớ trong 1 request để khỏi query lặp.
 */
function admin_user_id($pdo)
{
    static $cached = null;
    if ($cached !== null) return $cached;

    $byId = (int) pay_cfg('ADMIN_USER_ID', '0');
    if ($byId > 0) return $cached = $byId;

    $name = trim((string) pay_cfg('ADMIN_USERNAME', 'admin'));
    if ($name === '') return $cached = 0;

    try {
        $st = $pdo->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
        $st->execute([$name]);
        $r = $st->fetch();
        return $cached = ($r ? (int) $r['id'] : 0);
    } catch (Throwable $e) {
        return $cached = 0;
    }
}

// ===== Sổ cái =====
function ledger_labels()
{
    return [
        'topup' => 'Top-up',
        'stake_hold' => 'Stake placed',
        'stake_win' => 'Stake won',
        'stake_refund' => 'Stake refunded',
        'house_fee' => 'House fee',
        'adjust' => 'Adjustment',
        'withdraw_hold' => 'Withdrawal requested',
        'withdraw_refund' => 'Withdrawal returned',
    ];
}

/**
 * Ghi một dòng sổ cái. PHẢI gọi bên trong transaction đang mở, SAU khi users.points
 * đã cập nhật — hàm tự đọc lại số dư mới.
 */
function ledger_record($pdo, $userId, $delta, $kind, $refType = null, $refId = null, $note = null)
{
    $st = $pdo->prepare('SELECT points FROM users WHERE id = ? LIMIT 1');
    $st->execute([$userId]);
    $row = $st->fetch();
    if (!$row) return null;
    $balanceAfter = (int) $row['points'];
    $pdo->prepare('INSERT INTO point_ledger (user_id, delta, balance_after, kind, ref_type, ref_id, note)
                   VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$userId, $delta, $balanceAfter, $kind, $refType, $refId,
                   $note === null ? null : mb_substr($note, 0, 190)]);
    return $balanceAfter;
}

function points_balance($pdo, $userId)
{
    $st = $pdo->prepare('SELECT points FROM users WHERE id = ? LIMIT 1');
    $st->execute([$userId]);
    $r = $st->fetch();
    return $r ? (int) $r['points'] : 0;
}

function ledger_history($pdo, $userId, $limit = 25, $before = null, $kind = null)
{
    $limit = max(1, min(100, (int) $limit));
    $where = ['user_id = ?'];
    $args = [$userId];
    if ($before) { $where[] = 'id < ?'; $args[] = (int) $before; }
    if ($kind && isset(ledger_labels()[$kind])) { $where[] = 'kind = ?'; $args[] = $kind; }
    $args[] = $limit + 1; // lấy dư 1 dòng để biết còn trang sau không

    $sql = 'SELECT id, delta, balance_after, kind, ref_type, ref_id, note, created_at
              FROM point_ledger WHERE ' . implode(' AND ', $where) . '
             ORDER BY id DESC LIMIT ?';
    $st = $pdo->prepare($sql);
    foreach ($args as $i => $v) $st->bindValue($i + 1, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
    $st->execute();
    $rows = $st->fetchAll();

    $hasMore = count($rows) > $limit;
    if ($hasMore) $rows = array_slice($rows, 0, $limit);
    $labels = ledger_labels();
    foreach ($rows as &$r) {
        $r['delta'] = (int) $r['delta'];
        $r['balance_after'] = (int) $r['balance_after'];
        $r['label'] = $labels[$r['kind']] ?? $r['kind'];
    }
    unset($r);

    return [
        'entries' => $rows,
        'hasMore' => $hasMore,
        'nextBefore' => $rows ? (int) $rows[count($rows) - 1]['id'] : null,
    ];
}

function ledger_summary($pdo, $userId)
{
    $st = $pdo->prepare("SELECT
            COALESCE(SUM(CASE WHEN kind='topup'        THEN delta ELSE 0 END),0) AS topped_up,
            COALESCE(SUM(CASE WHEN kind='stake_win'    THEN delta ELSE 0 END),0) AS won,
            COALESCE(SUM(CASE WHEN kind='stake_hold'   THEN -delta ELSE 0 END),0) AS staked,
            COALESCE(SUM(CASE WHEN kind='stake_refund' THEN delta ELSE 0 END),0) AS refunded,
            COALESCE(SUM(CASE WHEN kind='withdraw_hold' THEN -delta ELSE 0 END),0) AS withdrawn_hold,
            COALESCE(SUM(CASE WHEN kind='withdraw_refund' THEN delta ELSE 0 END),0) AS withdrawn_back,
            COUNT(*) AS entries
          FROM point_ledger WHERE user_id = ?");
    $st->execute([$userId]);
    $s = $st->fetch() ?: [];
    $staked = (int) ($s['staked'] ?? 0);
    $won = (int) ($s['won'] ?? 0);
    $refunded = (int) ($s['refunded'] ?? 0);
    return [
        'toppedUp' => (int) ($s['topped_up'] ?? 0),
        'staked' => $staked,
        'won' => $won,
        'refunded' => $refunded,
        'netFromGames' => $won + $refunded - $staked,
        // Đã rút thật = số giữ lại trừ đi số được hoàn (yêu cầu bị từ chối/huỷ).
        'withdrawn' => (int) ($s['withdrawn_hold'] ?? 0) - (int) ($s['withdrawn_back'] ?? 0),
        'entries' => (int) ($s['entries'] ?? 0),
    ];
}

// Stripe Checkout (thanh toán bằng thẻ) — dùng chung bảng point_transactions và sổ cái.
require_once __DIR__ . '/stripe.php';

// ===== Router =====
function handle_payments($pdo, $sub, $method, $input)
{
    // Cấu hình công khai cho trình duyệt (client-id PayPal vốn là thông tin công khai).
    if ($sub === 'config' && $method === 'GET') {
        $packages = array_map(fn($a) => ['amount' => $a, 'points' => points_for($a)], pay_packages());
        out([
            'configured' => pp_configured(),
            'clientId' => pp_client_id(),
            'mode' => pp_is_live() ? 'live' : 'sandbox',
            // Stripe: chỉ báo bật/tắt và chế độ. Khoá bí mật KHÔNG bao giờ ra khỏi máy chủ —
            // Checkout là luồng chuyển hướng nên trình duyệt không cần khoá nào cả.
            'stripeConfigured' => stripe_configured(),
            'stripeMode' => stripe_is_live() ? 'live' : 'test',
            'pointsPerUsd' => points_per_usd(),
            'currency' => 'USD',
            'packages' => $packages,
        ]);
    }

    if ($sub === 'balance' && $method === 'GET') {
        require_auth();
        out(['balance' => points_balance($pdo, current_user_id())]);
    }

    // Lịch sử biến động điểm — đọc từ sổ cái nên khớp tuyệt đối với số dư.
    if ($sub === 'ledger' && $method === 'GET') {
        require_auth();
        $uid = current_user_id();
        $page = ledger_history($pdo, $uid, $_GET['limit'] ?? 25, $_GET['before'] ?? null, $_GET['kind'] ?? null);
        out($page + [
            'balance' => points_balance($pdo, $uid),
            'summary' => ledger_summary($pdo, $uid),
        ]);
    }

    // Danh sách đơn nạp (trang Buy Points).
    if ($sub === 'history' && $method === 'GET') {
        require_auth();
        $st = $pdo->prepare('SELECT id, order_id, amount_usd, points, status, created_at, completed_at
                               FROM point_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20');
        $st->execute([current_user_id()]);
        out(['transactions' => $st->fetchAll()]);
    }

    // Bước 1 — tạo đơn PayPal, ghi sổ ở trạng thái 'created'.
    if ($sub === 'paypal/order' && $method === 'POST') {
        require_auth();
        if (!pp_configured()) out(['error' => 'Payments are not available right now.'], 503);
        $amount = $input['amount'] ?? null;
        if (!is_valid_package($amount)) out(['error' => 'Invalid top-up package.'], 400);

        $amount = (float) $amount;
        $points = points_for($amount);
        $uid = current_user_id();

        $res = pp_call('POST', '/v2/checkout/orders', [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => 'user-' . $uid,
                'description' => $points . ' points — Chinesechess Online',
                'amount' => ['currency_code' => 'USD', 'value' => number_format($amount, 2, '.', '')],
            ]],
            'application_context' => ['shipping_preference' => 'NO_SHIPPING', 'user_action' => 'PAY_NOW'],
        ]);
        if (!$res['ok'] || empty($res['data']['id'])) {
            out(['error' => 'Could not start the payment. Please try again.'], 502);
        }

        $pdo->prepare("INSERT INTO point_transactions (user_id, provider, order_id, amount_usd, points, status)
                       VALUES (?, 'paypal', ?, ?, ?, 'created')")
            ->execute([$uid, $res['data']['id'], number_format($amount, 2, '.', ''), $points]);

        out(['orderId' => $res['data']['id'], 'amount' => $amount, 'points' => $points], 201);
    }

    // Bước 2 — capture rồi cộng điểm. Gọi lại cùng orderId vẫn an toàn.
    if ($sub === 'paypal/capture' && $method === 'POST') {
        require_auth();
        $uid = current_user_id();
        $orderId = trim((string) ($input['orderId'] ?? ''));
        if ($orderId === '') out(['error' => 'Missing order id.'], 400);

        // Ràng đơn với đúng chủ nhân — người khác không capture hộ được.
        $st = $pdo->prepare("SELECT * FROM point_transactions WHERE provider='paypal' AND order_id = ? LIMIT 1");
        $st->execute([$orderId]);
        $tx = $st->fetch();
        if (!$tx || (int) $tx['user_id'] !== (int) $uid) out(['error' => 'Order not found.'], 404);
        if ($tx['status'] === 'completed') {
            out(['alreadyCredited' => true, 'points' => (int) $tx['points'], 'balance' => points_balance($pdo, $uid)]);
        }

        // Nếu đơn đã capture trước đó (mạng chập chờn, bấm hai lần) thì đọc lại đơn
        // để lấy capture cũ thay vì báo lỗi cho người dùng.
        $res = pp_call('POST', '/v2/checkout/orders/' . rawurlencode($orderId) . '/capture', [], 'capture-' . $orderId);
        $capture = pp_completed_capture($res['data'] ?? []);
        if (!$capture && (($res['data']['details'][0]['issue'] ?? '') === 'ORDER_ALREADY_CAPTURED')) {
            $fetched = pp_call('GET', '/v2/checkout/orders/' . rawurlencode($orderId));
            $capture = pp_completed_capture($fetched['data'] ?? []);
        }

        if (!$capture) {
            $reason = mb_substr(pp_describe_error($res['data'] ?? null), 0, 190);
            try {
                $pdo->prepare("UPDATE point_transactions SET status='failed', fail_reason=? WHERE id=? AND status='created'")
                    ->execute([$reason, $tx['id']]);
            } catch (Throwable $e) { /* bỏ qua */ }
            out(['error' => 'Payment was not completed. You have not been charged for points.'], 402);
        }

        // Tính điểm theo số tiền PayPal THỰC SỰ thu, không theo số ghi lúc tạo đơn.
        $cur = $capture['amount']['currency_code'] ?? '';
        $paid = (float) ($capture['amount']['value'] ?? 0);
        if ($cur !== 'USD' || $paid <= 0) {
            out(['error' => 'Unexpected payment currency. Please contact support.'], 422);
        }
        $credit = points_for($paid);

        // Cộng điểm trong transaction có khoá dòng — hai request capture song song
        // thì chỉ một request thấy trạng thái 'created' và cộng điểm.
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('SELECT status, points FROM point_transactions WHERE id = ? FOR UPDATE');
            $st->execute([$tx['id']]);
            $locked = $st->fetch();
            if ($locked && $locked['status'] === 'completed') {
                $pdo->commit();
                out(['alreadyCredited' => true, 'points' => (int) $locked['points'], 'balance' => points_balance($pdo, $uid)]);
            }

            $pdo->prepare("UPDATE point_transactions
                              SET status='completed', capture_id=?, amount_usd=?, points=?, completed_at=NOW()
                            WHERE id=?")
                ->execute([$capture['id'] ?? null, number_format($paid, 2, '.', ''), $credit, $tx['id']]);
            $pdo->prepare('UPDATE users SET points = points + ? WHERE id = ?')->execute([$credit, $uid]);
            ledger_record($pdo, $uid, $credit, 'topup', 'paypal', (int) $tx['id'], 'PayPal $' . number_format($paid, 2, '.', ''));

            $balance = points_balance($pdo, $uid);
            $pdo->commit();
            out(['alreadyCredited' => false, 'points' => $credit, 'amount' => $paid, 'balance' => $balance]);
        } catch (Throwable $e) {
            $pdo->rollBack();
            out(['error' => 'Could not confirm the payment. Please contact support if you were charged.'], 502);
        }
    }

    // Nạp điểm bằng thẻ qua Stripe Checkout: stripe/session, stripe/confirm.
    if (strpos($sub, 'stripe/') === 0) {
        handle_stripe($pdo, substr($sub, 7), $method, $input);
    }

    out(['error' => 'Endpoint not found (payments)'], 404);
}
