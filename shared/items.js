// Custom abilities: power-ups, weapons and cards. Kept separate from standard chess rules.
//
// Each item defines:
//   step(st, c, picks) -> null when no more picks are needed, otherwise
//                         { prompt, targets: [square | choice value], choices?: [{ value, label }] }
//   apply(st, c, picks, fx) -> mutates the state
//   free: true if using it does NOT end your turn
// The server validates picks by replaying step() — the same function that drives UI highlights.
import {
  ALL_SQUARES, ORTHO, NAMES, VALUE, other, rankOf, offset, neighbors, pawnOk, safeAfter, pieceTargets, kingAttacked, sqName,
} from './rules.js';
import {
  POOLS, mark, shielded, frozen, relocate, relocateMany, destroy, arrive, hole, hazard, giveItem, restore, snapshot, pick, shuffled,
} from './state.js';

const own = (st, c, pred = () => true) =>
  Object.keys(st.board).filter(s => st.board[s][0] === c && pred(st.board[s], s));
const enemy = (st, c, pred = () => true) => own(st, other(c), pred);
const empty = st => ALL_SQUARES.filter(s => !st.board[s] && !hole(st, s));
const notKing = p => p[1] !== 'k';
const movable = st => (p, s) => notKing(p) && !frozen(st, s);
const hittable = st => (p, s) => notKing(p) && !shielded(st, s);
const step = (prompt, targets, choices) => ({ prompt, targets, choices });

function moveTargets(st, c, from, opts) {
  const p = st.board[from];
  return pieceTargets(st.board, from, p[1], opts.friend, opts.ghost)
    .filter(s => !hole(st, s))
    .filter(s => !st.board[s] || (st.board[s][1] !== 'k' && !shielded(st, s)))
    .filter(s => safeAfter(st.board, c, b => { b[s] = b[from]; delete b[from]; }));
}

/** Move a piece using a custom rule (ghost / mind control), capturing on the destination. */
function customMove(st, c, from, to, fx, style) {
  const captured = st.board[to];
  if (captured) { destroy(st, to); fx.push({ k: 'capture', sq: to }); }
  relocate(st, from, to);
  st.lastMove = { from, to };
  st.half = captured ? 0 : st.half + 1;
  fx.push({ k: 'moves', list: [[from, to]], style });
  arrive(st, to, c, fx);
}

function laserTargets(st, c, from) {
  const out = [];
  for (const [df, dr] of ORTHO) {
    let s = offset(from, df, dr);
    while (s && !st.board[s]) s = offset(s, df, dr);
    if (s && st.board[s][0] !== c && hittable(st)(st.board[s], s) && clearsSafely(st, c, [s])) out.push(s);
  }
  return out;
}
const shotgunTargets = (st, c, from) =>
  neighbors(from).filter(s => st.board[s] && st.board[s][0] !== c && hittable(st)(st.board[s], s) && st.board[s][1] !== 'q');
// Removing an enemy piece can open a line from another enemy piece to your king.
const clearsSafely = (st, c, sqs) => safeAfter(st.board, c, b => sqs.forEach(s => delete b[s]));

export function canRewind(st, c) {
  if (typeof st.canRewind === 'boolean') return st.canRewind; // client views carry a precomputed flag
  const s = st.rewindSnap;
  return !!s && s.turn === other(c) && !kingAttacked(s.board, other(c));
}

