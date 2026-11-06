// Chaos-mode random events. Each run() works on a scratch copy of the state; if the
// result is illegal (the side that just moved would be in check) we retry or skip.
import { ALL_SQUARES, rankOf, fileOf, sqName, neighbors, offset, pawnOk, kingAttacked, other, sanitizeCastling } from './rules.js';
import { shielded, destroy, relocate, relocateMany, hole, hazard, mark, pick, weighted, shuffled, hideMap } from './state.js';

const midEmpty = st => ALL_SQUARES.filter(s => rankOf(s) >= 2 && rankOf(s) <= 5 && !st.board[s] && !hazard(st, s));
const vulnerable = (st, s) => st.board[s] && st.board[s][1] !== 'k' && !shielded(st, s);

export const EVENTS = {
  meteor: {
    name: 'Meteor Strike', icon: 'flame', weight: 3, desc: 'Three squares get flattened. Shields absorb the hit.',
    run(st, fx, rnd) {
      const sqs = shuffled(ALL_SQUARES, rnd).filter(s => st.board[s]?.[1] !== 'k').slice(0, 3);
      const hit = sqs.filter(s => vulnerable(st, s));
      sqs.forEach(s => { if (st.board[s] && shielded(st, s)) delete st.marks[s].shield; });
      hit.forEach(s => destroy(st, s));
      st.mines = st.mines.filter(m => !sqs.includes(m.sq));
      st.crates = st.crates.filter(s => !sqs.includes(s));
      fx.push({ k: 'meteor', sqs });
      return true;
    },
  },
  earthquake: {
    name: 'Earthquake', icon: 'activity', weight: 3, desc: 'Pieces get shaken onto neighbouring squares.',
    run(st, fx, rnd) {
      const list = [];
      for (const s of shuffled(Object.keys(st.board), rnd)) {
        const p = st.board[s];
        if (p[1] === 'k' || rnd() > 0.4) continue;
        const opts = neighbors(s).filter(t => !st.board[t] && !hole(st, t) && pawnOk(p, t) && (p[1] !== 'p' || rankOf(t) === rankOf(s)));
        if (!opts.length) continue;
        const t = pick(opts, rnd);
        relocate(st, s, t);
        list.push([s, t]);
      }
      fx.push({ k: 'shake' }, { k: 'moves', list, style: 'slide' });
      return list.length > 0;
    },
  },
  blackhole: {
    name: 'Black Hole', icon: 'circle-dot', weight: 2, desc: 'A black hole opens for a few turns. Anything that lands on it is gone.',
    run(st, fx, rnd) {
      const sq = pick(midEmpty(st), rnd);
      if (!sq) return false;
      st.holes.push({ sq, until: st.ply + 6 });
      const eaten = neighbors(sq).filter(s => vulnerable(st, s) && rnd() < 0.4);
      eaten.forEach(s => destroy(st, s));
      fx.push({ k: 'hole', sq, eaten });
      return true;
    },
  },
  gravity: {
    name: 'Gravity Flip', icon: 'arrow-down-up', weight: 2, desc: 'Everything slides one square toward one side of the board.',
    run(st, fx, rnd) {
      const dir = rnd() < 0.5 ? 1 : -1;
      const order = Object.keys(st.board).sort((a, b) => (rankOf(b) - rankOf(a)) * dir);
      const list = [];
      for (const s of order) {
        const p = st.board[s], t = offset(s, 0, dir);
        if (p[1] === 'k' || !t || st.board[t] || hole(st, t) || !pawnOk(p, t)) continue;
        relocate(st, s, t);
        list.push([s, t]);
      }
      fx.push({ k: 'moves', list, style: 'slide' });
      fx[0].sub = dir > 0 ? "Everything slides toward Black's side" : "Everything slides toward White's side";
      return list.length > 0;
    },
  },
  rotate: {
    name: 'Board Rotation', icon: 'flip-horizontal-2', weight: 2, desc: 'The board spins around — kingside becomes queenside. Castling rights are lost.',
    run(st, fx) {
      const m = s => sqName(7 - fileOf(s), rankOf(s));
      const pairs = Object.keys(st.board).map(s => [s, m(s)]);
      relocateMany(st, pairs);
      st.mines.forEach(x => (x.sq = m(x.sq)));
      st.crates = st.crates.map(m);
      st.holes.forEach(h => (h.sq = m(h.sq)));
      if (st.portals) { st.portals.a = m(st.portals.a); st.portals.b = m(st.portals.b); }
      st.castling = '';
      fx.push({ k: 'spin' }, { k: 'moves', list: pairs.filter(([a, b]) => a !== b), style: 'instant' });
      return true;
    },
  },
  portals: {
    name: 'Portals', icon: 'orbit', weight: 2, desc: 'Two linked portals appear. Land on one, pop out of the other.',
    run(st, fx, rnd) {
      if (st.portals) return false;
      const opts = midEmpty(st);
      const a = pick(opts, rnd);
      const b = pick(opts.filter(s => s !== a && Math.abs(rankOf(s) - rankOf(a)) + Math.abs(fileOf(s) - fileOf(a)) > 3), rnd);
      if (!a || !b) return false;
      st.portals = { a, b, until: st.ply + 10 };
      fx.push({ k: 'portals', a, b });
      return true;
    },
  },
  zombies: {
    name: 'Zombie Pieces', icon: 'skull', weight: 2, desc: 'A fallen piece from each side claws its way back.',
    run(st, fx, rnd) {
      const risen = [];
      for (const c of ['w', 'b']) {
        const types = st.captured[c].filter(t => t !== 'k');
        if (!types.length) continue;
        const t = pick(types, rnd);
        const ranks = c === 'w' ? [2, 3] : [5, 4];
        const sq = pick(midEmpty(st).filter(s => ranks.includes(rankOf(s))), rnd);
        if (!sq) continue;
        st.captured[c].splice(st.captured[c].indexOf(t), 1);
        st.board[sq] = c + t;
        mark(st, sq).zombie = true;
        risen.push(sq);
      }
      fx.push({ k: 'aura', sqs: risen, kind: 'zombie' });
      return risen.length > 0;
    },
  },
  mutation: {
    name: 'Mutation', icon: 'dna', weight: 3, desc: 'One random piece on each side mutates into something else.',
    run(st, fx, rnd) {
      const sqs = [];
      for (const c of ['w', 'b']) {
        const opts = Object.keys(st.board).filter(s => st.board[s][0] === c && st.board[s][1] !== 'k');
        const s = pick(opts, rnd);
        if (!s) continue;
        const cur = st.board[s][1];
        const types = { p: 3, n: 3, b: 3, r: 2, q: 1 };
        delete types[cur];
        if (!pawnOk(c + 'p', s)) delete types.p;
        st.board[s] = c + weighted(types, rnd);
        sqs.push(s);
      }
      fx.push({ k: 'aura', sqs, kind: 'mutate' });
      return sqs.length > 0;
    },
  },
};

/** Fire a random event at the start of `st.turn`'s turn. Mutates st on success. */
export function runEvent(st, fx, rnd = Math.random) {
  const weights = Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, e.weight]));
  for (let attempt = 0; attempt < 12; attempt++) {
    const id = weighted(weights, rnd);
    const scratch = structuredClone({ ...st, turnSnap: null, rewindSnap: null });
    const local = [];
    if (!EVENTS[id].run(scratch, local, rnd)) continue;
    // The side that just moved must never be left in check.
    if (kingAttacked(scratch.board, other(scratch.turn))) continue;
    sanitizeCastling(scratch);
    scratch.ep = '';
    const { turnSnap, rewindSnap, board: before } = st; // board before the event, for client animation sequencing
    const hide = hideMap(st);
    Object.assign(st, scratch, { turnSnap, rewindSnap });
    const e = EVENTS[id];
    fx.push({ k: 'event', id, name: e.name, icon: e.icon, desc: local[0]?.sub || e.desc, before, hide }, ...local);
    return id;
  }
  return null;
}
