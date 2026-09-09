/*
 * api.js — Lớp gọi REST API tới backend. Dùng cookie session (credentials: include).
 *
 * Đường dẫn viết dạng '/api/...' cho dễ đọc, nhưng khi gọi thật được đổi thành
 * '/api/index.php?_route=...'. Lý do: nhiều hosting chia sẻ TẮT mod_rewrite hoặc
 * đặt AllowOverride None, khiến .htaccess không có tác dụng và mọi '/api/...'
 * trả về 404. Gọi thẳng router PHP thì chạy được ở mọi nơi, có hay không có
 * mod_rewrite đều như nhau.
 */
(function (root) {
  'use strict';

  // '/api/match/state?code=AB12&since=3'  ->  'api/index.php?_route=match/state&code=AB12&since=3'
  //
  // Trả về đường dẫn TƯƠNG ĐỐI (không có '/' đầu) để chạy được cả khi site nằm
  // trong thư mục con, vd http://localhost/du-an/build/php-public_html/.
  // Dùng '/api/...' tuyệt đối thì trong thư mục con nó sẽ rơi về gốc domain và 404.
  // Mọi trang .html đều nằm cùng cấp với thư mục api/ nên tương đối luôn đúng.
  function apiUrl(path) {
    const m = /^\/api\/([^?]*)(?:\?(.*))?$/.exec(path);
    if (!m) return path; // không phải đường dẫn API -> để nguyên
    const route = m[1];
    const rest = m[2] ? '&' + m[2] : '';
    return 'api/index.php?_route=' + route + rest;
  }

  async function req(method, url, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(apiUrl(url), opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Server error');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  root.API = {
    // captcha = token reCAPTCHA v3, lấy ngay lúc bấm nút (token chỉ sống ~2 phút)
    register: (username, email, password, captcha) =>
      req('POST', '/api/register', { username, email, password, captcha }),
    login: (username, password, captcha) => req('POST', '/api/login', { username, password, captcha }),
    recaptchaConfig: () => req('GET', '/api/recaptcha/config'),
    logout: () => req('POST', '/api/logout'),
    me: () => req('GET', '/api/me'),
    saveGame: (game) => req('POST', '/api/games', game),
    myGames: () => req('GET', '/api/games'),
    stats: (id) => req('GET', '/api/users/' + id + '/stats'),
    leaderboard: () => req('GET', '/api/users/leaderboard'),
    gameDetail: (id) => req('GET', '/api/games/' + id),

    // Đấu online (polling). Tên người chơi lấy từ phiên đăng nhập ở server,
    // client không gửi lên nữa — trận có cược nên không thể để mạo danh.
    matchRules: () => req('GET', '/api/match/rules'),
    matchCreate: (stake) => req('POST', '/api/match/create', { stake }),
    matchJoin: (code) => req('POST', '/api/match/join', { code }),
    matchQuick: (stake) => req('POST', '/api/match/quick', { stake }),
    matchList: () => req('GET', '/api/match/list'),
    matchState: (code, token, since) =>
      req('GET', '/api/match/state?code=' + encodeURIComponent(code) + '&token=' + encodeURIComponent(token || '') + '&since=' + (since || 0)),
    matchMove: (code, token, from, to) => req('POST', '/api/match/move', { code, token, from, to }),
    matchResign: (code, token) => req('POST', '/api/match/resign', { code, token }),
    matchDraw: (code, token) => req('POST', '/api/match/draw', { code, token }),
    matchChat: (code, token, text) => req('POST', '/api/match/chat', { code, token, text }),
    // Không còn matchOver: server tự kết luận ai thắng, client không khai được.

    // Nạp điểm qua PayPal
    payConfig: () => req('GET', '/api/payments/config'),
    pointsBalance: () => req('GET', '/api/payments/balance'),
    payHistory: () => req('GET', '/api/payments/history'),
    pointsLedger: (opts) => {
      const o = opts || {};
      const q = [];
      if (o.limit) q.push('limit=' + encodeURIComponent(o.limit));
      if (o.before) q.push('before=' + encodeURIComponent(o.before));
      if (o.kind) q.push('kind=' + encodeURIComponent(o.kind));
      return req('GET', '/api/payments/ledger' + (q.length ? '?' + q.join('&') : ''));
    },
    payCreateOrder: (amount) => req('POST', '/api/payments/paypal/order', { amount }),
    payCapture: (orderId) => req('POST', '/api/payments/paypal/capture', { orderId }),

    // Rút điểm về PayPal (admin duyệt tay)
    wdRules: () => req('GET', '/api/withdraw/rules'),
    wdRequest: (points, paypalEmail) => req('POST', '/api/withdraw/request', { points, paypalEmail }),
    wdMine: () => req('GET', '/api/withdraw/mine'),
    wdCancel: (id) => req('POST', '/api/withdraw/cancel', { id }),
    // Chỉ tài khoản admin gọi được
    wdAdminList: (status) => req('GET', '/api/withdraw/admin/list' + (status ? '?status=' + encodeURIComponent(status) : '')),
    wdAdminPaid: (id, payoutRef, note) => req('POST', '/api/withdraw/admin/paid', { id, payoutRef, note }),
    wdAdminReject: (id, note) => req('POST', '/api/withdraw/admin/reject', { id, note }),

    // Sổ tay tự học của AI (chơi với máy)
    bookLookup: (board) => req('POST', '/api/book/lookup', { board }),
    bookLearn: (moves, blackWon, draw) =>
      req('POST', '/api/book/learn', { moves, blackWon: !!blackWon, draw: !!draw }),
  };
})(window);
