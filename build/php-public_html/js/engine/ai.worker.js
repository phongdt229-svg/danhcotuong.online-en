/*
 * ai.worker.js — AI Cờ Tướng chạy trong Web Worker.
 * Thuật toán: Negamax + cắt tỉa alpha-beta, lượng giá = giá trị quân + bảng vị trí (PST).
 * Nhận message: { board, difficulty } -> trả về { move, nodes }.
 */
importScripts('xiangqi.js?v=4');

const X = self.Xiangqi;
const RED = X.RED;
const BLACK = X.BLACK;

const MATE = 1000000;
const REPEAT_PENALTY = 60; // phạt nước đi tạo lại thế cờ vừa xuất hiện (chống lặp)

// Khoá thế cờ (chuỗi) để phát hiện lặp.
function boardKey(board) {
  let s = '';
  for (let y = 0; y < X.ROWS; y++) for (let x = 0; x < X.COLS; x++) s += board[y][x] || '.';
  return s;
}

// Giá trị quân (đơn vị ~ centipawn)
const VALUE = {
  K: 60000,
  R: 1200,
  C: 600,
  H: 550,
  E: 220,
  A: 220,
  P: 120,
};

// Bảng vị trí (PST) theo hướng ĐỎ (y=9 là nhà Đỏ). Quân Đen lấy đối xứng y -> 9-y.
// Mỗi bảng 10 hàng x 9 cột.
const PST = {
  R: [
    [14, 14, 12, 18, 16, 18, 12, 14, 14],
    [16, 20, 18, 24, 26, 24, 18, 20, 16],
    [12, 12, 12, 18, 18, 18, 12, 12, 12],
    [12, 18, 16, 22, 22, 22, 16, 18, 12],
    [12, 14, 12, 18, 18, 18, 12, 14, 12],
    [12, 16, 14, 20, 20, 20, 14, 16, 12],
    [6, 10, 8, 14, 14, 14, 8, 10, 6],
    [4, 8, 6, 14, 12, 14, 6, 8, 4],
    [8, 4, 8, 16, 8, 16, 8, 4, 8],
    [-2, 10, 6, 14, 12, 14, 6, 10, -2],
  ],
  H: [
    [4, 8, 16, 12, 4, 12, 16, 8, 4],
    [4, 10, 28, 16, 8, 16, 28, 10, 4],
    [12, 14, 16, 20, 18, 20, 16, 14, 12],
    [8, 24, 18, 24, 20, 24, 18, 24, 8],
    [6, 16, 14, 18, 16, 18, 14, 16, 6],
    [4, 12, 16, 14, 12, 14, 16, 12, 4],
    [2, 6, 8, 6, 10, 6, 8, 6, 2],
    [4, 2, 8, 8, 4, 8, 8, 2, 4],
    [0, 2, 4, 4, -2, 4, 4, 2, 0],
    [0, -4, 0, 0, 0, 0, 0, -4, 0],
  ],
  C: [
    [6, 4, 0, -10, -12, -10, 0, 4, 6],
    [2, 2, 0, -4, -14, -4, 0, 2, 2],
    [2, 2, 0, -10, -8, -10, 0, 2, 2],
    [0, 0, -2, 4, 10, 4, -2, 0, 0],
    [0, 0, 0, 2, 8, 2, 0, 0, 0],
    [-2, 0, 4, 2, 6, 2, 4, 0, -2],
    [0, 0, 0, 2, 4, 2, 0, 0, 0],
    [4, 0, 8, 6, 10, 6, 8, 0, 4],
    [0, 2, 4, 6, 6, 6, 4, 2, 0],
    [0, 0, 2, 6, 6, 6, 2, 0, 0],
  ],
  P: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [18, 36, 56, 80, 120, 80, 56, 36, 18],
    [14, 26, 42, 60, 80, 60, 42, 26, 14],
    [14, 18, 32, 40, 50, 40, 32, 18, 14],
    [12, 16, 20, 26, 30, 26, 20, 16, 12],
    [6, 12, 14, 18, 20, 18, 14, 12, 6],
    [2, 0, 8, 0, 8, 0, 8, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  A: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 18, 0, 18, 0, 0, 0],
    [0, 0, 0, 20, 0, 20, 0, 0, 0],
  ],
  E: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 20, 0, 0, 0, 20, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [18, 0, 0, 0, 22, 0, 0, 0, 18],
  ],
  K: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 2, 0, 0, 0],
    [0, 0, 0, 4, 5, 4, 0, 0, 0],
    [0, 0, 0, 6, 8, 6, 0, 0, 0],
  ],
};

