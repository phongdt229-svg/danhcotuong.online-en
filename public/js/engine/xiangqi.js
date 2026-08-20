/*
 * xiangqi.js — Engine luật Cờ Tướng (Xiangqi) thuần JS, không phụ thuộc DOM.
 * Dùng chung cho: trang web (validate nước đi), Web Worker (AI), và Node (test).
 *
 * Quy ước bàn cờ:
 *   - 9 cột (x: 0..8), 10 hàng (y: 0..9).
 *   - y = 0 ở TRÊN (bên Đen), y = 9 ở DƯỚI (bên Đỏ).
 *   - Đỏ đi lên (y giảm), Đen đi xuống (y tăng).
 *   - Quân: ký tự HOA = Đỏ, thường = Đen.
 *       K/k Tướng, A/a Sĩ, E/e Tượng, H/h Mã, R/r Xe, C/c Pháo, P/p Tốt
 *   - Ô trống = null.
 */
(function (root) {
  'use strict';

  const COLS = 9;
  const ROWS = 10;

  const RED = 'r';
  const BLACK = 'b';

  const ORTHO = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  function inside(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  function colorOf(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? RED : BLACK;
  }

  function typeOf(piece) {
    return piece ? piece.toUpperCase() : null;
  }

  function isRedSide(y) {
    return y >= 5; // nửa bàn của Đỏ
  }

  function inPalace(color, x, y) {
    if (x < 3 || x > 5) return false;
    if (color === RED) return y >= 7 && y <= 9;
    return y >= 0 && y <= 2;
  }

  function initialBoard() {
    // y0 = Đen (trên), y9 = Đỏ (dưới)
    const b = [
      ['r', 'h', 'e', 'a', 'k', 'a', 'e', 'h', 'r'],
      [null, null, null, null, null, null, null, null, null],
      [null, 'c', null, null, null, null, null, 'c', null],
      ['p', null, 'p', null, 'p', null, 'p', null, 'p'],
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
      ['P', null, 'P', null, 'P', null, 'P', null, 'P'],
      [null, 'C', null, null, null, null, null, 'C', null],
      [null, null, null, null, null, null, null, null, null],
      ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'],
    ];
    return b;
  }

  class Game {
    constructor(board, turn) {
      this.board = board || initialBoard();
      this.turn = turn || RED; // Đỏ đi trước
      this.history = []; // {from, to, piece, captured, prevTurn}
    }

    clone() {
      const g = new Game(
        this.board.map((row) => row.slice()),
        this.turn
      );
      return g;
    }

    get(x, y) {
      return this.board[y][x];
    }

    set(x, y, piece) {
      this.board[y][x] = piece;
    }

    findKing(color) {
      const k = color === RED ? 'K' : 'k';
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (this.board[y][x] === k) return { x, y };
        }
      }
      return null;
    }

    /* ---------- Phát hiện ô bị tấn công ---------- */
    // (tx,ty) có bị quân màu `by` tấn công không?
    isAttacked(tx, ty, by) {
      const b = this.board;

      // Xe & Pháo & Tướng (đối mặt) theo 4 hướng trực giao
      for (const [dx, dy] of ORTHO) {
        let cx = tx + dx;
        let cy = ty + dy;
        let firstPiece = null;
        // tìm quân đầu tiên
        while (inside(cx, cy) && !b[cy][cx]) {
          cx += dx;
          cy += dy;
        }
        if (inside(cx, cy)) {
          firstPiece = b[cy][cx];
          if (colorOf(firstPiece) === by) {
            const t = typeOf(firstPiece);
            if (t === 'R') return true; // Xe
            // Tướng: ăn ô liền kề, hoặc luật "tướng đối mặt" theo cột dọc
            if (t === 'K') {
              if (dx === 0) return true; // cùng cột, không có quân chắn -> đối mặt / kề
              const dist = Math.abs(cx - tx) + Math.abs(cy - ty);
              if (dist === 1) return true;
            }
          }
          // Pháo: vượt qua quân đầu (ngòi) tìm quân thứ hai
          let px = cx + dx;
          let py = cy + dy;
          while (inside(px, py) && !b[py][px]) {
            px += dx;
            py += dy;
          }
          if (inside(px, py)) {
            const second = b[py][px];
            if (colorOf(second) === by && typeOf(second) === 'C') return true;
          }
        }
      }

      // Mã (xét vị trí mã có thể nhảy tới, kèm cản chân)
      const horseFrom = [
        [1, 2],
        [1, -2],
        [-1, 2],
        [-1, -2],
        [2, 1],
        [2, -1],
        [-2, 1],
        [-2, -1],
      ];
      for (const [dx, dy] of horseFrom) {
        const hx = tx + dx;
        const hy = ty + dy;
        if (!inside(hx, hy)) continue;
        const p = b[hy][hx];
        if (colorOf(p) === by && typeOf(p) === 'H') {
          // chân mã: ô kề mã theo trục dài (độ lớn 2)
          let lx = hx;
          let ly = hy;
          if (Math.abs(dy) === 2) ly = hy - dy / 2;
          else lx = hx - dx / 2;
          if (!b[ly][lx]) return true; // chân không bị cản
        }
      }

      // Sĩ (kề chéo)
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const ax = tx + dx;
        const ay = ty + dy;
        if (inside(ax, ay)) {
          const p = b[ay][ax];
          if (colorOf(p) === by && typeOf(p) === 'A') return true;
        }
      }

      // Tượng (cách 2 chéo, mắt tượng không bị cản)
      for (const [dx, dy] of [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
      ]) {
        const ex = tx + dx;
        const ey = ty + dy;
        if (inside(ex, ey)) {
          const p = b[ey][ex];
          if (colorOf(p) === by && typeOf(p) === 'E') {
            const eyeX = tx + dx / 2;
            const eyeY = ty + dy / 2;
            if (!b[eyeY][eyeX]) return true;
          }
        }
      }

      // Tốt
      if (by === RED) {
        // Tốt Đỏ đi lên: tấn công ô phía trên nó -> nó ở (tx,ty+1)
        if (inside(tx, ty + 1) && b[ty + 1][tx] === 'P') return true;
        // đi ngang khi đã qua sông (tốt nằm ở nửa Đen: y<=4)
        if (ty <= 4) {
          if (inside(tx - 1, ty) && b[ty][tx - 1] === 'P') return true;
          if (inside(tx + 1, ty) && b[ty][tx + 1] === 'P') return true;
        }
      } else {
        if (inside(tx, ty - 1) && b[ty - 1][tx] === 'p') return true;
        if (ty >= 5) {
          if (inside(tx - 1, ty) && b[ty][tx - 1] === 'p') return true;
          if (inside(tx + 1, ty) && b[ty][tx + 1] === 'p') return true;
        }
      }

      return false;
    }

    isInCheck(color) {
      const k = this.findKing(color);
      if (!k) return true; // mất Tướng coi như bị chiếu (không nên xảy ra)
      const enemy = color === RED ? BLACK : RED;
      return this.isAttacked(k.x, k.y, enemy);
    }

    /* ---------- Sinh nước đi giả hợp lệ (chưa lọc chiếu) ---------- */
    pseudoMoves(color) {
      const moves = [];
      const b = this.board;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const p = b[y][x];
          if (!p || colorOf(p) !== color) continue;
          this._pieceMoves(x, y, p, color, moves);
        }
      }
      return moves;
    }

    _pieceMoves(x, y, p, color, out) {
      const b = this.board;
      const t = typeOf(p);
      const add = (nx, ny) => {
        if (!inside(nx, ny)) return;
        const dst = b[ny][nx];
        if (colorOf(dst) === color) return; // không ăn quân nhà
        out.push({ from: { x, y }, to: { x: nx, y: ny } });
      };

      if (t === 'K') {
        for (const [dx, dy] of ORTHO) {
          const nx = x + dx;
          const ny = y + dy;
          if (inPalace(color, nx, ny)) add(nx, ny);
        }
      } else if (t === 'A') {
        for (const [dx, dy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (inPalace(color, nx, ny)) add(nx, ny);
        }
      } else if (t === 'E') {
        for (const [dx, dy] of [
          [2, 2],
          [2, -2],
          [-2, 2],
          [-2, -2],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inside(nx, ny)) continue;
          // không qua sông
          if (color === RED && ny < 5) continue;
          if (color === BLACK && ny > 4) continue;
          // mắt tượng
          if (b[y + dy / 2][x + dx / 2]) continue;
          add(nx, ny);
        }
      } else if (t === 'H') {
        const horse = [
          [1, 2, 0, 1],
          [-1, 2, 0, 1],
          [1, -2, 0, -1],
          [-1, -2, 0, -1],
          [2, 1, 1, 0],
          [2, -1, 1, 0],
          [-2, 1, -1, 0],
          [-2, -1, -1, 0],
        ];
        for (const [dx, dy, lx, ly] of horse) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inside(nx, ny)) continue;
          if (b[y + ly][x + lx]) continue; // cản chân
          add(nx, ny);
        }
      } else if (t === 'R') {
        for (const [dx, dy] of ORTHO) {
          let nx = x + dx;
          let ny = y + dy;
          while (inside(nx, ny) && !b[ny][nx]) {
            out.push({ from: { x, y }, to: { x: nx, y: ny } });
            nx += dx;
            ny += dy;
          }
          if (inside(nx, ny) && colorOf(b[ny][nx]) !== color) {
            out.push({ from: { x, y }, to: { x: nx, y: ny } });
          }
        }
      } else if (t === 'C') {
        for (const [dx, dy] of ORTHO) {
          let nx = x + dx;
          let ny = y + dy;
          // di chuyển (không ăn)
          while (inside(nx, ny) && !b[ny][nx]) {
            out.push({ from: { x, y }, to: { x: nx, y: ny } });
            nx += dx;
            ny += dy;
          }
          // tìm ngòi rồi quân thứ hai để ăn
          nx += dx;
          ny += dy;
          while (inside(nx, ny) && !b[ny][nx]) {
            nx += dx;
            ny += dy;
          }
          if (inside(nx, ny) && colorOf(b[ny][nx]) !== color) {
            out.push({ from: { x, y }, to: { x: nx, y: ny } });
          }
        }
      } else if (t === 'P') {
        const forward = color === RED ? -1 : 1;
        add(x, y + forward);
        // qua sông mới đi ngang
        const crossed = color === RED ? y <= 4 : y >= 5;
        if (crossed) {
          add(x - 1, y);
          add(x + 1, y);
        }
      }
    }

    /* ---------- Nước đi hợp lệ (đã lọc tự chiếu) ---------- */
    legalMoves(color) {
      color = color || this.turn;
      const pseudo = this.pseudoMoves(color);
      const legal = [];
      for (const m of pseudo) {
        const cap = this._apply(m);
        const inCheck = this.isInCheck(color);
        this._revert(m, cap);
        if (!inCheck) legal.push(m);
      }
      return legal;
    }

    _apply(m) {
      const b = this.board;
      const piece = b[m.from.y][m.from.x];
      const captured = b[m.to.y][m.to.x];
      b[m.to.y][m.to.x] = piece;
      b[m.from.y][m.from.x] = null;
      return captured;
    }

    _revert(m, captured) {
      const b = this.board;
      const piece = b[m.to.y][m.to.x];
      b[m.from.y][m.from.x] = piece;
      b[m.to.y][m.to.x] = captured;
    }

    // Thực hiện nước đi (kèm lưu lịch sử để undo). Trả về thông tin nước đi.
    move(from, to) {
      const piece = this.board[from.y][from.x];
      if (!piece || colorOf(piece) !== this.turn) return null;
      const legal = this.legalMoves(this.turn);
      const ok = legal.some(
        (m) =>
          m.from.x === from.x &&
          m.from.y === from.y &&
          m.to.x === to.x &&
          m.to.y === to.y
      );
      if (!ok) return null;
      const captured = this.board[to.y][to.x];
      this.board[to.y][to.x] = piece;
      this.board[from.y][from.x] = null;
      const record = {
        from: { ...from },
        to: { ...to },
        piece,
        captured,
        prevTurn: this.turn,
      };
      this.history.push(record);
      this.turn = this.turn === RED ? BLACK : RED;
      return record;
    }

    undo() {
      const rec = this.history.pop();
      if (!rec) return null;
      this.board[rec.from.y][rec.from.x] = rec.piece;
      this.board[rec.to.y][rec.to.x] = rec.captured;
      this.turn = rec.prevTurn;
      return rec;
    }

    isCheckmate(color) {
      color = color || this.turn;
      return this.isInCheck(color) && this.legalMoves(color).length === 0;
    }

    isStalemate(color) {
      color = color || this.turn;
      return !this.isInCheck(color) && this.legalMoves(color).length === 0;
    }

    // Trạng thái cho bên đang tới lượt
    status() {
      const color = this.turn;
      const noMoves = this.legalMoves(color).length === 0;
      if (noMoves) {
        // Trong cờ tướng, hết nước (kể cả không bị chiếu) => bên đi thua
        return { over: true, loser: color, reason: this.isInCheck(color) ? 'checkmate' : 'stalemate' };
      }
      if (this.isInCheck(color)) return { over: false, check: color };
      return { over: false };
    }
  }

  const Xiangqi = {
    Game,
    RED,
    BLACK,
    COLS,
    ROWS,
    colorOf,
    typeOf,
    inside,
    inPalace,
    initialBoard,
  };

  // Xuất ra global (browser/worker) và module (Node)
  root.Xiangqi = Xiangqi;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Xiangqi;
  }
})(typeof self !== 'undefined' ? self : this);
