// Shared state helpers used by items, events and the game loop.
// Status effects ("marks": shield, frozen, zombie) are keyed by square and travel with their piece.
import { other, safeAfter, kingAttacked, rankOf } from './rules.js';

export const MODES = {
  classic: { name: 'Classic', tag: 'Pure chess. No tricks.' },
  chaos: { name: 'Chaos', tag: 'Power-ups, crates and random events.', pool: 'power', start: 2, every: 4, max: 4, events: true, crates: true },
  weapons: { name: 'Weapon', tag: 'Lasers, rockets and hidden mines.', pool: 'weapon', start: 2, every: 3, max: 3 },
  cards: { name: 'Card', tag: 'A hand of rule-bending cards.', pool: 'card', start: 3, every: 2, max: 5 },
};

export const POOLS = {
  power: { teleport: 3, shield: 3, rewind: 1, clone: 2, mind: 2, swap: 2, ghost: 3, freeze: 3, resurrect: 2, evolve: 2 },
  weapon: { laser: 3, rocket: 2, mine: 3, emp: 2, shotgun: 3 },
  card: { reverse: 2, skip: 2, shuffle: 2, steal: 2, mimic: 2, double: 3, wildcard: 1 },
};

export function weighted(table, rnd = Math.random) {
  const entries = Object.entries(table);
  let t = rnd() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) if ((t -= w) < 0) return k;
  return entries[0][0];
}
export const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];
export function shuffled(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- marks ---------------------------------------------------------------
export const mark = (st, sq) => (st.marks[sq] ||= {});
export const shielded = (st, sq) => (st.marks[sq]?.shield || 0) > st.ply;
export const frozen = (st, sq) => (st.marks[sq]?.frozen || 0) > st.ply;

export function expireMarks(st) {
  for (const [sq, m] of Object.entries(st.marks)) {
    if (m.shield && m.shield <= st.ply) delete m.shield;
    if (m.frozen && m.frozen <= st.ply) delete m.frozen;
    if (!st.board[sq] || !Object.keys(m).length) delete st.marks[sq];
  }
  st.holes = st.holes.filter(h => h.until > st.ply);
  if (st.portals && st.portals.until <= st.ply) st.portals = null;
}

// ---- piece operations ------------------------------------------------------
export function relocate(st, from, to) {
  st.board[to] = st.board[from];
  delete st.board[from];
  if (st.marks[from]) st.marks[to] = st.marks[from]; else delete st.marks[to];
  delete st.marks[from];
}

/** Move several pieces at once (swaps, board flips). */
export function relocateMany(st, pairs) {
  const pieces = pairs.map(([f]) => [st.board[f], st.marks[f]]);
  pairs.forEach(([f]) => { delete st.board[f]; delete st.marks[f]; });
  pairs.forEach(([, t], i) => {
    st.board[t] = pieces[i][0];
    if (pieces[i][1]) st.marks[t] = pieces[i][1]; else delete st.marks[t];
  });
}

/** Remove a piece and record it as captured. Returns the piece code. */
export function destroy(st, sq) {
  const p = st.board[sq];
  if (!p) return null;
  delete st.board[sq];
  delete st.marks[sq];
  st.captured[p[0]].push(p[1]);
  return p;
}

export const hole = (st, sq) => st.holes.some(h => h.sq === sq);
export const crate = (st, sq) => st.crates.includes(sq);
export const portal = (st, sq) => !!st.portals && (st.portals.a === sq || st.portals.b === sq);
export const hazard = (st, sq) => hole(st, sq) || crate(st, sq) || portal(st, sq);

// ---- items -----------------------------------------------------------------
export function giveItem(st, c, kind, fx, why = 'gain') {
  const max = MODES[st.mode]?.max ?? 4;
  if (st.inv[c].length >= max) {
    fx.push({ k: 'toast', text: 'Inventory full — item lost', only: c });
    return false;
  }
  st.inv[c].push({ id: st.uid++, kind });
  fx.push({ k: 'gain', color: c, kind, why, only: c, pub: { k: 'gain', color: c, kind: null, why } });
  return true;
}

export function rollFor(st) {
  return weighted(POOLS[MODES[st.mode]?.pool || 'power']);
}

/**
 * A piece just landed on `sq` (moved there by `actor`). Resolve crates, portals,
 * mines and black holes. Returns the piece's final square, or null if it was destroyed.
 */
export function arrive(st, sq, actor, fx) {
  const piece = st.board[sq];
  if (!piece) return null;

  if (crate(st, sq)) {
    st.crates = st.crates.filter(s => s !== sq);
    fx.push({ k: 'pickup', sq, color: actor });
    giveItem(st, actor, rollFor(st), fx, 'crate');
  }

  if (portal(st, sq)) {
    const dest = st.portals.a === sq ? st.portals.b : st.portals.a;
    const ok = !st.board[dest] && (piece[1] !== 'p' || (rankOf(dest) > 0 && rankOf(dest) < 7))
      && safeAfter(st.board, actor, b => { b[dest] = b[sq]; delete b[sq]; });
    if (ok) {
      relocate(st, sq, dest);
      fx.push({ k: 'moves', list: [[sq, dest]], style: 'blink' }, { k: 'portal', from: sq, to: dest });
      sq = dest;
    }
  }

  const mine = st.mines.find(m => m.sq === sq && m.owner !== piece[0]);
  if (mine) {
    st.mines = st.mines.filter(m => m !== mine);
    const ok = piece[1] !== 'k' && safeAfter(st.board, actor, b => { delete b[sq]; });
    if (ok) {
      destroy(st, sq);
      fx.push({ k: 'boom', sqs: [sq], kind: 'mine' }, { k: 'toast', text: 'A hidden mine exploded!', icon: 'bomb' });
      return null;
    }
    fx.push({ k: 'toast', text: 'A mine fizzled — it was a dud.', icon: 'bomb' });
  }

  if (hole(st, sq)) {
    if (piece[1] === 'k' || !safeAfter(st.board, actor, b => { delete b[sq]; })) {
      st.holes = st.holes.filter(h => h.sq !== sq);
      fx.push({ k: 'toast', text: 'The black hole collapsed!', icon: 'circle-dot' });
    } else {
      destroy(st, sq);
      fx.push({ k: 'boom', sqs: [sq], kind: 'hole' }, { k: 'toast', text: 'Swallowed by the black hole!', icon: 'circle-dot' });
      return null;
    }
  }
  return sq;
}

/** Fields restored by Time Rewind. */
const SNAP = ['board', 'turn', 'castling', 'ep', 'half', 'full', 'marks', 'mines', 'crates', 'portals', 'holes', 'captured', 'lastMove'];
export function snapshot(st) {
  const s = {};
  for (const k of SNAP) s[k] = structuredClone(st[k]);
  return s;
}
export function restore(st, snap) {
  for (const k of SNAP) st[k] = structuredClone(snap[k]);
}

export const kingSafe = (st, c) => !kingAttacked(st.board, c);
export { other };