let nodeCount = 0;
let startTime = 0; // thời điểm bắt đầu nghĩ (ms)
let timeLimit = 0; // ngân sách thời gian mỗi nước (ms)
let timedOut = false;
let useQ = true; // có dùng quiescence ở nút lá không
let killers = []; // killer moves theo độ sâu (ply)
let history = {}; // history heuristic cho move ordering
let TT = new Map(); // transposition table, khoá = Zobrist hash

// ---- Zobrist hashing (cho transposition table) ----
const PIECE_IDX = { K: 0, A: 1, E: 2, H: 3, R: 4, C: 5, P: 6, k: 7, a: 8, e: 9, h: 10, r: 11, c: 12, p: 13 };
const ZB = [];
(function initZobrist() {
  let seed = 0x9e3779b9 >>> 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let i = 0; i < 14; i++) { ZB[i] = []; for (let s = 0; s < 90; s++) ZB[i][s] = rnd(); }
})();
const Z_SIDE = 0x1f2e3d4c;
function zp(piece, x, y) { return ZB[PIECE_IDX[piece]][y * 9 + x]; }
function fullHash(game, sideRed) {
  let h = sideRed ? Z_SIDE : 0;
  const b = game.board;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) { const p = b[y][x]; if (p) h = (h ^ zp(p, x, y)) >>> 0; }
  return h >>> 0;
}
function histKey(m) { return (m.from.y * 9 + m.from.x) * 90 + (m.to.y * 9 + m.to.x); }
function addHistory(m, depth) { const k = histKey(m); history[k] = (history[k] || 0) + depth * depth; }
// Có quân lớn (Xe/Pháo/Mã) không -> để dùng null-move an toàn (tránh zugzwang).
function hasMajor(game, color) {
  const b = game.board;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const p = b[y][x];
    if (p && X.colorOf(p) === color) { const t = X.typeOf(p); if (t === 'R' || t === 'C' || t === 'H') return true; }
  }
  return false;
}

const MDIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Lượng giá từ góc nhìn ĐỎ (dương = lợi cho Đỏ)
function evaluateRaw(game) {
  let score = 0;
  const b = game.board;
  for (let y = 0; y < X.ROWS; y++) {
    for (let x = 0; x < X.COLS; x++) {
      const p = b[y][x];
      if (!p) continue;
      const t = X.typeOf(p);
      const isRed = X.colorOf(p) === RED;
      const base = VALUE[t];
      const pst = isRed ? PST[t][y][x] : PST[t][X.ROWS - 1 - y][x];
      let v = base + pst;
      // Mobility: thưởng đường thoáng cho Xe (rất mạnh) và Pháo — cột/hàng mở rất lợi.
      if (t === 'R' || t === 'C') {
        let mob = 0;
        for (let di = 0; di < 4; di++) {
          const dx = MDIR[di][0], dy = MDIR[di][1];
          let nx = x + dx, ny = y + dy;
          while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10 && !b[ny][nx]) { mob++; nx += dx; ny += dy; }
        }
        v += t === 'R' ? mob * 3 : mob;
      }
      score += isRed ? v : -v;
    }
  }
  return score;
}

function evaluate(game, color) {
  const raw = evaluateRaw(game);
  return color === RED ? raw : -raw;
}

// Sắp xếp nước đi: ưu tiên nước ăn quân (MVV-LVA đơn giản) để cắt tỉa tốt hơn
function orderMoves(game, moves) {
  const b = game.board;
  for (const m of moves) {
    const victim = b[m.to.y][m.to.x];
    const attacker = b[m.from.y][m.from.x];
    m._score = victim ? VALUE[X.typeOf(victim)] * 10 - VALUE[X.typeOf(attacker)] : 0;
  }
  moves.sort((a, b2) => b2._score - a._score);
  return moves;
}

function sameMove(m, k) {
  return k && m.from.x === k.from.x && m.from.y === k.from.y && m.to.x === k.to.x && m.to.y === k.to.y;
}
function recordKiller(m, ply) {
  if (!killers[ply]) killers[ply] = [null, null];
  const k = killers[ply];
  if (!sameMove(m, k[0])) {
    k[1] = k[0];
    k[0] = { from: { x: m.from.x, y: m.from.y }, to: { x: m.to.x, y: m.to.y } };
  }
}