export const ITEMS = {
  // ---------------------------------------------------------------- power-ups
  teleport: {
    cat: 'power', name: 'Teleport', icon: 'sparkles', desc: 'Blink one of your pieces to any empty square.',
    step(st, c, picks) {
      if (!picks.length) return step('Pick a piece to teleport', own(st, c, movable(st)));
      if (picks.length === 1) {
        const from = picks[0], p = st.board[from];
        return step('Pick an empty square', empty(st).filter(s => pawnOk(p, s) && safeAfter(st.board, c, b => { b[s] = b[from]; delete b[from]; })));
      }
      return null;
    },
    apply(st, c, [from, to], fx) {
      relocate(st, from, to);
      st.lastMove = { from, to };
      fx.push({ k: 'moves', list: [[from, to]], style: 'blink' });
      arrive(st, to, c, fx);
    },
  },
  shield: {
    cat: 'power', name: 'Shield', icon: 'shield', free: true, desc: 'Protect a piece from capture for 2 enemy turns. Free action.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a piece to shield', own(st, c, (p, s) => notKing(p) && !shielded(st, s)))),
    apply(st, c, [sq], fx) { mark(st, sq).shield = st.ply + 4; fx.push({ k: 'aura', sqs: [sq], kind: 'shield' }); },
  },
  rewind: {
    cat: 'power', name: 'Time Rewind', icon: 'rewind', free: true, desc: "Undo your opponent's last turn. Then it's your move.",
    available: canRewind,
    step: () => null,
    apply(st, c, _p, fx) {
      restore(st, st.rewindSnap);
      st.turn = c; st.ep = '';
      st.turnSnap = snapshot(st);
      st.rewindSnap = null;
      fx.push({ k: 'rewind' });
    },
  },
  clone: {
    cat: 'power', name: 'Clone', icon: 'copy', desc: 'Duplicate a pawn, knight, bishop or rook onto an adjacent square.',
    step(st, c, picks) {
      const spots = from => neighbors(from).filter(s => !st.board[s] && !hole(st, s) && pawnOk(st.board[from], s));
      if (!picks.length) return step('Pick a piece to clone', own(st, c, (p, s) => 'pnbr'.includes(p[1]) && !frozen(st, s) && spots(s).length));
      if (picks.length === 1) return step('Pick where the clone appears', spots(picks[0]));
      return null;
    },
    apply(st, c, [from, to], fx) {
      st.board[to] = st.board[from];
      fx.push({ k: 'aura', sqs: [from, to], kind: 'clone' });
      arrive(st, to, c, fx);
    },
  },
  mind: {
    cat: 'power', name: 'Mind Control', icon: 'brain', desc: 'Move one enemy knight, bishop or rook this turn. It can attack its own team.',
    step(st, c, picks) {
      const dests = from => moveTargets(st, c, from, { friend: c });
      if (!picks.length) return step('Pick an enemy piece to control', enemy(st, c, (p, s) => 'nbr'.includes(p[1]) && dests(s).length));
      if (picks.length === 1) return step('Move the controlled piece', dests(picks[0]));
      return null;
    },
    apply(st, c, [from, to], fx) { fx.push({ k: 'aura', sqs: [from], kind: 'mind' }); customMove(st, c, from, to, fx, 'slide'); },
  },
  swap: {
    cat: 'power', name: 'Swap', icon: 'arrow-left-right', desc: 'Exchange the positions of one of your pieces and any other piece.',
    step(st, c, picks) {
      if (!picks.length) return step('Pick one of your pieces', own(st, c, movable(st)));
      if (picks.length === 1) {
        const a = picks[0], pa = st.board[a];
        return step('Pick a piece to swap with', Object.keys(st.board).filter(b => {
          const pb = st.board[b];
          if (b === a || pb[1] === 'k' || pb === pa) return false;
          if (pb[0] !== c && shielded(st, b)) return false;
          if (pb[0] === c && frozen(st, b)) return false;
          return pawnOk(pa, b) && pawnOk(pb, a) && safeAfter(st.board, c, x => { x[a] = pb; x[b] = pa; });
        }));
      }
      return null;
    },
    apply(st, c, [a, b], fx) {
      relocateMany(st, [[a, b], [b, a]]);
      fx.push({ k: 'moves', list: [[a, b], [b, a]], style: 'blink' }); // vanish into smoke, reappear swapped
    },
  },
  ghost: {
    cat: 'power', name: 'Ghost', icon: 'ghost', desc: 'A bishop, rook or queen moves straight through other pieces.',
    step(st, c, picks) {
      const dests = from => moveTargets(st, c, from, { friend: c, ghost: true });
      if (!picks.length) return step('Pick a bishop, rook or queen', own(st, c, (p, s) => 'brq'.includes(p[1]) && !frozen(st, s) && dests(s).length));
      if (picks.length === 1) return step('Phase through to…', dests(picks[0]));
      return null;
    },
    apply(st, c, [from, to], fx) { customMove(st, c, from, to, fx, 'ghost'); },
  },
  freeze: {
    cat: 'power', name: 'Freeze', icon: 'snowflake', free: true, desc: "An enemy piece can't move for its next 2 turns. Free action.",
    step: (st, c, picks) => (picks.length ? null : step('Pick an enemy piece to freeze', enemy(st, c, (p, s) => hittable(st)(p, s) && !frozen(st, s)))),
    apply(st, c, [sq], fx) { mark(st, sq).frozen = st.ply + 4; fx.push({ k: 'aura', sqs: [sq], kind: 'freeze' }); },
  },
  resurrect: {
    cat: 'power', name: 'Resurrection', icon: 'heart-pulse', desc: 'Bring back one of your captured pieces near your back rank.',
    step(st, c, picks) {
      if (!picks.length) {
        const types = [...new Set(st.captured[c])].filter(t => t !== 'k');
        return step('Pick a piece to revive', types, types.map(t => ({ value: t, label: NAMES[t] })));
      }
      if (picks.length === 1) {
        const t = picks[0], home = c === 'w' ? [0, 1] : [7, 6];
        const pawnRank = c === 'w' ? 1 : 6;
        return step('Pick a square on your side', empty(st).filter(s => (t === 'p' ? rankOf(s) === pawnRank : home.includes(rankOf(s))) && !hazard(st, s)));
      }
      return null;
    },
    apply(st, c, [t, sq], fx) {
      st.captured[c].splice(st.captured[c].indexOf(t), 1);
      st.board[sq] = c + t;
      fx.push({ k: 'aura', sqs: [sq], kind: 'revive' });
    },
  },
  evolve: {
    cat: 'power', name: 'Evolution', icon: 'chevrons-up', desc: 'Upgrade a pawn into a knight, bishop or rook.',
    step(st, c, picks) {
      if (!picks.length) return step('Pick a pawn to evolve', own(st, c, (p, s) => p[1] === 'p' && !frozen(st, s)));
      if (picks.length === 1) return step('Evolve into…', ['n', 'b', 'r'], ['n', 'b', 'r'].map(t => ({ value: t, label: NAMES[t] })));
      return null;
    },
    apply(st, c, [sq, t], fx) { st.board[sq] = c + t; fx.push({ k: 'aura', sqs: [sq], kind: 'evolve' }); },
  },

  // ------------------------------------------------------------------ weapons
  laser: {
    cat: 'weapon', name: 'Laser', icon: 'zap', desc: 'Fire a beam from one of your pieces. Destroys the first enemy in a straight line.',
    step(st, c, picks) {
      if (!picks.length) return step('Pick a piece to fire from', own(st, c, (p, s) => movable(st)(p, s) && laserTargets(st, c, s).length));
      if (picks.length === 1) return step('Pick a target', laserTargets(st, c, picks[0]));
      return null;
    },
    apply(st, c, [from, to], fx) { destroy(st, to); fx.push({ k: 'laser', from, to }, { k: 'boom', sqs: [to], kind: 'laser' }); },
  },
  rocket: {
    cat: 'weapon', name: 'Rocket', icon: 'rocket', desc: 'Blast any enemy piece except the king or queen.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a target', enemy(st, c, (p, s) => hittable(st)(p, s) && p[1] !== 'q' && clearsSafely(st, c, [s])))),
    apply(st, c, [sq], fx) { destroy(st, sq); fx.push({ k: 'rocket', to: sq, color: c }, { k: 'boom', sqs: [sq], kind: 'rocket' }); },
  },
  mine: {
    cat: 'weapon', name: 'Landmine', icon: 'bomb', free: true, desc: 'Hide a trap on an empty square in the middle of the board. Free action.',
    step: (st, c, picks) => (picks.length ? null : step('Hide a mine (your opponent won’t see it)',
      empty(st).filter(s => rankOf(s) >= 2 && rankOf(s) <= 5 && !hazard(st, s) && !st.mines.some(m => m.sq === s && m.owner === c)))),
    apply(st, c, [sq], fx) { st.mines.push({ sq, owner: c }); fx.push({ k: 'aura', sqs: [sq], kind: 'mine', only: c }); },
    secret: true,
  },
  emp: {
    cat: 'weapon', name: 'EMP', icon: 'radio', desc: 'Pulse a 3×3 area: enemy pieces there are stunned and lose shields, mines are wiped, and your opponent can’t use items next turn.',
    step: (st, c, picks) => (picks.length ? null : step('Pick the pulse center', ALL_SQUARES)),
    apply(st, c, [sq], fx) {
      const area = [sq, ...neighbors(sq)];
      for (const s of area) {
        const p = st.board[s];
        if (p && p[0] !== c && p[1] !== 'k') { const m = mark(st, s); delete m.shield; m.frozen = Math.max(m.frozen || 0, st.ply + 2); }
      }
      st.mines = st.mines.filter(m => m.owner === c || !area.includes(m.sq));
      st.jam[other(c)] = st.ply + 2;
      fx.push({ k: 'emp', sq, sqs: area });
    },
  },
  shotgun: {
    cat: 'weapon', name: 'Shotgun', icon: 'crosshair', desc: 'Blast every adjacent enemy pawn, knight, bishop or rook around one of your pieces.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a piece to fire from', own(st, c, (p, s) => movable(st)(p, s) && shotgunTargets(st, c, s).length && clearsSafely(st, c, shotgunTargets(st, c, s))))),
    apply(st, c, [from], fx) {
      const hits = shotgunTargets(st, c, from);
      hits.forEach(s => destroy(st, s));
      fx.push({ k: 'boom', sqs: hits, kind: 'shotgun', from });
    },
  },

  // -------------------------------------------------------------------- cards
  reverse: {
    cat: 'card', name: 'Reverse', icon: 'repeat', free: true, desc: 'Flip the turn order: you play twice in a row, then your opponent does.',
    step: () => null,
    apply(st, c, _p, fx) { st.extra[c].push('reverse'); st.extra[other(c)].push('reverse'); fx.push({ k: 'aura', kind: 'reverse', sqs: [] }); },
  },
  skip: {
    cat: 'card', name: 'Skip', icon: 'skip-forward', free: true, desc: "Your opponent skips their next turn. (Not if you give check.)",
    step: () => null,
    apply(st, c, _p, fx) { st.extra[c].push('skip'); fx.push({ k: 'aura', kind: 'skip', sqs: [] }); },
  },
  double: {
    cat: 'card', name: 'Double Move', icon: 'fast-forward', free: true, desc: 'Make two moves this turn with two different pieces.',
    step: () => null,
    apply(st, c, _p, fx) { st.extra[c].push('double'); fx.push({ k: 'aura', kind: 'double', sqs: [] }); },
  },
  shuffle: {
    cat: 'card', name: 'Shuffle', icon: 'shuffle', desc: 'Scramble every pawn to a random square on its rank. Not while in check.',
    available: (st, c) => !kingAttacked(st.board, c),
    step: () => null,
    apply(st, c, _p, fx, rnd = Math.random) {
      const pawns = Object.keys(st.board).filter(s => st.board[s][1] === 'p');
      for (let attempt = 0; attempt < 30; attempt++) {
        const b = { ...st.board };
        pawns.forEach(s => delete b[s]);
        const pairs = [];
        for (const s of shuffled(pawns, rnd)) {
          const free = [0, 1, 2, 3, 4, 5, 6, 7].map(f => sqName(f, rankOf(s))).filter(t => !b[t] && !hazard(st, t));
          const t = pick(free, rnd);
          b[t] = st.board[s];
          pairs.push([s, t]);
        }
        if (!kingAttacked(b, c) && !kingAttacked(b, other(c))) {
          relocateMany(st, pairs);
          fx.push({ k: 'moves', list: pairs.filter(([a, t]) => a !== t), style: 'arc' });
          return;
        }
      }
      fx.push({ k: 'toast', text: 'The shuffle fizzled — no safe arrangement.' });
    },
  },
  steal: {
    cat: 'card', name: 'Steal', icon: 'hand', desc: 'Convert an enemy knight, bishop, or a pawn in the middle ranks, to your side.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a piece to steal', enemy(st, c, (p, s) =>
      hittable(st)(p, s) && ('nb'.includes(p[1]) || (p[1] === 'p' && rankOf(s) >= 2 && rankOf(s) <= 5))))),
    apply(st, c, [sq], fx) {
      st.board[sq] = c + st.board[sq][1];
      delete st.marks[sq];
      fx.push({ k: 'aura', sqs: [sq], kind: 'steal' });
    },
  },
  mimic: {
    cat: 'card', name: 'Mimic', icon: 'drama', free: true, desc: "Copy a random item from your opponent's hand.",
    available: (st, c) => st.inv[other(c)].length > 0,
    step: () => null,
    apply(st, c, _p, fx, rnd = Math.random) {
      const it = pick(st.inv[other(c)], rnd);
      giveItem(st, c, it.kind, fx, 'mimic');
    },
  },
  wildcard: {
    cat: 'card', name: 'Wildcard', icon: 'dices', free: true, desc: 'Turn into any power-up of your choice.',
    step(st, c, picks) {
      if (picks.length) return null;
      const opts = Object.keys(POOLS.power);
      return step('Choose a power-up', opts, opts.map(k => ({ value: k, label: ITEMS[k].name })));
    },
    apply(st, c, [kind], fx) { giveItem(st, c, kind, fx, 'wildcard'); },
  },
};

