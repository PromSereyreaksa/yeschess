// Custom abilities: power-ups, weapons and cards. Kept separate from standard chess rules.
//
// Each item defines:
//   step(st, c, picks) -> null when no more picks are needed, otherwise
//                         { prompt, targets: [square | choice value], choices?: [{ value, label }] }
//   apply(st, c, picks, fx) -> mutates the state
//   free: true if using it does NOT end your turn
// The server validates picks by replaying step() — the same function that drives UI highlights.
import {
  ALL_SQUARES, ORTHO, NAMES, VALUE, other, rankOf, fileOf, offset, neighbors, pawnOk, safeAfter, pieceTargets, kingAttacked, sqName,
} from './rules.js';
import {
  POOLS, mark, shielded, frozen, isFake, isDisguised, relocate, relocateMany, destroy, arrive, hole, hazard, giveItem, restore, snapshot, pick, shuffled,
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
    .filter(s => !st.board[s] || !isFake(st, from))
    .filter(s => !st.board[s] || (st.board[s][1] !== 'k' && !shielded(st, s)))
    .filter(s => safeAfter(st.board, c, b => { b[s] = b[from]; delete b[from]; }));
}

/** Move a piece using a custom rule (ghost / mind control), capturing on the destination. */
function customMove(st, c, from, to, fx, style) {
  const captured = st.board[to];
  if (captured) { const by = st.board[from][1]; destroy(st, to); fx.push({ k: 'capture', sq: to, by, color: c }); }
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
/** A disguised queen just did something no pawn could: everyone sees it now. */
export function revealAt(st, sqs, fx) {
  const out = sqs.filter(s => isDisguised(st, s));
  out.forEach(s => delete st.marks[s].disguise);
  if (out.length) fx.push({ k: 'reveal', sqs: out });
  return out.length > 0;
}
const enemyDisguisedIn = (st, c, sqs) => sqs.filter(s => st.board[s]?.[0] === other(c) && isDisguised(st, s));
const realPiece = st => (p, s) => !isFake(st, s);

const slashArea = (c, from) => [-1, 0, 1].map(df => offset(from, df, c === 'w' ? 1 : -1)).filter(Boolean);
const slashHits = (st, c, from) => slashArea(c, from).filter(s => st.board[s] && st.board[s][0] !== c && 'pnb'.includes(st.board[s][1]) && !shielded(st, s));
const area3 = sq => [sq, ...neighbors(sq)];
const orbitalHits = (st, c, sq) => area3(sq).filter(s => st.board[s] && st.board[s][0] !== c && hittable(st)(st.board[s], s) && st.board[s][1] !== 'q');
const zeroHits = (st, c, sq) => area3(sq).filter(s => st.board[s] && st.board[s][0] !== c && st.board[s][1] !== 'k');
const stormTargets = (st, c) => enemy(st, c, (p, s) => hittable(st)(p, s) && p[1] !== 'q');
function beamDirs(st, c, from) {
  const out = [];
  for (const [df, dr] of ORTHO) {
    const first = offset(from, df, dr);
    if (!first) continue;
    const hits = [];
    let s = first, end = first;
    while (s) { end = s; const p = st.board[s]; if (p && p[0] !== c && hittable(st)(p, s)) hits.push(s); s = offset(s, df, dr); }
    if (hits.length && clearsSafely(st, c, hits)) out.push({ first, end, hits });
  }
  return out;
}
/** Shadow Army: the two strongest captured pieces and where they rise. */
function armyPlan(st, c) {
  const types = st.captured[c].filter(t => t !== 'k').sort((a, b) => VALUE[b] - VALUE[a]).slice(0, 2);
  const used = new Set(), out = [];
  const byCenter = (a, b) => Math.abs(fileOf(a) - 3.5) - Math.abs(fileOf(b) - 3.5);
  for (const t of types) {
    const ranks = t === 'p' ? [c === 'w' ? 1 : 6] : c === 'w' ? [0, 1] : [7, 6];
    const sq = ranks.flatMap(r => ALL_SQUARES.filter(x => rankOf(x) === r && !st.board[x] && !hazard(st, x) && !used.has(x)).sort(byCenter))[0];
    if (!sq) continue;
    used.add(sq);
    out.push([t, sq]);
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
    apply(st, c, [from, to], fx) { revealAt(st, [from], fx); customMove(st, c, from, to, fx, 'ghost'); },
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
      if (!picks.length) return step('Pick a piece to fire from', own(st, c, (p, s) => movable(st)(p, s) && realPiece(st)(p, s) && laserTargets(st, c, s).length));
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
    step: (st, c, picks) => (picks.length ? null : step('Pick a piece to fire from', own(st, c, (p, s) => movable(st)(p, s) && realPiece(st)(p, s) && shotgunTargets(st, c, s).length && clearsSafely(st, c, shotgunTargets(st, c, s))))),
    apply(st, c, [from], fx) {
      revealAt(st, enemyDisguisedIn(st, c, neighbors(from)), fx); // a "pawn" that shrugs off buckshot is no pawn
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
      revealAt(st, Object.keys(st.board), fx);
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

  // ----------------------------------------------------------- new weapons
  thunder: {
    cat: 'weapon', name: 'Thunder', icon: 'cloud-lightning', desc: 'Lightning strikes an enemy piece (not the king or queen). It’s destroyed and the enemies next to it are stunned for a turn.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a target', enemy(st, c, (p, s) => hittable(st)(p, s) && p[1] !== 'q' && clearsSafely(st, c, [s])))),
    apply(st, c, [sq], fx) {
      destroy(st, sq);
      const stunned = neighbors(sq).filter(s => st.board[s] && st.board[s][0] !== c && st.board[s][1] !== 'k');
      stunned.forEach(s => { const m = mark(st, s); delete m.shield; m.frozen = Math.max(m.frozen || 0, st.ply + 2); });
      fx.push({ k: 'thunder', sq, sqs: stunned }, { k: 'boom', sqs: [sq], kind: 'thunder' });
    },
  },
  slash: {
    cat: 'weapon', name: 'Crescent Slash', icon: 'sword', desc: 'One of your pieces slashes the 3 squares in front of it. Enemy pawns, knights and bishops there are cut down.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a piece to slash with', own(st, c, (p, s) => movable(st)(p, s) && realPiece(st)(p, s) && slashHits(st, c, s).length && clearsSafely(st, c, slashHits(st, c, s))))),
    apply(st, c, [from], fx) {
      const area = slashArea(c, from);
      revealAt(st, enemyDisguisedIn(st, c, area), fx);
      const hits = slashHits(st, c, from);
      hits.forEach(s => destroy(st, s));
      fx.push({ k: 'slash', from, sqs: hits, area }, { k: 'boom', sqs: hits, kind: 'slash' });
    },
  },

  // ------------------------------------------------------------- new cards
  imposter: {
    cat: 'card', name: 'Imposter', icon: 'venetian-mask', desc: 'A fake copy of your queen appears next to her and they shuffle places. Your opponent can’t tell which is real. The fake can’t capture and fades after 6 turns.',
    step(st, c, picks) {
      const spots = q => neighbors(q).filter(s => !st.board[s] && !hazard(st, s) && safeAfter(st.board, c, b => { b[s] = b[q]; delete b[q]; }));
      if (!picks.length) return step('Pick your queen', own(st, c, (p, s) => p[1] === 'q' && !isFake(st, s) && !isDisguised(st, s) && !frozen(st, s) && spots(s).length));
      if (picks.length === 1) return step('Where does the imposter appear?', spots(picks[0]));
      return null;
    },
    apply(st, c, [q, t], fx, rnd = Math.random) {
      // 50/50 the real queen slips onto the new square, so neither square gives it away
      const fakeAt = rnd() < 0.5 ? q : t;
      if (fakeAt === q) relocate(st, q, t);
      st.board[fakeAt] = c + 'q';
      st.marks[fakeAt] = { fake: st.ply + 12 };
      fx.push({ k: 'imposter-in', sqs: [q, t] });
    },
  },
  disguise: {
    cat: 'card', name: 'Disguise', icon: 'eye', free: true, secret: true,
    secretDesc: 'One of their pawns is secretly a queen now… but which one?',
    desc: 'Secretly turn one of your pawns into a queen. Your opponent still sees a pawn until it moves like a queen, gives check or blocks them. Free action.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a pawn to disguise (your opponent won’t see it)', own(st, c, (p, s) => p[1] === 'p' && !frozen(st, s) && safeAfter(st.board, other(c), b => { b[s] = c + 'q'; })))),
    apply(st, c, [sq], fx) {
      st.board[sq] = c + 'q';
      mark(st, sq).disguise = true;
      fx.push({ k: 'aura', sqs: [sq], kind: 'disguise', only: c });
    },
  },

  // ------------------------------------------------- legendaries (fusion and quest rewards only)
  hyperbeam: {
    cat: 'weapon', legendary: true, name: 'Hyper Beam', icon: 'zap', desc: 'A giant beam fires from one of your pieces to the edge of the board, destroying every enemy in its path except the king.',
    step(st, c, picks) {
      if (!picks.length) return step('Pick a piece to fire from', own(st, c, (p, s) => movable(st)(p, s) && realPiece(st)(p, s) && beamDirs(st, c, s).length));
      if (picks.length === 1) return step('Pick a direction', beamDirs(st, c, picks[0]).map(d => d.first));
      return null;
    },
    apply(st, c, [from, first], fx) {
      const d = beamDirs(st, c, from).find(x => x.first === first);
      d.hits.forEach(s => destroy(st, s));
      fx.push({ k: 'hyperbeam', from, to: d.end, sqs: d.hits }, { k: 'boom', sqs: d.hits, kind: 'hyperbeam' });
    },
  },
  orbital: {
    cat: 'weapon', legendary: true, name: 'Orbital Strike', icon: 'satellite', desc: 'A strike from space hits a 3×3 area. Every enemy there is destroyed, except the king and queen.',
    step: (st, c, picks) => (picks.length ? null : step('Pick the center of the strike', ALL_SQUARES.filter(s => { const h = orbitalHits(st, c, s); return h.length && clearsSafely(st, c, h); }))),
    apply(st, c, [sq], fx) {
      revealAt(st, enemyDisguisedIn(st, c, area3(sq)), fx);
      const hits = orbitalHits(st, c, sq);
      hits.forEach(s => destroy(st, s));
      fx.push({ k: 'orbital', sq, sqs: hits, area: area3(sq) }, { k: 'boom', sqs: hits, kind: 'orbital' });
    },
  },
  zero: {
    cat: 'weapon', legendary: true, name: 'Absolute Zero', icon: 'snowflake', desc: 'Every enemy piece in a 3×3 area is frozen solid for their next 3 turns. Shields shatter.',
    step: (st, c, picks) => (picks.length ? null : step('Pick the center', ALL_SQUARES.filter(s => zeroHits(st, c, s).length))),
    apply(st, c, [sq], fx) {
      const hits = zeroHits(st, c, sq);
      hits.forEach(s => { const m = mark(st, s); delete m.shield; m.frozen = Math.max(m.frozen || 0, st.ply + 6); });
      fx.push({ k: 'zero', sq, sqs: hits, area: area3(sq) });
    },
  },
  storm: {
    cat: 'weapon', legendary: true, name: 'Thunder God', icon: 'cloud-lightning', desc: 'Lightning rains down on up to 3 random enemy pieces (never the king or queen).',
    available: (st, c) => !kingAttacked(st.board, c) && stormTargets(st, c).length > 0,
    step: () => null,
    apply(st, c, _p, fx, rnd = Math.random) {
      const hits = [];
      for (const s of shuffled(stormTargets(st, c), rnd)) {
        if (hits.length >= 3) break;
        if (clearsSafely(st, c, [...hits, s])) hits.push(s);
      }
      hits.forEach(s => destroy(st, s));
      fx.push({ k: 'storm', sqs: hits }, { k: 'boom', sqs: hits, kind: 'thunder' });
    },
  },
  aegis: {
    cat: 'power', legendary: true, free: true, name: 'Aegis', icon: 'shield-plus', desc: 'A golden barrier: one of your pieces and every friendly piece next to it are shielded for 2 enemy turns. Free action.',
    step: (st, c, picks) => (picks.length ? null : step('Pick the center of the barrier', own(st, c, notKing))),
    apply(st, c, [sq], fx) {
      const sqs = area3(sq).filter(s => st.board[s]?.[0] === c && st.board[s][1] !== 'k');
      sqs.forEach(s => (mark(st, s).shield = st.ply + 4));
      fx.push({ k: 'aegis', sq, sqs });
    },
  },
  ascension: {
    cat: 'power', legendary: true, name: 'Ascension', icon: 'crown', desc: 'One of your pawns ascends into a queen.',
    step: (st, c, picks) => (picks.length ? null : step('Pick a pawn to ascend', own(st, c, p => p[1] === 'p'))),
    apply(st, c, [sq], fx) { st.board[sq] = c + 'q'; fx.push({ k: 'ascend', sq, color: c }); },
  },
  shadowarmy: {
    cat: 'power', legendary: true, name: 'Shadow Army', icon: 'skull', desc: 'Your two strongest captured pieces rise from the shadows on your back ranks.',
    available: (st, c) => armyPlan(st, c).length > 0,
    step: () => null,
    apply(st, c, _p, fx) {
      const plan = armyPlan(st, c);
      for (const [t, sq] of plan) { st.captured[c].splice(st.captured[c].indexOf(t), 1); st.board[sq] = c + t; }
      fx.push({ k: 'arise', sqs: plan.map(p => p[1]), color: c });
    },
  },
  timestop: {
    cat: 'card', legendary: true, free: true, name: 'Time Stop', icon: 'hourglass', desc: 'Time freezes for your opponent: you take two extra turns. (A bonus turn is skipped if you give check.) Free action.',
    step: () => null,
    apply(st, c, _p, fx) { st.extra[c].push('stop', 'stop'); fx.push({ k: 'timestop', color: c }); },
  },
  hypnosis: {
    cat: 'card', legendary: true, name: 'Hypnosis', icon: 'tornado', desc: 'Hypnotize an enemy knight, bishop or rook anywhere on the board. It joins your side for good.',
    step: (st, c, picks) => (picks.length ? null : step('Pick an enemy piece', enemy(st, c, (p, s) => hittable(st)(p, s) && 'nbr'.includes(p[1])))),
    apply(st, c, [sq], fx) {
      st.board[sq] = c + st.board[sq][1];
      delete st.marks[sq];
      fx.push({ k: 'hypno', sq }, { k: 'aura', sqs: [sq], kind: 'steal' });
    },
  },
};

