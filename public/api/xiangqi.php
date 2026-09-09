<?php
/*
 * xiangqi.php — Engine luật Cờ Tướng cho SERVER (bản port 1:1 từ public/js/engine/xiangqi.js).
 *
 * Vì sao cần: bản PHP đồng bộ ván bằng polling, trước đây để CLIENT tự khai ai thắng.
 * Khi ván có cược điểm thì người thua chỉ cần gọi thẳng API khai mình thắng là ôm
 * trọn tiền cược. File này cho server tự phát lại toàn bộ nước đi, tự kiểm luật và
 * tự kết luận chiếu hết — client không khai được nữa.
 *
 * Quy ước bàn cờ (giống hệt bản JS):
 *   - 9 cột (x: 0..8), 10 hàng (y: 0..9). y=0 ở TRÊN (Đen), y=9 ở DƯỚI (Đỏ).
 *   - Đỏ đi lên (y giảm), Đen đi xuống (y tăng).
 *   - Ký tự HOA = Đỏ, thường = Đen. K Tướng, A Sĩ, E Tượng, H Mã, R Xe, C Pháo, P Tốt.
 *   - Ô trống = null.
 *
 * ⚠ Sửa file này thì PHẢI sửa cả public/js/engine/xiangqi.js cho khớp, nếu không
 *   server và trình duyệt sẽ bất đồng về nước đi hợp lệ.
 */

class Xiangqi
{
    const COLS = 9;
    const ROWS = 10;
    const RED = 'r';
    const BLACK = 'b';

    /** @var array bàn cờ [y][x] */
    public $board;
    /** @var string bên đang tới lượt */
    public $turn;
    /** @var array lịch sử nước đi */
    public $history = [];

    public function __construct($board = null, $turn = null)
    {
        $this->board = $board ?: self::initialBoard();
        $this->turn  = $turn ?: self::RED; // Đỏ đi trước
    }

