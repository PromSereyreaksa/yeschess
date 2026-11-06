// Plays many random games in every mode and checks engine invariants after each action.
import { newGame, applyAction, legalMoves, viewFor, itemAllowed } from '../shared/game.js';
import { itemStep, itemUsable, fusionOf } from '../shared/items.js';
import { kingSq, inCheck, other, rankOf } from '../shared/rules.js';
import { botAction } from '../shared/bot.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
let actions = 0, games = 0, itemsUsed = 0, events = 0;
const counts = {};

function check(st, ctx) {
  for (const c of ['w', 'b']) if (!kingSq(st.board, c)) throw new Error(`${ctx}: missing ${c} king`);
  for (const [sq, p] of Object.entries(st.board)) if (p[1] === 'p' && (rankOf(sq) === 0 || rankOf(sq) === 7)) throw new Error(`${ctx}: pawn on back rank ${sq}`);
  if (st.status === 'playing' && inCheck(st, other(st.turn))) throw new Error(`${ctx}: side not to move is in check`);
  // hidden information never reaches the other side
  for (const viewer of ['w', 'b']) {
    const v = viewFor(st, viewer);
    for (const [sq, m] of Object.entries(st.marks)) {
      const p = st.board[sq];
      if (!p || p[0] === viewer) continue;
      if (m.disguise && p[1] === 'q' && v.board[sq] !== p[0] + 'p') throw new Error(`${ctx}: disguise at ${sq} visible to ${viewer}`);
      if (m.fake && v.marks[sq]?.fake) throw new Error(`${ctx}: imposter at ${sq} visible to ${viewer}`);
    }
    if (v.inv[other(viewer)].some(i => i.kind)) throw new Error(`${ctx}: opponent hand visible`);
  }
  for (const [sq, m] of Object.entries(st.marks)) if (m.disguise && st.board[sq]?.[1] === 'q' && (rankOf(sq) === 0 || rankOf(sq) === 7) && st.status === 'playing') throw new Error(`${ctx}: disguise on back rank ${sq}`);
}

function randomAction(st) {
  const c = st.turn;
  const inv = st.inv[c];
  if (inv.length >= 2 && Math.random() < 0.08) {
    const [x, y] = [...inv].sort(() => Math.random() - 0.5);
    if (fusionOf(x.kind, y.kind)) return { type: 'fuse', ids: [x.id, y.id] };
  }
  if (inv.length && Math.random() < 0.03) return { type: 'discard', id: pick(inv).id };
  if (!itemAllowed(st, c) && Math.random() < 0.5) {
    const usable = st.inv[c].filter(i => itemUsable(st, c, i.kind));
    if (usable.length) {
      const it = pick(usable), picks = [];
      for (let s = itemStep(st, c, it.kind, picks); s; s = itemStep(st, c, it.kind, picks)) picks.push(pick(s.targets));
      return { type: 'item', id: it.id, picks };
    }
  }
  const m = pick(legalMoves(st, c));
  return m && { type: 'move', from: m.from, to: m.to, promotion: m.promotion };
}

for (const mode of ['classic', 'chaos', 'weapons', 'cards']) {
  for (let g = 0; g < (mode === 'classic' ? 15 : 60); g++) {
    const st = newGame(mode);
    games++;
    for (let i = 0; i < 300 && st.status === 'playing'; i++) {
      const a = randomAction(st);
      if (!a) throw new Error(`${mode}: no action while playing`);
      const before = structuredClone(st);
      let fx;
      try { fx = applyAction(st, st.turn, a); check(st, 'x'); } catch (e) {
        console.log('FAILED', mode, a, before.inv[before.turn].find(i => i.id === a.id)?.kind, 'fx:', JSON.stringify(fx));
        console.log('board before', JSON.stringify(before.board), 'turn', before.turn, 'extra', JSON.stringify(before.extra));
        console.log('board after', JSON.stringify(st.board), 'turn', st.turn);
        throw e;
      }
      actions++;
      if (a.type === 'item' && st.history.at(-1)?.item) { itemsUsed++; const k = st.history.at(-1).item; counts[k] = (counts[k] || 0) + 1; }
      for (const f of fx) if (['fuse', 'discard', 'quest-done', 'reveal', 'imposter'].includes(f.k)) counts[f.k] = (counts[f.k] || 0) + 1;
      events += fx.filter(f => f.k === 'event').length;
      fx.filter(f => f.k === 'event').forEach(f => (counts['ev:' + f.id] = (counts['ev:' + f.id] || 0) + 1));
      check(st, `${mode} game ${g} action ${i} ${JSON.stringify(a)}`);
    }
  }
}

// Illegal actions must be rejected.
const st = newGame('chaos');
for (const bad of [{ type: 'move', from: 'e2', to: 'e5' }, { type: 'item', id: 999, picks: [] }, { type: 'nope' }]) {
  let threw = false;
  try { applyAction(structuredClone(st), 'w', bad); } catch { threw = true; }
  if (!threw) throw new Error('accepted illegal action ' + JSON.stringify(bad));
}
let threw = false;
try { applyAction(structuredClone(st), 'b', { type: 'move', from: 'e7', to: 'e5' }); } catch { threw = true; }
if (!threw) throw new Error('accepted move out of turn');

// Bot timing
const t0 = Date.now();
const bg = newGame('classic');
for (let i = 0; i < 6; i++) applyAction(bg, bg.turn, botAction(bg, bg.turn));
console.log(`bot: ${((Date.now() - t0) / 6).toFixed(0)}ms per move (depth 2 + quiescence)`);

console.log(`OK — ${games} games, ${actions} actions, ${itemsUsed} items, ${events} events`);
console.log(Object.entries(counts).sort().map(([k, v]) => `${k}:${v}`).join('  '));
