/*
 * board.js — Render bàn cờ tướng + xử lý tương tác (chọn quân, gợi ý, đi quân).
 * Phụ thuộc: xiangqi.js (global Xiangqi). Không tự thay đổi ván cờ — chỉ gọi onMove.
 */
(function (root) {
  'use strict';
  const X = root.Xiangqi;

  // Ký tự Hán hiển thị cho từng quân
  const GLYPH = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
  };

  class Board {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts || {};
      this.game = null;
      this.selected = null; // {x,y}
      this.legalForSel = [];
      this.lastMove = null; // {from,to}
      this.hintMove = null; // {from,to} — gợi ý (không tự đi)
      this.interactive = true;
      this._build();
    }

    _build() {
      this.el.classList.add('board-frame');
      this.el.innerHTML = '';
      const inner = document.createElement('div');
      inner.className = 'board-inner';
      inner.appendChild(this._buildSvg());
      this.layer = document.createElement('div');
      this.layer.className = 'board-layer';
      inner.appendChild(this.layer);
      this.el.appendChild(inner);
      this.inner = inner;
    }

    _buildSvg() {
      const svgns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgns, 'svg');
      svg.setAttribute('class', 'board-lines');
      svg.setAttribute('viewBox', '0 0 8 9');
      svg.setAttribute('preserveAspectRatio', 'none');
      const line = (x1, y1, x2, y2) => {
        const l = document.createElementNS(svgns, 'line');
        l.setAttribute('x1', x1);
        l.setAttribute('y1', y1);
        l.setAttribute('x2', x2);
        l.setAttribute('y2', y2);
        svg.appendChild(l);
      };
      // ngang
      for (let y = 0; y <= 9; y++) line(0, y, 8, y);
      // dọc
      for (let x = 0; x <= 8; x++) {
        if (x === 0 || x === 8) {
          line(x, 0, x, 9);
        } else {
          line(x, 0, x, 4);
          line(x, 5, x, 9);
        }
      }
      // cung (đường chéo)
      line(3, 0, 5, 2);
      line(5, 0, 3, 2);
      line(3, 7, 5, 9);
      line(5, 7, 3, 9);
      // chữ sông
      const txt = document.createElementNS(svgns, 'text');
      txt.setAttribute('x', '2');
      txt.setAttribute('y', '4.62');
      txt.setAttribute('class', 'river-text');
      txt.textContent = '楚 河          漢 界';
      svg.appendChild(txt);
      return svg;
    }

    setInteractive(v) {
      this.interactive = v;
    }

    // Tỉ lệ vị trí theo % của board-inner
    _pos(x, y) {
      return { left: (x / 8) * 100, top: (y / 9) * 100 };
    }

    render(game) {
      this.game = game;
      this.layer.innerHTML = '';
      const checkColor = game.isInCheck(game.turn) ? game.turn : null;
      const kingPos = checkColor ? game.findKing(checkColor) : null;

      for (let y = 0; y < X.ROWS; y++) {
        for (let x = 0; x < X.COLS; x++) {
          const p = game.board[y][x];
          if (!p) continue;
          const color = X.colorOf(p);
          const div = document.createElement('div');
          div.className = 'bpiece ' + (color === X.RED ? 'red' : 'black');
          // Cờ úp: quân chưa lật hiển thị mặt sau (không lộ quân thật).
          if (this.opts.coveredFn && this.opts.coveredFn(x, y)) {
            div.classList.add('covered');
            div.textContent = '';
          } else {
            div.textContent = GLYPH[color][X.typeOf(p)];
          }
          const pos = this._pos(x, y);
          div.style.left = pos.left + '%';
          div.style.top = pos.top + '%';
          if (this.selected && this.selected.x === x && this.selected.y === y) {
            div.classList.add('selected');
          }
          if (
            this.lastMove &&
            ((this.lastMove.from.x === x && this.lastMove.from.y === y) ||
              (this.lastMove.to.x === x && this.lastMove.to.y === y))
          ) {
            div.classList.add('last-move');
          }
          if (kingPos && kingPos.x === x && kingPos.y === y) {
            div.classList.add('in-check');
          }
          div.addEventListener('click', () => this._onClick(x, y));
          this.layer.appendChild(div);
        }
      }

      // Điểm bấm cho ô đích hợp lệ (và toàn bộ điểm để bỏ chọn)
      for (const m of this.legalForSel) {
        const pt = document.createElement('div');
        const target = game.board[m.to.y][m.to.x];
        pt.className = 'bpoint' + (target ? ' capture' : '');
        const pos = this._pos(m.to.x, m.to.y);
        pt.style.left = pos.left + '%';
        pt.style.top = pos.top + '%';
        const hint = document.createElement('div');
        hint.className = 'hint';
        pt.appendChild(hint);
        pt.addEventListener('click', () => this._onClick(m.to.x, m.to.y));
        this.layer.appendChild(pt);
      }

      // Gợi ý nước đi (đánh dấu ô đi & ô đến, không tự đi)
      if (this.hintMove) {
        const mark = (mx, my, cls) => {
          const d = document.createElement('div');
          d.className = 'hint-mark ' + cls;
          const pos = this._pos(mx, my);
          d.style.left = pos.left + '%';
          d.style.top = pos.top + '%';
          this.layer.appendChild(d);
        };
        mark(this.hintMove.from.x, this.hintMove.from.y, 'hint-from');
        mark(this.hintMove.to.x, this.hintMove.to.y, 'hint-to');
      }
    }

    _onClick(x, y) {
      if (!this.interactive || !this.game) return;
      const human = this.opts.humanColor || X.RED;

      // Bấm vào ô đích hợp lệ -> đi
      if (this.selected) {
        const move = this.legalForSel.find((m) => m.to.x === x && m.to.y === y);
        if (move) {
          const from = this.selected;
          this.selected = null;
          this.legalForSel = [];
          if (this.opts.onMove) this.opts.onMove(from, { x, y });
          return;
        }
      }

      // Chọn quân của mình
      const p = this.game.board[y][x];
      if (p && X.colorOf(p) === human && this.game.turn === human) {
        this.selected = { x, y };
        this.legalForSel = this.game
          .legalMoves(human)
          .filter((m) => m.from.x === x && m.from.y === y);
        this.render(this.game);
        return;
      }

      // Bỏ chọn
      this.selected = null;
      this.legalForSel = [];
      this.render(this.game);
    }

    setLastMove(m) {
      this.lastMove = m;
    }

    setHint(m) {
      this.hintMove = m;
      if (this.game) this.render(this.game);
    }
    clearHint() {
      if (!this.hintMove) return;
      this.hintMove = null;
      if (this.game) this.render(this.game);
    }

    clearSelection() {
      this.selected = null;
      this.legalForSel = [];
    }
  }

  root.Board = Board;
})(typeof self !== 'undefined' ? self : this);
