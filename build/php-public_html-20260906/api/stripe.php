<?php
/*
 * stripe.php — Nạp điểm qua Stripe Checkout (thẻ Visa/Mastercard...).
 *
 * Giữ ĐÚNG ba nguyên tắc an toàn của points.php (PayPal):
 *  1. Số tiền do MÁY CHỦ quyết định khi tạo phiên — client chỉ chọn gói.
 *  2. Điểm chỉ cộng khi Stripe báo payment_status='paid', và tính theo amount_total
 *     Stripe THỰC SỰ thu (đơn vị cent), không tin số client gửi lên.
 *  3. Mỗi Checkout Session chỉ cộng đúng một lần — chặn bằng UNIQUE KEY
 *     (provider, order_id) + SELECT ... FOR UPDATE.
 *
 * Khác PayPal một điểm quan trọng: có webhook (stripe-webhook.php). Nhờ đó khách
 * đóng tab ngay sau khi trả tiền thì điểm VẪN được cộng — lỗ hổng mà luồng PayPal
 * hiện tại chưa vá.
 */

// ===== Cấu hình =====
function stripe_secret()     { return pay_cfg('STRIPE_SECRET_KEY'); }
function stripe_wh_secret()  { return pay_cfg('STRIPE_WEBHOOK_SECRET'); }
function stripe_configured() { return stripe_secret() !== ''; }
// Chế độ suy ra từ chính khoá, không cần cấu hình thêm -> không thể khai sai.
function stripe_is_live()    { return strpos(stripe_secret(), 'sk_live_') === 0; }

