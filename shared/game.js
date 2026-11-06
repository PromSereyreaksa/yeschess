// Game loop: authoritative state transitions shared by the server and local games.
import {
  START_FEN, readFen, chessFor, rawMoves, inCheck, kingSq, other, placement, sanitizeCastling, insufficientMaterial, ALL_SQUARES, rankOf,
} from './rules.js';
import {
  MODES, shielded, frozen, relocate, destroy, arrive, expireMarks, giveItem, rollFor, snapshot, hazard, pick,
} from './state.js';
import { ITEMS, itemUsable, validatePicks, canRewind } from './items.js';
import { runEvent } from './events.js';

export { MODES };

export function newGame(mode = 'classic') {
  if (!MODES[mode]) mode = 'classic';
  const st = {
    mode, ...readFen(START_FEN),
    ply: 0, seq: 0, uid: 1,
    status: 'playing', result: null,
    captured: { w: [], b: [] },
    inv: { w: [], b: [] },
    marks: {}, mines: [], crates: [], portals: null, holes: [],
    extra: { w: [], b: [] }, bonus: null, jam: { w: 0, b: 0 },
    turns: { w: 0, b: 0 },
    nextEvent: 5 + Math.floor(Math.random() * 3),
    lastMove: null, history: [], positions: {},
    turnSnap: null, rewindSnap: null,
  };
  const m = MODES[mode];
  const sink = [];
  for (const c of ['w', 'b']) for (let i = 0; i < (m.start || 0); i++) giveItem(st, c, rollFor(st), sink);
  st.turnSnap = snapshot(st);
  return st;
}

/** Fully filtered legal standard moves for `color`. */
export function legalMoves(st, color) {
  if (st.status !== 'playing' || st.turn !== color) return [];
  const ex = st.bonus?.kind === 'double' ? st.bonus.exclude : null;
  return rawMoves(st).filter(m => {
    if (frozen(st, m.from) || m.from === ex) return false;
    const victim = m.flags.includes('e') ? m.to[0] + m.from[1] : m.captured ? m.to : null;
    return !(victim && shielded(st, victim));
  });
}

export function itemAllowed(st, color) {
  if (st.status !== 'playing' || st.turn !== color) return 'Not your turn';
  if (st.jam[color] > st.ply) return 'Jammed by an EMP this turn';
  if (st.bonus?.kind === 'double') return 'Double Move: moves only';
  return null;
}

export function applyAction(st, color, a) {
  const fx = [];
  if (!a || typeof a !== 'object') throw new Error('Bad action');
  if (st.status !== 'playing') throw new Error('The game is over');

  if (a.type === 'resign') {
    finish(st, other(color), 'resignation', fx);
    st.seq++;
    return fx;
  }
  if (st.turn !== color) throw new Error('Not your turn');

  if (a.type === 'move') {
    const mv = legalMoves(st, color).find(m => m.from === a.from && m.to === a.to && (!m.promotion || m.promotion === (a.promotion || 'q')));
    if (!mv) throw new Error('Illegal move');
    standardMove(st, color, mv, fx);
    endTurn(st, color, fx);
  } else if (a.type === 'item') {
    const why = itemAllowed(st, color);
    if (why) throw new Error(why);
    const idx = st.inv[color].findIndex(i => i.id === a.id);
    if (idx < 0) throw new Error('You don’t have that item');
    const kind = st.inv[color][idx].kind;
    const def = ITEMS[kind];
    if (!itemUsable(st, color, kind)) throw new Error(`${def.name} can’t be used right now`);
    const picks = a.picks || [];
    validatePicks(st, color, kind, picks);
    st.inv[color].splice(idx, 1);
    const shown = def.secret ? [] : picks.filter(p => ALL_SQUARES.includes(p));
    fx.push({ k: 'item', color, kind, sqs: shown, before: { ...st.board } }); // board before the item, for client sequencing
    def.apply(st, color, picks, fx);
    st.history.push({ color, text: def.name, item: kind });
    if (!def.free && inCheck(st, color)) throw new Error('That would leave your king in check');
    if (!def.free) {
      st.turn = other(color);
      st.ep = '';
      st.half++;
      if (color === 'b') st.full++;
      endTurn(st, color, fx);
    } else if (kind === 'rewind') {
      checkEnd(st, fx);
    }
  } else {
    throw new Error('Unknown action');
  }
  st.seq++;
  return fx;
}

