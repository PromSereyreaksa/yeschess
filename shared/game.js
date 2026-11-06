// Game loop: authoritative state transitions shared by the server and local games.
import {
  START_FEN, readFen, chessFor, rawMoves, inCheck, kingSq, other, placement, sanitizeCastling, insufficientMaterial, ALL_SQUARES, rankOf, fileOf,
  isAttacked, pieceTargets, safeAfter,
} from './rules.js';
import {
  MODES, shielded, frozen, isFake, isDisguised, hideMap, relocate, destroy, arrive, expireMarks, giveItem, rollFor, snapshot, hazard, pick,
} from './state.js';
import { ITEMS, itemUsable, validatePicks, canRewind, fusionOf, rollFusion } from './items.js';
import { runEvent } from './events.js';
import { initQuests, questTick, questRefresh } from './quests.js';

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
  if (m.pool) initQuests(st);
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
    if (victim && isFake(st, m.from)) return false; // an imposter can't capture
    return !(victim && shielded(st, victim));
  });
}

export function itemAllowed(st, color) {
  if (st.status !== 'playing' || st.turn !== color) return 'Not your turn';
  if (st.jam[color] > st.ply) return 'Jammed by an EMP this turn';
  if (st.bonus?.kind === 'double') return 'Double Move: moves only';
  return null;
}

/**
 * Apply one action. If it's rejected only because the opponent has a disguised queen the player
 * can't see (they walked into its line, tried to steal "a pawn"…), the disguise is revealed instead.
 */
export function applyAction(st, color, a) {
  const hidden = Object.keys(st.marks).filter(s => isDisguised(st, s) && st.board[s][0] === other(color));
  if (!hidden.length || !['move', 'item'].includes(a?.type)) return applyInner(st, color, a);
  const trial = structuredClone(st);
  try {
    const fx = applyInner(trial, color, a);
    for (const k of Object.keys(st)) delete st[k];
    Object.assign(st, trial);
    return fx;
  } catch (err) {
    if (st.status !== 'playing' || st.turn !== color) throw err;
    const probe = structuredClone(st);
    hidden.forEach(sq => { probe.board[sq] = other(color) + 'p'; delete probe.marks[sq].disguise; });
    try { applyInner(probe, color, a); } catch { throw err; }
    hidden.forEach(sq => delete st.marks[sq].disguise);
    st.seq++;
    return [{ k: 'reveal', sqs: hidden, blocked: true }];
  }
}

