<?php
/*
 * recaptcha.php — Xác minh Google reCAPTCHA v3 cho form đăng ký / đăng nhập.
 *
 * v3 không hiện ô tích. Trình duyệt lấy token ngầm rồi gửi kèm request; server
 * hỏi Google và nhận lại điểm 0.0–1.0 (càng cao càng giống người thật).
 *
 * Ba chốt kiểm, thiếu một cái là bỏ lọt bot:
 *   1. success  — token hợp lệ, chưa dùng, chưa hết hạn
 *   2. score    — phải >= ngưỡng cấu hình
 *   3. action   — phải khớp hành động ('login' / 'register'), để token lấy ở
 *                 trang này không đem dùng cho endpoint khác
 */

require_once __DIR__ . '/points.php'; // dùng chung pay_cfg()

function rc_site_key()   { return pay_cfg('RECAPTCHA_SITE_KEY', ''); }
function rc_secret()     { return pay_cfg('RECAPTCHA_SECRET_KEY', ''); }
function rc_min_score()  { $v = (float) pay_cfg('RECAPTCHA_MIN_SCORE', '0.5'); return ($v > 0 && $v <= 1) ? $v : 0.5; }
function rc_enabled()    { return pay_cfg('RECAPTCHA_ENABLED', '1') === '1' && rc_site_key() !== '' && rc_secret() !== ''; }
// Google không gọi được thì CHO QUA (mặc định) hay CHẶN? '1' = cho qua.
function rc_fail_open()  { return pay_cfg('RECAPTCHA_FAIL_OPEN', '1') === '1'; }

/**
 * Kiểm tra token. Trả về mảng:
 *   ['ok' => true]                      hợp lệ, hoặc chưa bật reCAPTCHA
 *   ['ok' => false, 'error' => '...']   bị từ chối
 */
function rc_verify($token, $expectedAction)
{
    if (!rc_enabled()) return ['ok' => true]; // chưa cấu hình -> không chặn ai

    $token = trim((string) $token);
    if ($token === '') {
        return ['ok' => false, 'error' => 'Captcha missing. Please reload the page and try again.'];
    }

    $post = http_build_query([
        'secret' => rc_secret(),
        'response' => $token,
        'remoteip' => $_SERVER['REMOTE_ADDR'] ?? '',
    ]);

    $ch = curl_init('https://www.google.com/recaptcha/api/siteverify');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $post,
        CURLOPT_TIMEOUT => 10,
    ]);
    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $netErr = curl_error($ch);
    curl_close($ch);

    // Không hỏi được Google (host chặn outbound, Google sập...).
    if ($httpCode !== 200 || $body === false) {
        error_log('reCAPTCHA unreachable: ' . ($netErr ?: ('HTTP ' . $httpCode)));
        return rc_fail_open()
            ? ['ok' => true]
            : ['ok' => false, 'error' => 'Cannot verify captcha right now. Please try again later.'];
    }

    $d = json_decode($body, true);
    if (!is_array($d)) {
        return rc_fail_open() ? ['ok' => true] : ['ok' => false, 'error' => 'Captcha check failed.'];
    }

    if (empty($d['success'])) {
        // Lỗi do khoá sai / cấu hình sai thì log lại để còn sửa, đừng đổ cho người dùng.
        $codes = implode(',', (array) ($d['error-codes'] ?? []));
        if (strpos($codes, 'invalid-input-secret') !== false || strpos($codes, 'invalid-keys') !== false) {
            error_log('reCAPTCHA misconfigured: ' . $codes);
            return rc_fail_open() ? ['ok' => true] : ['ok' => false, 'error' => 'Captcha is misconfigured.'];
        }
        return ['ok' => false, 'error' => 'Captcha check failed. Please reload the page and try again.'];
    }

    // Token phải sinh ra từ đúng hành động, không đem token trang khác sang dùng.
    $action = $d['action'] ?? '';
    if ($expectedAction !== '' && $action !== '' && $action !== $expectedAction) {
        return ['ok' => false, 'error' => 'Captcha action mismatch. Please reload the page.'];
    }

    $score = isset($d['score']) ? (float) $d['score'] : 0.0;
    if ($score < rc_min_score()) {
        error_log('reCAPTCHA low score ' . $score . ' for action ' . $action);
        return ['ok' => false, 'error' => 'Your request looked automated. Please try again.'];
    }

    return ['ok' => true, 'score' => $score];
}

// Dùng trong route: chặn luôn nếu không qua.
function rc_require($token, $action)
{
    $r = rc_verify($token, $action);
    if (!$r['ok']) out(['error' => $r['error'], 'captchaFailed' => true], 400);
}