function standardMove(st, color, mv, fx) {
  const c = chessFor(st);
  const res = c.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  const list = [[mv.from, mv.to]];
  if (res.flags.includes('e')) {
    const victim = mv.to[0] + mv.from[1];
    destroy(st, victim);
    fx.push({ k: 'capture', sq: victim });
  } else if (res.captured) {
    destroy(st, mv.to);
    fx.push({ k: 'capture', sq: mv.to });
  }
  relocate(st, mv.from, mv.to);
  if (res.flags.includes('k') || res.flags.includes('q')) {
    const r = mv.from[1];
    const [rf, rt] = res.flags.includes('k') ? ['h' + r, 'f' + r] : ['a' + r, 'd' + r];
    relocate(st, rf, rt);
    list.push([rf, rt]);
  }
  Object.assign(st, readFen(c.fen()), { marks: st.marks, captured: st.captured });
  st.lastMove = { from: mv.from, to: mv.to };
  st.history.push({ color, text: res.san });
  fx.push({ k: 'moves', list, style: 'slide', capture: !!res.captured, promo: !!res.promotion });
  arrive(st, mv.to, color, fx);
}

function endTurn(st, actor, fx) {
  const m = MODES[st.mode];
  st.turns[actor]++;
  if (m.every && st.turns[actor] % m.every === 0) giveItem(st, actor, rollFor(st), fx, 'draw');
  sanitizeCastling(st);
  st.ply++;

  const opp = other(actor);
  if (st.status === 'playing' && st.extra[actor].length && !inCheck(st, opp)) {
    const kind = st.extra[actor].shift();
    st.bonus = { kind, exclude: kind === 'double' ? st.lastMove?.to : null };
    st.turn = actor;
    st.ep = '';
    fx.push({ k: 'bonus', color: actor, kind });
    expireMarks(st);
  } else {
    st.bonus = null;
    st.turn = opp;
    expireMarks(st);
    startTurn(st, fx);
  }
  checkEnd(st, fx);
}

function startTurn(st, fx) {
  const m = MODES[st.mode];
  if (m.crates && st.crates.length < 2 && Math.random() < 0.35) {
    const opts = ALL_SQUARES.filter(s => rankOf(s) >= 2 && rankOf(s) <= 5 && !st.board[s] && !hazard(st, s));
    const sq = pick(opts);
    if (sq) { st.crates.push(sq); fx.push({ k: 'crate', sq }); }
  }
  if (m.events && st.ply >= st.nextEvent) {
    runEvent(st, fx);
    st.nextEvent = st.ply + 5 + Math.floor(Math.random() * 4);
  }
  st.rewindSnap = st.turnSnap;
  st.turnSnap = snapshot(st);
}

function checkEnd(st, fx, depth = 0) {
  if (st.status !== 'playing') return;
  const c = st.turn;
  const moves = legalMoves(st, c);
  const check = inCheck(st, c);
  if (!moves.length) {
    if (check) return finish(st, other(c), 'checkmate', fx);
    if (rawMoves(st).length && depth < 2 && !inCheck(st, other(c))) {
      fx.push({ k: 'toast', text: `${c === 'w' ? 'White' : 'Black'} has no free pieces — turn skipped`, icon: 'snowflake' });
      st.turn = other(c); st.ep = ''; st.bonus = null; st.ply++;
      expireMarks(st);
      startTurn(st, fx);
      return checkEnd(st, fx, depth + 1);
    }
    return finish(st, null, 'stalemate', fx);
  }
  if (check) fx.push({ k: 'check', color: c, sq: kingSq(st.board, c) });
  if (st.half >= 100) return finish(st, null, '50-move rule', fx);
  if (insufficientMaterial(st) && !st.inv.w.length && !st.inv.b.length) return finish(st, null, 'insufficient material', fx);
  const key = `${placement(st.board)} ${st.turn} ${st.castling} ${st.ep}`;
  st.positions[key] = (st.positions[key] || 0) + 1;
  if (st.positions[key] >= 3) return finish(st, null, 'threefold repetition', fx);
}

function finish(st, winner, reason, fx) {
  st.status = 'over';
  st.result = { winner, reason };
  fx.push({ k: 'over', winner, reason });
}

/** Personalized copy of the state: hides the opponent's hand and mines. `color` null = spectator. */
export function viewFor(st, color, { reveal = false } = {}) {
  const v = structuredClone({ ...st, turnSnap: null, rewindSnap: null, positions: null });
  delete v.turnSnap; delete v.rewindSnap; delete v.positions;
  if (!reveal) {
    v.mines = st.mines.filter(m => m.owner === color);
    for (const c of ['w', 'b']) if (c !== color) v.inv[c] = st.inv[c].map(i => ({ id: i.id, kind: null }));
    if (color) v.extra[other(color)] = [];
  }
  v.canRewind = color ? canRewind(st, color) : false;
  return v;
}

/** Filter animation/effect events for a viewer (secret info gets the public version or is dropped). */
export function fxFor(fx, color) {
  const out = [];
  for (const f of fx) {
    if (f.only && f.only !== color) { if (f.pub) out.push(f.pub); continue; }
    const { pub, ...rest } = f;
    out.push(rest);
  }
  return out;
}

export function forfeit(st, loser, reason) {
  if (st.status !== 'playing') return [];
  const fx = [];
  finish(st, other(loser), reason, fx);
  st.seq++;
  return fx;
}
