// Standard chess layer: board geometry, attack detection and chess.js glue.
// Game state keeps the board as a plain JSON map ({ e1: 'wk', ... }) so it can be
// cloned, snapshotted and sent over the wire. chess.js generates legal moves.
import { Chess } from 'chess.js';

export const FILES = 'abcdefgh';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

export const sqName = (f, r) => FILES[f] + (r + 1);
export const fileOf = s => s.charCodeAt(0) - 97;
export const rankOf = s => s.charCodeAt(1) - 49;
export const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
export const other = c => (c === 'w' ? 'b' : 'w');
export const ALL_SQUARES = [];
for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) ALL_SQUARES.push(sqName(f, r));

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function offset(sq, df, dr) {
  const f = fileOf(sq) + df, r = rankOf(sq) + dr;
  return onBoard(f, r) ? sqName(f, r) : null;
}
export const neighbors = sq => KING.map(([df, dr]) => offset(sq, df, dr)).filter(Boolean);

/** Is `sq` attacked by any piece of color `by` on this board? */
export function isAttacked(board, sq, by) {
  const dir = by === 'w' ? 1 : -1;
  for (const df of [-1, 1]) if (board[offset(sq, df, -dir)] === by + 'p') return true;
  for (const [df, dr] of KNIGHT) if (board[offset(sq, df, dr)] === by + 'n') return true;
  for (const [df, dr] of KING) if (board[offset(sq, df, dr)] === by + 'k') return true;
  const ray = (dirs, types) => {
    for (const [df, dr] of dirs) {
      let s = offset(sq, df, dr);
      while (s) {
        const p = board[s];
        if (p) { if (p[0] === by && types.includes(p[1])) return true; break; }
        s = offset(s, df, dr);
      }
    }
    return false;
  };
  return ray(ORTHO, 'rq') || ray(DIAG, 'bq');
}

export const kingSq = (board, c) => Object.keys(board).find(s => board[s] === c + 'k');
export function kingAttacked(board, c) {
  const k = kingSq(board, c);
  return k ? isAttacked(board, k, other(c)) : false;
}
export const inCheck = (st, c) => kingAttacked(st.board, c);

/** Would color `c`'s king be safe after applying `mutate` to a copy of the board? */
export function safeAfter(board, c, mutate) {
  const b = { ...board };
  mutate(b);
  return !kingAttacked(b, c);
}

/** Pawns may never stand on the first or last rank. */
export const pawnOk = (piece, sq) => piece[1] !== 'p' || (rankOf(sq) !== 0 && rankOf(sq) !== 7);

/** Castling rights survive only while the king and rook are still on their home squares. */
export function sanitizeCastling(st) {
  const b = st.board;
  const need = { K: ['e1', 'wk', 'h1', 'wr'], Q: ['e1', 'wk', 'a1', 'wr'], k: ['e8', 'bk', 'h8', 'br'], q: ['e8', 'bk', 'a8', 'br'] };
  st.castling = [...(st.castling || '')].filter(ch => {
    const n = need[ch];
    return n && b[n[0]] === n[1] && b[n[2]] === n[3];
  }).join('');
}

export function placement(board) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[sqName(f, r)];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p[0] === 'w' ? p[1].toUpperCase() : p[1];
    }
    rows.push(row + (empty || ''));
  }
  return rows.join('/');
}

export function toFen(st) {
  return `${placement(st.board)} ${st.turn} ${st.castling || '-'} ${st.ep || '-'} ${st.half} ${st.full}`;
}

export function readFen(fen) {
  const [pl, turn, castling, ep, half, full] = fen.split(' ');
  const board = {};
  pl.split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      board[sqName(f, 7 - i)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase();
      f++;
    }
  });
  return { board, turn, castling: castling === '-' ? '' : castling, ep: ep === '-' ? '' : ep, half: +half, full: +full };
}

export const chessFor = st => new Chess(toFen(st), { skipValidation: true });

// chess.js's public verbose moves() builds SAN + FEN strings for every move, which is far too
// slow for legality checks and the bot. We use its internal generator (version pinned) instead.
const SQ88 = i => FILES[i & 15] + '87654321'[i >> 4];
const FLAG_BITS = [[1, 'n'], [2, 'c'], [4, 'b'], [8, 'e'], [16, 'p'], [32, 'k'], [64, 'q']];
export function fastMoves(c) {
  return c._moves({ legal: true }).map(m => ({
    from: SQ88(m.from), to: SQ88(m.to), promotion: m.promotion, piece: m.piece, captured: m.captured,
    flags: FLAG_BITS.filter(([b]) => m.flags & b).map(([, ch]) => ch).join(''), raw: m,
  }));
}

/** Raw legal moves from chess.js for the side to move (no custom filters). */
export const rawMoves = st => fastMoves(chessFor(st));

export function insufficientMaterial(st) {
  return chessFor(st).isInsufficientMaterial();
}

/** Pseudo-legal destinations for a non-pawn piece of `type` at `from`.
 *  `friend` = color whose pieces block / can't be captured. `ghost` passes through pieces. */
export function pieceTargets(board, from, type, friend, ghost = false) {
  const out = [];
  const add = s => { if (s && board[s]?.[0] !== friend) out.push(s); };
  if (type === 'n') KNIGHT.forEach(([df, dr]) => add(offset(from, df, dr)));
  if (type === 'k') KING.forEach(([df, dr]) => add(offset(from, df, dr)));
  const dirs = type === 'r' ? ORTHO : type === 'b' ? DIAG : type === 'q' ? [...ORTHO, ...DIAG] : [];
  for (const [df, dr] of dirs) {
    let s = offset(from, df, dr);
    while (s) {
      if (!board[s]) out.push(s);
      else {
        if (board[s][0] !== friend) out.push(s);
        if (!ghost) break;
      }
      s = offset(s, df, dr);
    }
  }
  return out;
}
