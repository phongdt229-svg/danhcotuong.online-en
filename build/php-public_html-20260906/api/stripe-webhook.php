<?php
/*
 * stripe-webhook.php — Nhận sự kiện từ Stripe và cộng điểm.
 *
 * Vì sao cần: nếu khách trả tiền xong rồi ĐÓNG TAB ngay, trình duyệt không kịp gọi
 * bước xác nhận, đơn sẽ treo ở 'created' — tiền đã trừ mà chưa có điểm. Webhook do
 * Stripe gọi thẳng vào server nên không phụ thuộc trình duyệt khách.
 * (Luồng PayPal hiện tại CHƯA có webhook nên vẫn còn lỗ hổng này.)
 *
 * Khai báo ở Stripe Dashboard > Developers > Webhooks:
 *   URL      : https://TENMIEN/api/stripe-webhook.php
 *   Sự kiện  : checkout.session.completed
 *              checkout.session.async_payment_succeeded
 * Rồi chép "Signing secret" (whsec_...) vào STRIPE_WEBHOOK_SECRET trong payment-config.php.
 *
 * KHÔNG dùng out()/require_auth() ở đây — Stripe gọi vào, không có phiên đăng nhập.
 */

// Đọc thân request NGUYÊN BẢN trước mọi thứ khác — chữ ký tính trên đúng chuỗi byte này.
$payload = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

require_once __DIR__ . '/db.php';      // $pdo + hàm tiện ích
require_once __DIR__ . '/points.php';  // pay_cfg, points_for, ledger_record
require_once __DIR__ . '/stripe.php';  // stripe_verify_signature, stripe_credit_session (points.php da nap)

header('Content-Type: application/json; charset=utf-8');

function wh_out($code, $msg)
{
    http_response_code($code);
    echo json_encode(['received' => $code < 400, 'message' => $msg]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wh_out(405, 'POST only');

$secret = stripe_wh_secret();
if ($secret === '') wh_out(500, 'Webhook secret is not configured');

// Chữ ký sai = không phải Stripe gọi. Từ chối, tuyệt đối không cộng điểm.
if (!stripe_verify_signature($payload, $sigHeader, $secret)) wh_out(400, 'Invalid signature');

$event = json_decode($payload, true);
if (!is_array($event) || empty($event['type'])) wh_out(400, 'Malformed payload');

$type = $event['type'];
if ($type !== 'checkout.session.completed' && $type !== 'checkout.session.async_payment_succeeded') {
    // Sự kiện khác: trả 200 để Stripe khỏi gửi lại mãi.
    wh_out(200, 'Ignored: ' . $type);
}

$session = $event['data']['object'] ?? null;
if (!is_array($session) || empty($session['id'])) wh_out(400, 'No session in payload');

/*
 * Đọc lại phiên TỪ API Stripe thay vì tin payload gửi tới. Chữ ký đã chứng minh
 * payload là thật, nhưng đọc lại vẫn chắc hơn: số tiền và trạng thái lấy từ nguồn gốc.
 */
$res = stripe_call('GET', '/v1/checkout/sessions/' . rawurlencode($session['id']));
$fresh = ($res['ok'] && !empty($res['data']['id'])) ? $res['data'] : $session;

$r = stripe_credit_session($pdo, $fresh);

if (!$r['ok']) {
    // 'transaction not found' / 'not paid': không phải lỗi hệ thống, đừng bắt Stripe gửi lại.
    $soft = in_array($r['error'] ?? '', ['transaction not found', 'not paid', 'unexpected currency'], true);
    wh_out($soft ? 200 : 500, $r['error'] ?? 'error');
}

wh_out(200, $r['credited'] ? 'Credited ' . $r['points'] . ' points' : 'Already credited');