/* Địa chỉ site để Stripe quay về sau khi trả tiền. */
function site_base_url()
{
    $cfg = pay_cfg('SITE_URL', '');
    if ($cfg !== '') return rtrim($cfg, '/');
    $https = (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    return ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

// ===== Gọi Stripe REST (cURL, form-encoded) =====
function stripe_call($method, $path, $params = null, $idempotencyKey = null)
{
    if (!stripe_configured()) return ['ok' => false, 'status' => 0, 'data' => null];

    $url = 'https://api.stripe.com' . $path;
    $headers = ['Authorization: Bearer ' . stripe_secret()];
    if ($idempotencyKey) $headers[] = 'Idempotency-Key: ' . $idempotencyKey;

    $ch = curl_init();
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_TIMEOUT => 30,
    ];
    if ($params !== null && $method !== 'GET') {
        $body = http_build_query($params, '', '&', PHP_QUERY_RFC3986);
        $opts[CURLOPT_POSTFIELDS] = $body;
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    } elseif ($params !== null) {
        $url .= '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    }
    $opts[CURLOPT_URL] = $url;
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);

    $raw  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['ok' => $code >= 200 && $code < 300, 'status' => $code, 'data' => json_decode($raw, true)];
}

// Rút gọn lỗi Stripe thành một dòng để ghi sổ.
function stripe_describe_error($data)
{
    if (!is_array($data)) return 'no response';
    $e = $data['error'] ?? null;
    if (!is_array($e)) return 'unknown error';
    $parts = [];
    foreach (['type', 'code', 'message'] as $k) if (!empty($e[$k])) $parts[] = $e[$k];
    return $parts ? implode(' | ', $parts) : 'unknown error';
}

/*
 * Cộng điểm cho một Checkout Session đã trả tiền.
 * Dùng chung cho CẢ hai đường vào: khách quay về trang (confirm) và webhook.
 * Không đụng tới session đăng nhập — user lấy từ dòng giao dịch — nên webhook gọi được.
 *
 * Trả về: ['ok'=>bool, 'credited'=>bool, 'points'=>int, 'userId'=>int, 'error'=>string|null]
 */
function stripe_credit_session($pdo, $session)
{
    $sid = $session['id'] ?? '';
    if ($sid === '') return ['ok' => false, 'credited' => false, 'error' => 'missing session id'];

    $st = $pdo->prepare("SELECT * FROM point_transactions WHERE provider='stripe' AND order_id = ? LIMIT 1");
    $st->execute([$sid]);
    $tx = $st->fetch();
    if (!$tx) return ['ok' => false, 'credited' => false, 'error' => 'transaction not found'];

    $uid = (int) $tx['user_id'];

    if ($tx['status'] === 'completed') {
        return ['ok' => true, 'credited' => false, 'points' => (int) $tx['points'], 'userId' => $uid];
    }

    // Chỉ chấp nhận khi Stripe đã thực sự thu tiền.
    if (($session['payment_status'] ?? '') !== 'paid') {
        return ['ok' => false, 'credited' => false, 'userId' => $uid, 'error' => 'not paid'];
    }

    $currency = strtolower((string) ($session['currency'] ?? ''));
    $cents    = (int) ($session['amount_total'] ?? 0);
    if ($currency !== 'usd' || $cents <= 0) {
        return ['ok' => false, 'credited' => false, 'userId' => $uid, 'error' => 'unexpected currency'];
    }

    $paid   = $cents / 100;
    $credit = points_for($paid);
    $payRef = is_array($session['payment_intent'] ?? null)
        ? ($session['payment_intent']['id'] ?? null)
        : ($session['payment_intent'] ?? null);

    $pdo->beginTransaction();
    try {
        // Khoá dòng: hai lời gọi song song (khách quay về + webhook) chỉ một cái cộng điểm.
        $st = $pdo->prepare('SELECT status, points FROM point_transactions WHERE id = ? FOR UPDATE');
        $st->execute([$tx['id']]);
        $locked = $st->fetch();
        if ($locked && $locked['status'] === 'completed') {
            $pdo->commit();
            return ['ok' => true, 'credited' => false, 'points' => (int) $locked['points'], 'userId' => $uid];
        }

        $pdo->prepare("UPDATE point_transactions
                          SET status='completed', capture_id=?, amount_usd=?, points=?, completed_at=NOW()
                        WHERE id=?")
            ->execute([$payRef, number_format($paid, 2, '.', ''), $credit, $tx['id']]);
        $pdo->prepare('UPDATE users SET points = points + ? WHERE id = ?')->execute([$credit, $uid]);
        ledger_record($pdo, $uid, $credit, 'topup', 'stripe', (int) $tx['id'],
                      'Stripe $' . number_format($paid, 2, '.', ''));

        $pdo->commit();
        return ['ok' => true, 'credited' => true, 'points' => $credit, 'amount' => $paid, 'userId' => $uid];
    } catch (Throwable $e) {
        $pdo->rollBack();
        return ['ok' => false, 'credited' => false, 'userId' => $uid, 'error' => 'database error'];
    }
}

/*
 * Kiểm chữ ký webhook Stripe (thuật toán chính thức, không cần thư viện).
 * Header: Stripe-Signature: t=<timestamp>,v1=<hex hmac>
 * Chuỗi ký: "<timestamp>.<raw body>", HMAC-SHA256 với STRIPE_WEBHOOK_SECRET.
 */
function stripe_verify_signature($payload, $sigHeader, $secret, $tolerance = 300)
{
    if ($secret === '' || $sigHeader === '') return false;

    $timestamp = null;
    $signatures = [];
    foreach (explode(',', $sigHeader) as $part) {
        $kv = explode('=', trim($part), 2);
        if (count($kv) !== 2) continue;
        if ($kv[0] === 't') $timestamp = $kv[1];
        elseif ($kv[0] === 'v1') $signatures[] = $kv[1];
    }
    if ($timestamp === null || !$signatures) return false;

    // Chặn tấn công phát lại: bỏ qua sự kiện quá cũ.
    if (abs(time() - (int) $timestamp) > $tolerance) return false;

    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($signatures as $s) {
        if (hash_equals($expected, $s)) return true;
    }
    return false;
}

/*
 * Dựng tham số cho Checkout Session. Tách riêng để kiểm thử được mà không cần
 * phiên đăng nhập hay database.
 */
function stripe_session_params($uid, $amount, $points, $base)
{
    return [
        'mode' => 'payment',
        'success_url' => $base . '/topup.html?stripe_session_id={CHECKOUT_SESSION_ID}',
        'cancel_url'  => $base . '/topup.html?stripe_cancelled=1',
        'client_reference_id' => 'user-' . $uid,
        'line_items' => [[
            'quantity' => 1,
            'price_data' => [
                'currency' => 'usd',
                // Stripe tính bằng cent, phải là số nguyên.
                'unit_amount' => (int) round($amount * 100),
                'product_data' => ['name' => $points . ' points — Chinesechess Online'],
            ],
        ]],
        'metadata' => ['user_id' => (string) $uid, 'points' => (string) $points],
    ];
}

// ===== Các endpoint, gọi từ handle_payments() trong points.php =====
function handle_stripe($pdo, $sub, $method, $input)
{
    // Bước 1 — tạo Checkout Session, ghi sổ trạng thái 'created'.
    if ($sub === 'session' && $method === 'POST') {
        require_auth();
        if (!stripe_configured()) out(['error' => 'Card payments are not available right now.'], 503);

        $amount = $input['amount'] ?? null;
        if (!is_valid_package($amount)) out(['error' => 'Invalid top-up package.'], 400);

        $amount = (float) $amount;
        $points = points_for($amount);
        $uid    = current_user_id();
        $base   = site_base_url();

        $res = stripe_call('POST', '/v1/checkout/sessions',
                           stripe_session_params($uid, $amount, $points, $base));

        if (!$res['ok'] || empty($res['data']['id']) || empty($res['data']['url'])) {
            out(['error' => 'Could not start the card payment. Please try again.'], 502);
        }

        $pdo->prepare("INSERT INTO point_transactions (user_id, provider, order_id, amount_usd, points, status)
                       VALUES (?, 'stripe', ?, ?, ?, 'created')")
            ->execute([$uid, $res['data']['id'], number_format($amount, 2, '.', ''), $points]);

        out(['sessionId' => $res['data']['id'], 'url' => $res['data']['url'],
             'amount' => $amount, 'points' => $points], 201);
    }

    // Bước 2 — khách quay về từ Stripe: đọc lại phiên và cộng điểm.
    // Webhook cũng làm việc này; ai tới trước thì cộng, người sau nhận 'alreadyCredited'.
    if ($sub === 'confirm' && $method === 'POST') {
        require_auth();
        $uid = current_user_id();
        $sid = trim((string) ($input['sessionId'] ?? ''));
        if ($sid === '') out(['error' => 'Missing session id.'], 400);

        // Ràng phiên với đúng chủ nhân — người khác không xác nhận hộ được.
        $st = $pdo->prepare("SELECT * FROM point_transactions WHERE provider='stripe' AND order_id = ? LIMIT 1");
        $st->execute([$sid]);
        $tx = $st->fetch();
        if (!$tx || (int) $tx['user_id'] !== (int) $uid) out(['error' => 'Order not found.'], 404);
        if ($tx['status'] === 'completed') {
            out(['alreadyCredited' => true, 'points' => (int) $tx['points'], 'balance' => points_balance($pdo, $uid)]);
        }

        $res = stripe_call('GET', '/v1/checkout/sessions/' . rawurlencode($sid));
        if (!$res['ok'] || empty($res['data']['id'])) {
            out(['error' => 'Could not check the payment. Please try again in a moment.'], 502);
        }

        $r = stripe_credit_session($pdo, $res['data']);
        if (!$r['ok']) {
            if (($r['error'] ?? '') === 'not paid') {
                $reason = mb_substr('stripe: ' . ($res['data']['payment_status'] ?? 'unpaid'), 0, 190);
                try {
                    $pdo->prepare("UPDATE point_transactions SET status='failed', fail_reason=? WHERE id=? AND status='created'")
                        ->execute([$reason, $tx['id']]);
                } catch (Throwable $e) { /* bỏ qua */ }
                out(['error' => 'Payment was not completed. You have not been charged for points.'], 402);
            }
            out(['error' => 'Could not confirm the payment. Please contact support if you were charged.'], 502);
        }

        out([
            'alreadyCredited' => !$r['credited'],
            'points' => (int) $r['points'],
            'balance' => points_balance($pdo, $uid),
        ]);
    }

    out(['error' => 'Endpoint not found (stripe)'], 404);
}
