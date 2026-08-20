/*
 * api.js — Lớp gọi REST API tới backend. Dùng cookie session (credentials: include).
 */
(function (root) {
  'use strict';

  async function req(method, url, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Lỗi máy chủ');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  root.API = {
    register: (username, email, password) =>
      req('POST', '/api/register', { username, email, password }),
    login: (username, password) => req('POST', '/api/login', { username, password }),
    logout: () => req('POST', '/api/logout'),
    me: () => req('GET', '/api/me'),
    saveGame: (game) => req('POST', '/api/games', game),
    myGames: () => req('GET', '/api/games'),
    stats: (id) => req('GET', '/api/users/' + id + '/stats'),
    leaderboard: () => req('GET', '/api/users/leaderboard'),
    gameDetail: (id) => req('GET', '/api/games/' + id),

    // Đấu online (polling)
    matchCreate: (name) => req('POST', '/api/match/create', { name }),
    matchJoin: (code, name) => req('POST', '/api/match/join', { code, name }),
    matchQuick: (name) => req('POST', '/api/match/quick', { name }),
    matchList: () => req('GET', '/api/match/list'),
    matchState: (code, token, since) =>
      req('GET', '/api/match/state?code=' + encodeURIComponent(code) + '&token=' + encodeURIComponent(token || '') + '&since=' + (since || 0)),
    matchMove: (code, token, from, to) => req('POST', '/api/match/move', { code, token, from, to }),
    matchResign: (code, token) => req('POST', '/api/match/resign', { code, token }),
    matchOver: (code, token, text, winner) => req('POST', '/api/match/over', { code, token, text, winner }),
    matchChat: (code, token, text) => req('POST', '/api/match/chat', { code, token, text }),

    // Sổ tay tự học của AI (chơi với máy)
    bookLookup: (board) => req('POST', '/api/book/lookup', { board }),
    bookLearn: (moves, blackWon, draw) =>
      req('POST', '/api/book/learn', { moves, blackWon: !!blackWon, draw: !!draw }),
  };
})(window);