/** A turn-ending item must never leave your own king in check: simulate it on a copy. */
// When you're not in check, items can't expose your king without noticing: the ones that move or
// remove pieces (teleport, swap, ghost, mind control, laser, rocket, shotgun, shuffle, hazards)
// check that themselves, and the rest only add pieces or recolor one in place.
function simulateSafe(st, c, kind, picks) {
  const def = ITEMS[kind];
  if (def.free || !kingAttacked(st.board, c)) return true;
  const { history, positions, turnSnap, rewindSnap, ...rest } = st;
  const scratch = structuredClone(rest);
  def.apply(scratch, c, picks, []);
  return !kingAttacked(scratch.board, c);
}
function completable(st, c, kind, picks) {
  const s = ITEMS[kind].step(st, c, picks);
  if (!s) return simulateSafe(st, c, kind, picks);
  return s.targets.some(t => completable(st, c, kind, [...picks, t]));
}

/** Valid targets for the next pick (only ones that lead to a legal outcome), or null when complete. */
export function itemStep(st, c, kind, picks = []) {
  const s = ITEMS[kind].step(st, c, picks);
  if (!s) return null;
  const targets = s.targets.filter(t => completable(st, c, kind, [...picks, t]));
  return { ...s, targets, choices: s.choices?.filter(ch => targets.includes(ch.value)) };
}

export function itemUsable(st, c, kind) {
  const it = ITEMS[kind];
  if (it.available && !it.available(st, c)) return false;
  const s = itemStep(st, c, kind, []);
  return s ? s.targets.length > 0 : simulateSafe(st, c, kind, []);
}

/** Replays step() to make sure every pick was a legal option. Throws otherwise. */
export function validatePicks(st, c, kind, picks) {
  if (!Array.isArray(picks) || picks.length > 3) throw new Error('Bad picks');
  for (let i = 0; i <= picks.length; i++) {
    const s = itemStep(st, c, kind, picks.slice(0, i));
    if (i === picks.length) { if (s) throw new Error('More targets needed'); return; }
    if (!s || !s.targets.includes(picks[i])) throw new Error('Invalid target');
  }
}

export { VALUE };