// ------------------------------------------------------------------ fusion
const pair = (a, b) => [a, b].sort().join('+');
const RECIPES = {};
for (const [result, pairs] of Object.entries({
  hyperbeam: [['laser', 'laser'], ['laser', 'emp'], ['laser', 'slash']],
  orbital: [['rocket', 'rocket'], ['rocket', 'mine'], ['rocket', 'shotgun']],
  zero: [['freeze', 'freeze'], ['freeze', 'emp'], ['emp', 'emp']],
  storm: [['thunder', 'thunder'], ['thunder', 'emp'], ['thunder', 'laser']],
  aegis: [['shield', 'shield'], ['shield', 'resurrect'], ['shield', 'freeze']],
  ascension: [['evolve', 'evolve'], ['evolve', 'resurrect'], ['evolve', 'clone']],
  shadowarmy: [['resurrect', 'resurrect'], ['resurrect', 'clone'], ['ghost', 'resurrect']],
  timestop: [['skip', 'skip'], ['double', 'skip'], ['double', 'double'], ['reverse', 'skip'], ['reverse', 'reverse']],
  hypnosis: [['mind', 'mind'], ['steal', 'steal'], ['mind', 'steal'], ['imposter', 'disguise']],
})) for (const [a, b] of pairs) RECIPES[pair(a, b)] = result;
// Cross-group recipes: these only come up in Chaos, where one hand mixes power-ups, weapons and cards.
for (const [result, pairs] of Object.entries({
  hyperbeam: [['ghost', 'laser'], ['evolve', 'laser']],
  orbital: [['teleport', 'rocket'], ['emp', 'mine']],
  zero: [['freeze', 'thunder'], ['freeze', 'slash']],
  storm: [['thunder', 'double'], ['shotgun', 'thunder']],
  aegis: [['emp', 'shield'], ['reverse', 'shield']],
  ascension: [['disguise', 'evolve'], ['evolve', 'steal']],
  shadowarmy: [['imposter', 'clone'], ['resurrect', 'mimic']],
  timestop: [['rewind', 'skip'], ['double', 'rewind'], ['swap', 'skip']],
  hypnosis: [['mind', 'shuffle'], ['mind', 'imposter']],
})) for (const [a, b] of pairs) RECIPES[pair(a, b)] = result;

export const LEGENDS = { power: ['ascension', 'aegis', 'shadowarmy'], weapon: ['hyperbeam', 'orbital', 'zero', 'storm'], card: ['timestop', 'hypnosis'] };
export const LEGENDARY_KINDS = Object.values(LEGENDS).flat();

/** What two items fuse into: a legendary kind, 'random' (a random legendary), or null (can't fuse). */
export function fusionOf(a, b) {
  if (!ITEMS[a] || !ITEMS[b] || ITEMS[a].legendary || ITEMS[b].legendary) return null;
  return RECIPES[pair(a, b)] || 'random';
}
export function rollFusion(a, b, rnd = Math.random) {
  const f = fusionOf(a, b);
  if (f !== 'random') return f;
  return pick([...new Set([...LEGENDS[ITEMS[a].cat], ...LEGENDS[ITEMS[b].cat]])], rnd);
}

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