// Sắp xếp nâng cao: nước từ TT trước, rồi ăn quân (MVV-LVA), killer, history.
function orderMovesAdv(game, moves, ttMove, ply) {
  const b = game.board;
  const k = killers[ply];
  for (const m of moves) {
    const victim = b[m.to.y][m.to.x];
    let s;
    if (ttMove && sameMove(m, ttMove)) s = 1000000;
    else if (victim) s = 100000 + VALUE[X.typeOf(victim)] * 10 - VALUE[X.typeOf(b[m.from.y][m.from.x])];
    else if (k && (sameMove(m, k[0]) || sameMove(m, k[1]))) s = 9000;
    else s = history[histKey(m)] || 0;
    m._score = s;
  }
  moves.sort((a, b2) => b2._score - a._score);
  return moves;
}

function timeUp() {
  if ((nodeCount & 1023) === 0 && Date.now() - startTime > timeLimit) timedOut = true;
  return timedOut;
}

// Quiescence: tại nút lá chỉ tìm tiếp các nước ĂN QUÂN cho tới khi "yên tĩnh"
// -> tránh "horizon effect" (AI thí quân vì không thấy hậu quả ngay sau tầm tìm).
function quiesce(game, alpha, beta, color) {
  if (timeUp()) return evaluate(game, color);
  const standPat = evaluate(game, color);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  const caps = game.legalMoves(color).filter((m) => game.board[m.to.y][m.to.x]);
  orderMoves(game, caps);
  const opp = color === RED ? BLACK : RED;
  for (const m of caps) {
    nodeCount++;
    const cap = game._apply(m);
    const score = -quiesce(game, -beta, -alpha, opp);
    game._revert(m, cap);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(game, depth, alpha, beta, color, ply, hash) {
  if (timeUp()) return evaluate(game, color);
  const alphaOrig = alpha;
  // Tra cứu transposition table
  const tte = TT.get(hash);
  let ttMove = null;
  if (tte) {
    ttMove = tte.move;
    if (tte.depth >= depth) {
      if (tte.flag === 0) return tte.value; // điểm chính xác
      if (tte.flag === 1) { if (tte.value > alpha) alpha = tte.value; } // cận dưới
      else if (tte.flag === 2) { if (tte.value < beta) beta = tte.value; } // cận trên
      if (alpha >= beta) return tte.value;
    }
  }
  if (depth <= 0) return useQ ? quiesce(game, alpha, beta, color) : evaluate(game, color);

  const inCheck = game.isInCheck(color);
  const moves = game.legalMoves(color);
  if (moves.length === 0) return -MATE - depth; // chiếu hết / hết nước -> thua
  const opp = color === RED ? BLACK : RED;

  // Null-move pruning: cho đối thủ đi "miễn phí"; nếu vẫn >= beta thì cắt cả nhánh.
  if (!inCheck && depth >= 3 && beta < MATE - 1000 && hasMajor(game, color)) {
    const R = depth > 6 ? 3 : 2;
    const score = -negamax(game, depth - 1 - R, -beta, -beta + 1, opp, ply + 1, (hash ^ Z_SIDE) >>> 0);
    if (timedOut) return evaluate(game, color);
    if (score >= beta) return beta;
  }

  orderMovesAdv(game, moves, ttMove, ply);
  let best = -Infinity;
  let bestMove = moves[0];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    nodeCount++;
    const piece = game.board[m.from.y][m.from.x];
    const isCap = !!game.board[m.to.y][m.to.x];
    const cap = game._apply(m);
    const nh = (hash ^ zp(piece, m.from.x, m.from.y) ^ zp(piece, m.to.x, m.to.y) ^ (cap ? zp(cap, m.to.x, m.to.y) : 0) ^ Z_SIDE) >>> 0;
    let score;
    if (i === 0) {
      score = -negamax(game, depth - 1, -beta, -alpha, opp, ply + 1, nh);
    } else {
      // PVS: tìm cửa sổ hẹp trước; nếu vượt alpha thì tìm lại đầy đủ.
      score = -negamax(game, depth - 1, -alpha - 1, -alpha, opp, ply + 1, nh);
      if (score > alpha) score = -negamax(game, depth - 1, -beta, -alpha, opp, ply + 1, nh);
    }
    game._revert(m, cap);
    if (timedOut) return best > -Infinity ? best : evaluate(game, color);
    if (score > best) { best = score; bestMove = m; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!isCap) { recordKiller(m, ply); addHistory(m, depth); }
      break;
    }
  }

  // Lưu vào transposition table
  let flag = 0;
  if (best <= alphaOrig) flag = 2; else if (best >= beta) flag = 1;
  if (TT.size < 600000) TT.set(hash, { depth, value: best, flag, move: bestMove });
  return best;
}