function applyInner(st, color, a) {
  const fx = [];
  if (!a || typeof a !== 'object') throw new Error('Bad action');
  if (st.status !== 'playing') throw new Error('The game is over');

  if (a.type === 'resign') {
    finish(st, other(color), 'resignation', fx);
    st.seq++;
    return fx;
  }
  if (st.turn !== color) throw new Error('Not your turn');

  if (a.type === 'discard') {
    const idx = st.inv[color].findIndex(i => i.id === a.id);
    if (idx < 0) throw new Error('You don’t have that item');
    const [it] = st.inv[color].splice(idx, 1);
    fx.push({ k: 'discard', color, kind: it.kind, only: color, pub: { k: 'discard', color, kind: null } });
    st.seq++;
    return fx;
  }
  if (a.type === 'fuse') {
    const ids = Array.isArray(a.ids) ? a.ids : [];
    if (ids.length !== 2 || ids[0] === ids[1]) throw new Error('Pick two different items');
    const pair = ids.map(id => st.inv[color].find(i => i.id === id));
    if (pair.some(i => !i)) throw new Error('You don’t have that item');
    if (!fusionOf(pair[0].kind, pair[1].kind)) throw new Error('Those can’t be fused');
    const result = rollFusion(pair[0].kind, pair[1].kind);
    st.inv[color] = st.inv[color].filter(i => !ids.includes(i.id));
    fx.push({ k: 'fuse', color, a: pair[0].kind, b: pair[1].kind, result, only: color, pub: { k: 'fuse', color, a: null, b: null, result: null } });
    giveItem(st, color, result, fx, 'fuse', true);
    st.seq++;
    return fx;
  }

  if (a.type === 'move') {
    const mv = legalMoves(st, color).find(m => m.from === a.from && m.to === a.to && (!m.promotion || m.promotion === (a.promotion || 'q')));
    if (!mv) throw new Error('Illegal move');
    standardMove(st, color, mv, fx);
    captureQuests(st, fx);
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
    fx.push({ k: 'item', color, kind, sqs: shown, before: { ...st.board }, hide: hideMap(st) }); // board before the item, for client sequencing
    def.apply(st, color, picks, fx);
    st.history.push({ color, text: def.name, item: kind });
    questTick(st, color, { item: true }, fx);
    captureQuests(st, fx);
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
  if (st._popped?.length) fx.push({ k: 'imposter', sqs: st._popped });
  for (const c of new Set(st._wallReset || [])) fx.push({ k: 'quest', color: c, kind: 'wall', n: 0, goal: st.quests[c].goal, reset: true });
  delete st._wallReset;
  if (st._revealed?.length) fx.push({ k: 'reveal', sqs: st._revealed, gone: true });
  delete st._popped; delete st._revealed;
  st.seq++;
  return fx;
}

/** Captures made by a piece count toward quests (weapons don't). */
function captureQuests(st, fx) {
  for (const f of fx) if (f.k === 'capture' && f.by && !f.counted) { f.counted = true; questTick(st, f.color, { capture: f.by }, fx); }
}

/** Would a pawn of `color` be able to make this move? (keeps a disguise intact) */
function pawnLike(mv, color, captured) {
  const fwd = color === 'w' ? 1 : -1;
  const df = fileOf(mv.to) - fileOf(mv.from), dr = (rankOf(mv.to) - rankOf(mv.from)) * fwd;
  if (rankOf(mv.to) === 0 || rankOf(mv.to) === 7) return false;
  if (captured) return Math.abs(df) === 1 && dr === 1;
  return df === 0 && (dr === 1 || (dr === 2 && rankOf(mv.from) === (color === 'w' ? 1 : 6)));
}

/**
 * Hidden pieces can't fake their way out of the rules:
 *  - an imposter (fake queen) that "checks" the king just pops,
 *  - a disguised queen that gives check, or can no longer pass as a pawn, is revealed.
 */
function unmask(st, fx) {
  const out = [];
  for (const [sq, m] of Object.entries(st.marks)) {
    if (!m.disguise) continue;
    if (st.board[sq]?.[1] !== 'q') { delete m.disguise; continue; }
    if (rankOf(sq) === 0 || rankOf(sq) === 7) out.push(sq);
  }
  const c = st.turn, a = other(c), k = kingSq(st.board, c);
  if (k && isAttacked(st.board, k, a)) {
    for (const sq of Object.keys(st.board)) {
      const m = st.marks[sq];
      if (st.board[sq] !== a + 'q' || !(m?.fake || m?.disguise)) continue;
      if (!pieceTargets(st.board, sq, 'q', a).includes(k)) continue;
      if (m.disguise) { if (!out.includes(sq)) out.push(sq); continue; }
      if (safeAfter(st.board, a, b => { delete b[sq]; })) { delete st.board[sq]; delete st.marks[sq]; (st._popped ||= []).push(sq); }
    }
  }
  out.forEach(sq => delete st.marks[sq].disguise);
  if (out.length) fx.push({ k: 'reveal', sqs: out });
}

/** Imposters fade after their time is up (never if that would expose their own king). */
function fadeFakes(st) {
  for (const [sq, m] of Object.entries(st.marks)) {
    if (!m.fake || m.fake > st.ply || !st.board[sq]) continue;
    const owner = st.board[sq][0];
    if (!safeAfter(st.board, owner, b => { delete b[sq]; })) continue;
    delete st.board[sq]; delete st.marks[sq];
    (st._popped ||= []).push(sq);
  }
}

function standardMove(st, color, mv, fx) {
  const c = chessFor(st);
  const disguised = isDisguised(st, mv.from);
  const res = c.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  const sneaky = disguised && pawnLike(mv, color, !!res.captured);
  const by = sneaky ? 'p' : res.piece;
  const list = [[mv.from, mv.to]];
  if (res.flags.includes('e')) {
    const victim = mv.to[0] + mv.from[1];
    destroy(st, victim);
    fx.push({ k: 'capture', sq: victim, by, color });
  } else if (res.captured) {
    destroy(st, mv.to);
    fx.push({ k: 'capture', sq: mv.to, by, color });
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
  st.history.push({ color, text: sneaky ? (res.captured ? `${mv.from[0]}x${mv.to}` : mv.to) : res.san });
  fx.push({ k: 'moves', list, style: 'slide', capture: !!res.captured, promo: !!res.promotion });
  if (disguised && !sneaky && st.marks[mv.to]?.disguise) { delete st.marks[mv.to].disguise; fx.push({ k: 'reveal', sqs: [mv.to] }); }
  arrive(st, mv.to, color, fx);
}

function endTurn(st, actor, fx) {
  const m = MODES[st.mode];
  st.turns[actor]++;
  if (m.every && st.turns[actor] % m.every === 0) giveItem(st, actor, rollFor(st), fx, 'draw');
  questTick(st, actor, { turn: true }, fx);
  for (const c of ['w', 'b']) questRefresh(st, c, fx); // either side may have lost the pieces its quest needs
  sanitizeCastling(st);
  st.ply++;
  fadeFakes(st);

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
  unmask(st, fx);
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
  if (check) { fx.push({ k: 'check', color: c, sq: kingSq(st.board, c) }); questTick(st, other(c), { check: true }, fx); }
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
    // only the owner knows which queen is an imposter, and which "pawn" is really a queen
    for (const [sq, m] of Object.entries(st.marks)) {
      const p = st.board[sq];
      if (!p || p[0] === color) continue;
      if (m.disguise && p[1] === 'q') { v.board[sq] = p[0] + 'p'; delete v.marks[sq].disguise; }
      if (m.fake) delete v.marks[sq].fake;
      if (!Object.keys(v.marks[sq]).length) delete v.marks[sq];
    }
  }
  v.canRewind = color ? canRewind(st, color) : false;
  return v;
}

/** Filter animation/effect events for a viewer (secret info gets the public version or is dropped). */
export function fxFor(fx, color) {
  const out = [];
  for (const f of fx) {
    if (f.only && f.only !== color) { if (f.pub) out.push(f.pub); continue; }
    const { pub, hide, counted, ...rest } = f;
    if (rest.before && hide) {
      const b = { ...rest.before };
      for (const [sq, owner] of Object.entries(hide)) if (owner !== color && b[sq]) b[sq] = owner + 'p';
      rest.before = b;
    }
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
