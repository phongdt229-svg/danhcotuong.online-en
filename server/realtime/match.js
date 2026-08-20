/*
 * match.js — Ghép trận & đồng bộ nước đi Cờ Tướng trực tuyến (người với người) qua WebSocket.
 *
 * Hỗ trợ 2 cách vào trận:
 *   - "quick": tìm trận nhanh (ghép 2 người đang chờ với nhau).
 *   - "create"/"join": tạo phòng riêng -> nhận mã -> bạn bè nhập mã để vào.
 *
 * Server chỉ làm trọng tài nhẹ (chuyển tiếp nước đi + kiểm tra đúng lượt). Việc kiểm
 * tra luật cờ do mỗi client tự thực hiện bằng engine xiangqi.js dùng chung.
 *
 * Giao thức (JSON):
 *   client -> server: {type:'hello',name} | {type:'quick'} | {type:'create'} |
 *                     {type:'join',code} | {type:'move',from,to} | {type:'resign'} |
 *                     {type:'chat',text} | {type:'cancel'}
 *   server -> client: {type:'welcome'} | {type:'waiting'} | {type:'created',code} |
 *                     {type:'start',color,opponent} | {type:'move',from,to} |
 *                     {type:'resign'} | {type:'opponent-left'} | {type:'chat',text} |
 *                     {type:'error',message}
 */
const { WebSocketServer } = require('ws');
const X = require('../../public/js/engine/xiangqi.js'); // engine luật cờ dùng chung (chống gian lận)

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (I,O,0,1)

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