    public static function initialBoard()
    {
        // y0 = Đen (trên), y9 = Đỏ (dưới)
        return [
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
    }

    private static function ortho()
    {
        return [[0, -1], [0, 1], [-1, 0], [1, 0]];
    }

    public static function inside($x, $y)
    {
        return $x >= 0 && $x < self::COLS && $y >= 0 && $y < self::ROWS;
    }

    public static function colorOf($piece)
    {
        if ($piece === null || $piece === '') return null;
        return $piece === strtoupper($piece) ? self::RED : self::BLACK;
    }

    public static function typeOf($piece)
    {
        return ($piece === null || $piece === '') ? null : strtoupper($piece);
    }

    public static function inPalace($color, $x, $y)
    {
        if ($x < 3 || $x > 5) return false;
        if ($color === self::RED) return $y >= 7 && $y <= 9;
        return $y >= 0 && $y <= 2;
    }

    public function findKing($color)
    {
        $k = $color === self::RED ? 'K' : 'k';
        for ($y = 0; $y < self::ROWS; $y++) {
            for ($x = 0; $x < self::COLS; $x++) {
                if ($this->board[$y][$x] === $k) return ['x' => $x, 'y' => $y];
            }
        }
        return null;
    }

    /* ---------- Phát hiện ô bị tấn công ---------- */
    // (tx,ty) có bị quân màu $by tấn công không?
    public function isAttacked($tx, $ty, $by)
    {
        $b = $this->board;

        // Xe & Pháo & Tướng (đối mặt) theo 4 hướng trực giao
        foreach (self::ortho() as $d) {
            list($dx, $dy) = $d;
            $cx = $tx + $dx;
            $cy = $ty + $dy;
            // tìm quân đầu tiên
            while (self::inside($cx, $cy) && !$b[$cy][$cx]) {
                $cx += $dx;
                $cy += $dy;
            }
            if (self::inside($cx, $cy)) {
                $firstPiece = $b[$cy][$cx];
                if (self::colorOf($firstPiece) === $by) {
                    $t = self::typeOf($firstPiece);
                    if ($t === 'R') return true; // Xe
                    // Tướng: ăn ô liền kề, hoặc luật "tướng đối mặt" theo cột dọc
                    if ($t === 'K') {
                        if ($dx === 0) return true; // cùng cột, không quân chắn -> đối mặt / kề
                        $dist = abs($cx - $tx) + abs($cy - $ty);
                        if ($dist === 1) return true;
                    }
                }
                // Pháo: vượt qua quân đầu (ngòi) tìm quân thứ hai
                $px = $cx + $dx;
                $py = $cy + $dy;
                while (self::inside($px, $py) && !$b[$py][$px]) {
                    $px += $dx;
                    $py += $dy;
                }
                if (self::inside($px, $py)) {
                    $second = $b[$py][$px];
                    if (self::colorOf($second) === $by && self::typeOf($second) === 'C') return true;
                }
            }
        }

        // Mã (xét vị trí mã có thể nhảy tới, kèm cản chân)
        $horseFrom = [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];
        foreach ($horseFrom as $d) {
            list($dx, $dy) = $d;
            $hx = $tx + $dx;
            $hy = $ty + $dy;
            if (!self::inside($hx, $hy)) continue;
            $p = $b[$hy][$hx];
            if (self::colorOf($p) === $by && self::typeOf($p) === 'H') {
                // chân mã: ô kề mã theo trục dài (độ lớn 2)
                $lx = $hx;
                $ly = $hy;
                if (abs($dy) === 2) $ly = $hy - intdiv($dy, 2);
                else $lx = $hx - intdiv($dx, 2);
                if (!$b[$ly][$lx]) return true; // chân không bị cản
            }
        }

        // Sĩ (kề chéo)
        foreach ([[1, 1], [1, -1], [-1, 1], [-1, -1]] as $d) {
            list($dx, $dy) = $d;
            $ax = $tx + $dx;
            $ay = $ty + $dy;
            if (self::inside($ax, $ay)) {
                $p = $b[$ay][$ax];
                if (self::colorOf($p) === $by && self::typeOf($p) === 'A') return true;
            }
        }

        // Tượng (cách 2 chéo, mắt tượng không bị cản)
        foreach ([[2, 2], [2, -2], [-2, 2], [-2, -2]] as $d) {
            list($dx, $dy) = $d;
            $ex = $tx + $dx;
            $ey = $ty + $dy;
            if (self::inside($ex, $ey)) {
                $p = $b[$ey][$ex];
                if (self::colorOf($p) === $by && self::typeOf($p) === 'E') {
                    $eyeX = $tx + intdiv($dx, 2);
                    $eyeY = $ty + intdiv($dy, 2);
                    if (!$b[$eyeY][$eyeX]) return true;
                }
            }
        }

        // Tốt
        if ($by === self::RED) {
            // Tốt Đỏ đi lên: tấn công ô phía trên nó -> nó ở (tx, ty+1)
            if (self::inside($tx, $ty + 1) && $b[$ty + 1][$tx] === 'P') return true;
            // đi ngang khi đã qua sông (tốt nằm ở nửa Đen: y<=4)
            if ($ty <= 4) {
                if (self::inside($tx - 1, $ty) && $b[$ty][$tx - 1] === 'P') return true;
                if (self::inside($tx + 1, $ty) && $b[$ty][$tx + 1] === 'P') return true;
            }
        } else {
            if (self::inside($tx, $ty - 1) && $b[$ty - 1][$tx] === 'p') return true;
            if ($ty >= 5) {
                if (self::inside($tx - 1, $ty) && $b[$ty][$tx - 1] === 'p') return true;
                if (self::inside($tx + 1, $ty) && $b[$ty][$tx + 1] === 'p') return true;
            }
        }

        return false;
    }

    public function isInCheck($color)
    {
        $k = $this->findKing($color);
        if (!$k) return true; // mất Tướng coi như bị chiếu (không nên xảy ra)
        $enemy = $color === self::RED ? self::BLACK : self::RED;
        return $this->isAttacked($k['x'], $k['y'], $enemy);
    }

    /* ---------- Sinh nước đi giả hợp lệ (chưa lọc tự chiếu) ---------- */
    public function pseudoMoves($color)
    {
        $moves = [];
        for ($y = 0; $y < self::ROWS; $y++) {
            for ($x = 0; $x < self::COLS; $x++) {
                $p = $this->board[$y][$x];
                if (!$p || self::colorOf($p) !== $color) continue;
                $this->pieceMoves($x, $y, $p, $color, $moves);
            }
        }
        return $moves;
    }

    private function pieceMoves($x, $y, $p, $color, &$out)
    {
        $b = $this->board;
        $t = self::typeOf($p);

        $add = function ($nx, $ny) use ($b, $x, $y, $color, &$out) {
            if (!self::inside($nx, $ny)) return;
            $dst = $b[$ny][$nx];
            if (self::colorOf($dst) === $color) return; // không ăn quân nhà
            $out[] = ['from' => ['x' => $x, 'y' => $y], 'to' => ['x' => $nx, 'y' => $ny]];
        };

        if ($t === 'K') {
            foreach (self::ortho() as $d) {
                $nx = $x + $d[0];
                $ny = $y + $d[1];
                if (self::inPalace($color, $nx, $ny)) $add($nx, $ny);
            }
        } elseif ($t === 'A') {
            foreach ([[1, 1], [1, -1], [-1, 1], [-1, -1]] as $d) {
                $nx = $x + $d[0];
                $ny = $y + $d[1];
                if (self::inPalace($color, $nx, $ny)) $add($nx, $ny);
            }
        } elseif ($t === 'E') {
            foreach ([[2, 2], [2, -2], [-2, 2], [-2, -2]] as $d) {
                list($dx, $dy) = $d;
                $nx = $x + $dx;
                $ny = $y + $dy;
                if (!self::inside($nx, $ny)) continue;
                // không qua sông
                if ($color === self::RED && $ny < 5) continue;
                if ($color === self::BLACK && $ny > 4) continue;
                // mắt tượng
                if ($b[$y + intdiv($dy, 2)][$x + intdiv($dx, 2)]) continue;
                $add($nx, $ny);
            }
        } elseif ($t === 'H') {
            $horse = [
                [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
                [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
            ];
            foreach ($horse as $h) {
                list($dx, $dy, $lx, $ly) = $h;
                $nx = $x + $dx;
                $ny = $y + $dy;
                if (!self::inside($nx, $ny)) continue;
                if ($b[$y + $ly][$x + $lx]) continue; // cản chân
                $add($nx, $ny);
            }
        } elseif ($t === 'R') {
            foreach (self::ortho() as $d) {
                list($dx, $dy) = $d;
                $nx = $x + $dx;
                $ny = $y + $dy;
                while (self::inside($nx, $ny) && !$b[$ny][$nx]) {
                    $out[] = ['from' => ['x' => $x, 'y' => $y], 'to' => ['x' => $nx, 'y' => $ny]];
                    $nx += $dx;
                    $ny += $dy;
                }
                if (self::inside($nx, $ny) && self::colorOf($b[$ny][$nx]) !== $color) {
                    $out[] = ['from' => ['x' => $x, 'y' => $y], 'to' => ['x' => $nx, 'y' => $ny]];
                }
            }
        } elseif ($t === 'C') {
            foreach (self::ortho() as $d) {
                list($dx, $dy) = $d;
                $nx = $x + $dx;
                $ny = $y + $dy;
                // di chuyển (không ăn)
                while (self::inside($nx, $ny) && !$b[$ny][$nx]) {
                    $out[] = ['from' => ['x' => $x, 'y' => $y], 'to' => ['x' => $nx, 'y' => $ny]];
                    $nx += $dx;
                    $ny += $dy;
                }
                // vượt ngòi rồi tìm quân thứ hai để ăn
                $nx += $dx;
                $ny += $dy;
                while (self::inside($nx, $ny) && !$b[$ny][$nx]) {
                    $nx += $dx;
                    $ny += $dy;
                }
                if (self::inside($nx, $ny) && self::colorOf($b[$ny][$nx]) !== $color) {
                    $out[] = ['from' => ['x' => $x, 'y' => $y], 'to' => ['x' => $nx, 'y' => $ny]];
                }
            }
        } elseif ($t === 'P') {
            $forward = $color === self::RED ? -1 : 1;
            $add($x, $y + $forward);
            // qua sông mới đi ngang
            $crossed = $color === self::RED ? $y <= 4 : $y >= 5;
            if ($crossed) {
                $add($x - 1, $y);
                $add($x + 1, $y);
            }
        }
    }

    /* ---------- Nước đi hợp lệ (đã lọc tự chiếu) ---------- */
    public function legalMoves($color = null)
    {
        $color = $color ?: $this->turn;
        $pseudo = $this->pseudoMoves($color);
        $legal = [];
        foreach ($pseudo as $m) {
            $cap = $this->applyMove($m);
            $inCheck = $this->isInCheck($color);
            $this->revertMove($m, $cap);
            if (!$inCheck) $legal[] = $m;
        }
        return $legal;
    }

    private function applyMove($m)
    {
        $piece = $this->board[$m['from']['y']][$m['from']['x']];
        $captured = $this->board[$m['to']['y']][$m['to']['x']];
        $this->board[$m['to']['y']][$m['to']['x']] = $piece;
        $this->board[$m['from']['y']][$m['from']['x']] = null;
        return $captured;
    }

    private function revertMove($m, $captured)
    {
        $piece = $this->board[$m['to']['y']][$m['to']['x']];
        $this->board[$m['from']['y']][$m['from']['x']] = $piece;
        $this->board[$m['to']['y']][$m['to']['x']] = $captured;
    }

    /**
     * Thực hiện nước đi. Trả về mảng thông tin nước đi, hoặc null nếu PHẠM LUẬT.
     * Đây là chốt chặn: nước đi không hợp lệ sẽ bị từ chối ngay ở server.
     */
    public function move($from, $to)
    {
        if (!is_array($from) || !is_array($to)) return null;
        if (!isset($from['x'], $from['y'], $to['x'], $to['y'])) return null;
        $fx = (int) $from['x']; $fy = (int) $from['y'];
        $tx = (int) $to['x'];   $ty = (int) $to['y'];
        if (!self::inside($fx, $fy) || !self::inside($tx, $ty)) return null;

        $piece = $this->board[$fy][$fx];
        if (!$piece || self::colorOf($piece) !== $this->turn) return null;

        $ok = false;
        foreach ($this->legalMoves($this->turn) as $m) {
            if ($m['from']['x'] === $fx && $m['from']['y'] === $fy
                && $m['to']['x'] === $tx && $m['to']['y'] === $ty) {
                $ok = true;
                break;
            }
        }
        if (!$ok) return null;

        $captured = $this->board[$ty][$tx];
        $this->board[$ty][$tx] = $piece;
        $this->board[$fy][$fx] = null;
        $record = [
            'from' => ['x' => $fx, 'y' => $fy],
            'to' => ['x' => $tx, 'y' => $ty],
            'piece' => $piece,
            'captured' => $captured,
            'prevTurn' => $this->turn,
        ];
        $this->history[] = $record;
        $this->turn = $this->turn === self::RED ? self::BLACK : self::RED;
        return $record;
    }

    public function isCheckmate($color = null)
    {
        $color = $color ?: $this->turn;
        return $this->isInCheck($color) && count($this->legalMoves($color)) === 0;
    }

    public function isStalemate($color = null)
    {
        $color = $color ?: $this->turn;
        return !$this->isInCheck($color) && count($this->legalMoves($color)) === 0;
    }

    /**
     * Trạng thái cho bên đang tới lượt.
     * Trong cờ tướng, hết nước đi (kể cả không bị chiếu) thì bên đó THUA.
     */
    public function status()
    {
        $color = $this->turn;
        $noMoves = count($this->legalMoves($color)) === 0;
        if ($noMoves) {
            return [
                'over' => true,
                'loser' => $color,
                'reason' => $this->isInCheck($color) ? 'checkmate' : 'stalemate',
            ];
        }
        if ($this->isInCheck($color)) return ['over' => false, 'check' => $color];
        return ['over' => false];
    }

    /**
     * Phát lại danh sách nước đi từ thế cờ ban đầu.
     * Trả về [Xiangqi $game, int $applied] — $applied là số nước hợp lệ đã đi được.
     * Nếu $applied < số nước truyền vào, nghĩa là dữ liệu ván có nước phạm luật.
     */
    public static function replay($moves)
    {
        $g = new self();
        $applied = 0;
        if (is_array($moves)) {
            foreach ($moves as $mv) {
                if (!isset($mv['from'], $mv['to'])) break;
                if ($g->move($mv['from'], $mv['to']) === null) break;
                $applied++;
            }
        }
        return [$g, $applied];
    }
}