// Iterative deepening: nghĩ sâu dần tới maxDepth hoặc hết ngân sách thời gian.
function chooseMove(game, color, cfg, recent) {
  nodeCount = 0;
  killers = [];
  history = {};
  TT = new Map();
  timedOut = false;
  useQ = cfg.quiesce !== false;
  startTime = Date.now();
  timeLimit = cfg.timeMs;
  const rootMoves = game.legalMoves(color);
  if (rootMoves.length === 0) return null;
  const opp = color === RED ? BLACK : RED;
  const hasRecent = recent && recent.length > 0;
  const rootHash = fullHash(game, color === RED);
  let bestScored = rootMoves.map((m) => ({ move: m, score: 0 }));
  let bestMove = rootMoves[0];

  for (let d = 1; d <= cfg.depth; d++) {
    const scored = [];
    orderMovesAdv(game, rootMoves, bestMove, 0);
    for (const m of rootMoves) {
      const piece = game.board[m.from.y][m.from.x];
      const cap = game._apply(m);
      const nh = (rootHash ^ zp(piece, m.from.x, m.from.y) ^ zp(piece, m.to.x, m.to.y) ^ (cap ? zp(cap, m.to.x, m.to.y) : 0) ^ Z_SIDE) >>> 0;
      // QUAN TRỌNG: tìm mỗi nước gốc bằng cửa sổ ĐẦY ĐỦ (-∞, +∞) để có ĐIỂM CHÍNH XÁC.
      // Nếu thu hẹp alpha ở gốc, các nước kém sẽ trả về "giá trị biên" (bound) bằng nhau,
      // khiến bước chọn ngẫu nhiên trong nhóm ngang điểm chọn nhầm -> AI đi như ngẫu nhiên.
      const raw = -negamax(game, d - 1, -Infinity, Infinity, opp, 1, nh);
      const key = hasRecent ? boardKey(game.board) : null;
      game._revert(m, cap);
      if (timedOut) break;
      let score = raw;
      if (key && recent.indexOf(key) !== -1) score -= REPEAT_PENALTY; // chống lặp
      scored.push({ move: m, score });
    }
    if (timedOut && scored.length < rootMoves.length) break; // vòng dở -> giữ kết quả vòng trước
    scored.sort((a, b) => b.score - a.score);
    bestScored = scored;
    bestMove = scored[0].move;
    if (Math.abs(scored[0].score) > MATE - 1000) break; // đã thấy chiếu hết
    if (Date.now() - startTime > timeLimit) break;
  }

  // Mức dễ/trung bình: thỉnh thoảng chọn ngẫu nhiên trong nhóm gần tốt nhất
  if (cfg.randomness > 0 && Math.random() < cfg.randomness) {
    const top = bestScored.filter((s) => s.score >= bestScored[0].score - 80);
    return top[Math.floor(Math.random() * top.length)].move;
  }
  // Phá thế đơn định nhẹ: chọn ngẫu nhiên trong nhóm ngang điểm tốt nhất
  const best = bestScored[0].score;
  const ties = bestScored.filter((s) => s.score >= best - 12);
  return ties[Math.floor(Math.random() * ties.length)].move;
}

const LEVELS = {
  easy:   { depth: 2,  randomness: 0.5,  timeMs: 400,  quiesce: false }, // Dễ
  medium: { depth: 4,  randomness: 0.2,  timeMs: 700,  quiesce: true },  // Trung bình
  hard:   { depth: 6,  randomness: 0.05, timeMs: 1200, quiesce: true },  // Khó
  expert: { depth: 12, randomness: 0,    timeMs: 2800, quiesce: true },  // Rất khó
  master: { depth: 24, randomness: 0,    timeMs: 5000, quiesce: true },  // Cao thủ
};

self.onmessage = function (e) {
  const { board, difficulty, recent, color, tag } = e.data;
  const cfg = LEVELS[difficulty] || LEVELS.medium;
  const who = color === 'r' ? RED : BLACK; // mặc định AI cầm Đen; gợi ý cho người thì 'r'
  const game = new X.Game(board, who);
  const move = chooseMove(game, who, cfg, recent || []);
  self.postMessage({ move, nodes: nodeCount, tag: tag || 'ai' });
};
