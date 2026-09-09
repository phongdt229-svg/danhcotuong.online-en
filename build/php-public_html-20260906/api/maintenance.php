<?php
/*
 * maintenance.php — Chế độ bảo trì.
 *
 * Bật/tắt bằng SỰ TỒN TẠI của file api/maintenance.flag:
 *   có file  = đang bảo trì
 *   xoá file = chạy lại bình thường
 * Chọn cách này vì host KHÔNG chạy .htaccess (AllowOverride None) nên không thể
 * chuyển hướng bằng RewriteRule; và tạo/xoá một file thì làm được từ File Manager
 * của cPanel kể cả khi PHP đang hỏng.
 *
 * Nội dung flag (JSON, không bắt buộc):
 *   {"message":"...", "started":1699999999, "allow_ips":["1.2.3.4"]}
 *
 * KHÔNG chặn:
 *   - Quản trị viên đã đăng nhập  -> tự kiểm tra site trước khi mở lại
 *   - IP trong allow_ips
 *   - api/stripe-webhook.php      -> file riêng, không đi qua router này, nên
 *                                    Stripe vẫn cộng điểm được trong lúc bảo trì
 */

/*
 * File cờ phải có đuôi .php: Apache sẽ THỰC THI nó (in ra rỗng) thay vì trả nội dung.
 * Bản đầu dùng 'maintenance.flag' — ai cũng tải về đọc được, lộ cả IP quản trị.
 */
function maint_flag_path() { return __DIR__ . '/maintenance.flag.php'; }

/* Tên cũ, chỉ còn để nhận diện và xoá đi khi tắt bảo trì. */
function maint_legacy_path() { return __DIR__ . '/maintenance.flag'; }

function maint_on() { return is_file(maint_flag_path()) || is_file(maint_legacy_path()); }

/* Ghi trạng thái. Lưu dạng PHP trả về mảng nên mở thẳng bằng trình duyệt không thấy gì. */
function maint_write(array $d)
{
    $php = "<?php\n"
         . "/* File NAY la cong tac bao tri. Xoa file = tat bao tri. */\n"
         . 'return ' . var_export($d, true) . ";\n";
    return @file_put_contents(maint_flag_path(), $php) !== false;
}

/* Tắt bảo trì: xoá cả file mới lẫn file kiểu cũ. */
function maint_clear()
{
    $ok = true;
    foreach ([maint_flag_path(), maint_legacy_path()] as $p) {
        if (is_file($p) && !@unlink($p)) $ok = false;
    }
    return $ok;
}

/* Đọc cấu hình trong flag. File rỗng hoặc hỏng vẫn tính là ĐANG BẬT. */
function maint_data()
{
    if (!maint_on()) return null;

    $d = null;
    if (is_file(maint_flag_path())) {
        $d = @include maint_flag_path();          // file rỗng -> trả về 1
    } elseif (is_file(maint_legacy_path())) {
        $d = json_decode((string) @file_get_contents(maint_legacy_path()), true);
    }
    if (!is_array($d)) $d = [];

    $mtime = @filemtime(is_file(maint_flag_path()) ? maint_flag_path() : maint_legacy_path());
    return [
        'message'   => isset($d['message']) && $d['message'] !== ''
            ? (string) $d['message']
            : 'We are updating the site. Please come back in a few minutes.',
        'started'   => isset($d['started']) ? (int) $d['started'] : (int) $mtime,
        'allow_ips' => isset($d['allow_ips']) && is_array($d['allow_ips']) ? $d['allow_ips'] : [],
    ];
}

/* Người gọi hiện tại có được đi tiếp không? */
function maint_is_exempt($pdo)
{
    $d = maint_data();
    if ($d === null) return true;

    // IP được cho qua (để tự kiểm tra từ máy mình).
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if ($ip !== '' && in_array($ip, $d['allow_ips'], true)) return true;

    // Quản trị viên đã đăng nhập.
    $uid = $_SESSION['userId'] ?? null;
    if ($uid) {
        require_once __DIR__ . '/points.php';   // admin_user_id()
        $adminId = admin_user_id($pdo);
        if ($adminId > 0 && (int) $uid === (int) $adminId) return true;
    }

    return false;
}

/*
 * Các route vẫn cho chạy khi đang bảo trì.
 * Phải có 'login' + 'recaptcha/config' thì quản trị viên mới đăng nhập được
 * để tự kiểm tra site; 'health' để công cụ giám sát vẫn hỏi được.
 */
function maint_allowed_route($route)
{
    return in_array($route, ['health', 'login', 'logout', 'maintenance/status', 'recaptcha/config'], true);
}

/* Cổng chặn — gọi một lần ở đầu router. */
function maint_gate($pdo, $route)
{
    // Endpoint để trình duyệt hỏi trạng thái, luôn trả lời được.
    if ($route === 'maintenance/status') {
        $d = maint_data();
        out([
            'maintenance' => $d !== null,
            'message'     => $d['message'] ?? null,
            'exempt'      => $d === null ? true : maint_is_exempt($pdo),
        ]);
    }

    if (!maint_on()) return;
    if (maint_allowed_route($route)) return;
    if (maint_is_exempt($pdo)) return;

    $d = maint_data();
    header('Retry-After: 600');
    out([
        'error'       => $d['message'],
        'maintenance' => true,   // api.js thấy cờ này thì đưa khách sang maintenance.html
    ], 503);
}