module.exports = function attachMatch(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  let quickWaiting = null; // ws đang chờ ghép trận nhanh
  const rooms = new Map(); // code -> { players:[ws,...], code, host, started, turn }
  const lobby = new Set(); // các ws đang ở sảnh (xem danh sách phòng)

  const isOpen = (ws) => ws && ws.readyState === ws.OPEN;
  const send = (ws, obj) => { if (isOpen(ws)) ws.send(JSON.stringify(obj)); };
  const opponent = (room, ws) => room.players.find((p) => p !== ws);

  // Danh sách phòng đang mở (mới tạo, còn chờ người thứ 2).
  function openRooms() {
    const list = [];
    for (const room of rooms.values()) {
      if (!room.started && room.players.length === 1) {
        list.push({ code: room.code, host: room.players[0].name || 'Khách' });
      }
    }
    return list;
  }
  // Danh sách các trận ĐANG ĐÁNH (cho khán giả vào xem).
  function liveMatches() {
    const list = [];
    for (const room of rooms.values()) {
      if (room.started && !room.ended && room.code) {
        const red = room.players.find((p) => p.color === 'r');
        const black = room.players.find((p) => p.color === 'b');
        list.push({
          code: room.code,
          red: red ? red.name : '?',
          black: black ? black.name : '?',
          moves: room.moves ? room.moves.length : 0,
        });
      }
    }
    return list;
  }
  function roomsPayload() {
    return { type: 'rooms', rooms: openRooms(), live: liveMatches() };
  }
  // Gửi danh sách phòng + trận đang đánh cho tất cả người ở sảnh (cập nhật trực tiếp).
  function broadcastRooms() {
    const payload = JSON.stringify(roomsPayload());
    for (const ws of lobby) if (isOpen(ws)) ws.send(payload);
  }
  // Báo cho khán giả của 1 phòng.
  function toSpectators(room, obj) {
    if (!room.spectators) return;
    const payload = JSON.stringify(obj);
    for (const s of room.spectators) if (isOpen(s)) s.send(payload);
  }

  function startRoom(room) {
    room.started = true;
    room.ended = false;
    room.turn = 'r'; // Đỏ đi trước
    room.moves = []; // nước đi để khán giả vào giữa chừng dựng lại
    room.game = new X.Game(); // ván trên server để kiểm tra luật & phát hiện hết ván
    if (!room.spectators) room.spectators = new Set();
    const [a, b] = room.players;
    a.color = 'r';
    b.color = 'b';
    lobby.delete(a);
    lobby.delete(b);
    send(a, { type: 'start', color: 'r', opponent: b.name });
    send(b, { type: 'start', color: 'b', opponent: a.name });
    // Khán giả (nếu có, vd sau khi chơi lại) xem ván mới
    toSpectators(room, { type: 'spectate-start', red: a.name, black: b.name, moves: [], turn: 'r' });
    broadcastRooms(); // phòng này không còn mở -> cập nhật danh sách
  }

  function endRoomNotify(ws) {
    const room = ws.room;
    if (!room) return;
    const other = opponent(room, ws);
    if (other && room.started) send(other, { type: 'opponent-left' });
    toSpectators(room, { type: 'spectate-end', text: 'Trận đã kết thúc (người chơi thoát).' });
    if (room.code) rooms.delete(room.code);
    room.players.forEach((p) => { p.room = null; });
    broadcastRooms(); // trận biến mất khỏi danh sách đang đánh
  }

  wss.on('connection', (ws) => {
    ws.name = 'Khách';
    ws.room = null;
    ws.color = null;
    ws.wantRematch = false;
    ws.spectating = null;
    lobby.add(ws);
    send(ws, { type: 'welcome' });
    send(ws, roomsPayload()); // gửi danh sách phòng + trận đang đánh ngay

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      switch (msg && msg.type) {
        case 'hello':
          ws.name = String(msg.name || 'Khách').slice(0, 24) || 'Khách';
          break;
        case 'quick':
          if (ws.room) return;
          if (isOpen(quickWaiting) && quickWaiting !== ws) {
            let qcode;
            do { qcode = makeCode(); } while (rooms.has(qcode));
            const room = { players: [quickWaiting, ws], code: qcode, host: quickWaiting.name, spectators: new Set() };
            rooms.set(qcode, room); // có mã -> khán giả xem được
            quickWaiting.room = room;
            ws.room = room;
            quickWaiting = null;
            startRoom(room);
          } else {
            quickWaiting = ws;
            send(ws, { type: 'waiting' });
          }
          break;
        case 'list':
          lobby.add(ws); // yêu cầu danh sách = đang ở sảnh
          send(ws, roomsPayload());
          break;
        case 'create': {
          if (ws.room) return;
          let code;
          do { code = makeCode(); } while (rooms.has(code));
          const room = { players: [ws], code, host: ws.name, spectators: new Set() };
          ws.room = room;
          rooms.set(code, room);
          send(ws, { type: 'created', code });
          broadcastRooms(); // có phòng mới -> báo cho mọi người ở sảnh
          break;
        }
        case 'spectate': {
          const code = String(msg.code || '').toUpperCase().trim();
          const room = rooms.get(code);
          if (!room || !room.started) return send(ws, { type: 'error', message: 'Trận không tồn tại hoặc đã kết thúc' });
          if (!room.spectators) room.spectators = new Set();
          lobby.delete(ws);
          if (ws.spectating && ws.spectating.spectators) ws.spectating.spectators.delete(ws);
          room.spectators.add(ws);
          ws.spectating = room;
          const red = room.players.find((p) => p.color === 'r');
          const black = room.players.find((p) => p.color === 'b');
          send(ws, {
            type: 'spectate-start',
            red: red ? red.name : '?',
            black: black ? black.name : '?',
            moves: room.moves || [],
            turn: room.turn,
          });
          break;
        }
        case 'join': {
          if (ws.room) return;
          const code = String(msg.code || '').toUpperCase().trim();
          const room = rooms.get(code);
          if (!room) return send(ws, { type: 'error', message: 'Không tìm thấy phòng với mã này' });
          if (room.players.length >= 2) return send(ws, { type: 'error', message: 'Phòng đã đủ 2 người' });
          room.players.push(ws);
          ws.room = room;
          startRoom(room);
          break;
        }
        case 'move': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          if (ws.color !== room.turn) return; // không đúng lượt
          if (!msg.from || !msg.to) return;
          // Kiểm tra luật bằng engine (chống gian lận): server là trọng tài
          const rec = room.game.move(msg.from, msg.to);
          if (!rec) return send(ws, { type: 'illegal' }); // nước phạm luật -> từ chối
          room.moves.push({ from: msg.from, to: msg.to });
          room.turn = room.game.turn;
          send(opponent(room, ws), { type: 'move', from: msg.from, to: msg.to });
          toSpectators(room, { type: 'move', from: msg.from, to: msg.to });
          // Phát hiện hết ván (chiếu hết / hết nước) ngay tại server
          const st = room.game.status();
          if (st.over) {
            room.ended = true;
            const winner = st.loser === 'r' ? 'b' : 'r';
            const wName = (room.players.find((p) => p.color === winner) || {}).name || (winner === 'r' ? 'Đỏ' : 'Đen');
            toSpectators(room, { type: 'spectate-end', text: wName + ' thắng (' + (st.reason === 'checkmate' ? 'chiếu hết' : 'hết nước') + ').' });
            broadcastRooms();
          }
          break;
        }
        case 'resign': {
          const room = ws.room;
          if (!room || !room.started) return;
          send(opponent(room, ws), { type: 'resign' });
          room.ended = true;
          toSpectators(room, { type: 'spectate-end', text: (ws.name || 'Một bên') + ' đã xin thua.' });
          broadcastRooms();
          break;
        }
        case 'timeout': {
          const room = ws.room;
          if (!room || !room.started) return;
          send(opponent(room, ws), { type: 'opponent-timeout' });
          room.ended = true;
          toSpectators(room, { type: 'spectate-end', text: (ws.name || 'Một bên') + ' đã hết giờ.' });
          broadcastRooms();
          break;
        }
        case 'draw-accept': {
          const room = ws.room;
          if (!room || !room.started) return;
          send(opponent(room, ws), { type: 'draw-accept' });
          room.ended = true;
          toSpectators(room, { type: 'spectate-end', text: 'Hai bên đồng ý hòa.' });
          broadcastRooms();
          break;
        }
        case 'takeback-offer': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          room.takebackBy = ws.color; // ghi nhớ ai xin hoàn nước
          send(opponent(room, ws), { type: 'takeback-offer' });
          break;
        }
        case 'takeback-accept': {
          const room = ws.room;
          if (!room || !room.started || room.ended) return;
          const reqColor = room.takebackBy || (ws.color === 'r' ? 'b' : 'r');
          if (room.game && room.game.history.length > 0) {
            let guard = 0;
            do {
              room.game.undo();
              if (room.moves && room.moves.length) room.moves.pop();
              guard++;
            } while (room.game.history.length > 0 && room.game.turn !== reqColor && guard < 4);
            room.turn = room.game.turn;
          }
          send(opponent(room, ws), { type: 'takeback-accept' });
          // Đồng bộ lại thế cờ cho khán giả sau khi hoàn nước
          const red = room.players.find((p) => p.color === 'r');
          const black = room.players.find((p) => p.color === 'b');
          toSpectators(room, {
            type: 'spectate-start',
            red: red ? red.name : '?',
            black: black ? black.name : '?',
            moves: room.moves || [],
            turn: room.turn,
          });
          break;
        }
        // Cầu hòa & từ chối: chuyển tiếp cho đối thủ.
        case 'draw-offer':
        case 'draw-decline':
        case 'takeback-decline': {
          const room = ws.room;
          if (!room || !room.started) return;
          send(opponent(room, ws), { type: msg.type });
          break;
        }
        case 'rematch': {
          const room = ws.room;
          if (!room || !room.started) return;
          ws.wantRematch = true;
          const other = opponent(room, ws);
          if (other && other.wantRematch) {
            ws.wantRematch = false;
            other.wantRematch = false;
            room.players.reverse(); // đổi bên cho công bằng
            startRoom(room);
          } else {
            send(other, { type: 'rematch' }); // báo đối thủ muốn chơi lại
          }
          break;
        }
        case 'chat': {
          const room = ws.room;
          if (!room) return;
          const text = String(msg.text || '').slice(0, 200);
          if (text) send(opponent(room, ws), { type: 'chat', text });
          break;
        }
        case 'cancel':
          if (quickWaiting === ws) quickWaiting = null;
          if (ws.room && !ws.room.started) {
            if (ws.room.code) rooms.delete(ws.room.code);
            ws.room = null;
            broadcastRooms(); // phòng đã huỷ -> cập nhật danh sách
          }
          break;
      }
    });

    ws.on('close', () => {
      lobby.delete(ws);
      if (ws.spectating && ws.spectating.spectators) { ws.spectating.spectators.delete(ws); ws.spectating = null; }
      if (quickWaiting === ws) quickWaiting = null;
      if (ws.room) {
        const wasOpen = !ws.room.started;
        if (ws.room.started) endRoomNotify(ws);
        else {
          if (ws.room.code) rooms.delete(ws.room.code);
          ws.room = null;
        }
        if (wasOpen) broadcastRooms(); // chủ phòng thoát khi chưa bắt đầu
      }
    });
  });

  return wss;
};
