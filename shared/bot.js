// A small, friendly computer opponent: shallow alpha-beta for moves plus simple item heuristics.
import { chessFor, VALUE, rankOf, fileOf, FILES } from './rules.js';
import { legalMoves, itemAllowed } from './game.js';
import { itemStep, itemUsable } from './items.js';

const CENTER = s => 3.5 - Math.max(Math.abs(fileOf(s) - 3.5), Math.abs(rankOf(s) - 3.5));

// Piece-square bonus precomputed on chess.js's 0x88 indices (a8 = 0 … h1 = 119).
const PST = {};
for (let i = 0; i < 128; i++) {
  if (i & 0x88) continue;
  const s = FILES[i & 15] + '87654321'[i >> 4];
  PST[i] = { center: CENTER(s), rank: rankOf(s) };
}
const ORDER = m => (m.captured ? VALUE[m.captured] * 10 - VALUE[m.piece] : -1) + (m.promotion ? 8 : 0);

// Uses chess.js internals (_moves/_makeMove/_undoMove/_board); the public API is ~50x slower here.
function evaluate(c) {
  let score = 0;
  const us = c._turn;
  for (let i = 0; i < 128; i++) {
    const p = c._board[i];
    if (!p) continue;
    let v = VALUE[p.type] * 100;
    if (p.type === 'n' || p.type === 'b') v += PST[i].center * 6;
    if (p.type === 'p') v += (p.color === 'w' ? PST[i].rank - 1 : 6 - PST[i].rank) * 6 + PST[i].center * 2;
    score += p.color === us ? v : -v;
  }
  return score;
}

// Keep resolving captures at the leaves so the bot doesn't blunder pieces to simple recaptures.
function quiesce(c, alpha, beta, depth) {
  const stand = evaluate(c);
  if (depth === 0 || stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const caps = c._moves({ legal: true }).filter(m => m.captured).sort((a, b) => ORDER(b) - ORDER(a));
  for (const m of caps) {
    c._makeMove(m);
    const s = -quiesce(c, -beta, -alpha, depth - 1);
    c._undoMove();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function search(c, depth, alpha, beta) {
  const moves = c._moves({ legal: true });
  if (!moves.length) return c._isKingAttacked(c._turn) ? -100000 - depth : 0;
  if (depth === 0) return quiesce(c, alpha, beta, 2);
  moves.sort((a, b) => ORDER(b) - ORDER(a));
  for (const m of moves) {
    c._makeMove(m);
    const s = -search(c, depth - 1, -beta, -alpha);
    c._undoMove();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

export function bestMove(st, color, depth = 2) {
  const moves = legalMoves(st, color);
  if (!moves.length) return null;
  const c = chessFor(st);
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    c._makeMove(m.raw);
    const s = -search(c, depth - 1, -Infinity, Infinity) + Math.random() * 12;
    c._undoMove();
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** Score a pick: prefer hitting valuable enemies / protecting valuable friends. */
function scorePick(st, color, kind, p) {
  const piece = st.board[p];
  if (!piece) return Math.random();
  const v = VALUE[piece[1]] + Math.random() * 0.5;
  const mine = piece[0] === color;
  if (['shield', 'evolve', 'clone'].includes(kind)) return mine ? v : -v;
  return mine ? -v : v;
}

/** Maybe use an item. Returns an action or null. */
export function botItem(st, color) {
  if (itemAllowed(st, color) || !st.inv[color].length || Math.random() > 0.45) return null;
  const usable = st.inv[color].filter(i => itemUsable(st, color, i.kind));
  if (!usable.length) return null;
  const it = usable[Math.floor(Math.random() * usable.length)];
  const picks = [];
  for (let s = itemStep(st, color, it.kind, picks); s; s = itemStep(st, color, it.kind, picks)) {
    if (!s.targets.length) return null;
    const ranked = [...s.targets].sort((a, b) => scorePick(st, color, it.kind, b) - scorePick(st, color, it.kind, a));
    picks.push(ranked[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * ranked.length)]);
  }
  return { type: 'item', id: it.id, picks };
}

export function botAction(st, color, { usedItem = false } = {}) {
  if (!usedItem) {
    const a = botItem(st, color);
    if (a) return a;
  }
  const m = bestMove(st, color, 2);
  return m ? { type: 'move', from: m.from, to: m.to, promotion: m.promotion } : null;
}
