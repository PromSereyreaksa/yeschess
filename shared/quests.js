// Side quests: each player gets a public goal. Finish it for a reward with a big cut-scene.
import { other, rankOf } from './rules.js';
import { giveItem, mark, pick, isFake, hideMap } from './state.js';
import { LEGENDS, LEGENDARY_KINDS } from './items.js';

export const QUESTS = {
  queen: { name: 'Queen’s Hunt', icon: 'crown', goal: 2, desc: 'Capture 2 pieces with your queen', reward: 'Your queen ascends: a golden shield for 3 turns, plus a legendary card' },
  pawns: { name: 'Pawn Storm', icon: 'chevrons-up', goal: 2, desc: 'Capture 2 pieces with pawns', reward: 'Your most advanced pawn ascends into a queen' },
  knight: { name: 'Knight Rider', icon: 'swords', goal: 2, desc: 'Capture 2 pieces with knights', reward: 'A legendary card' },
  bishop: { name: 'Holy Order', icon: 'sun', goal: 2, desc: 'Capture 2 pieces with bishops', reward: 'A legendary card' },
  rook: { name: 'Siege Tower', icon: 'target', goal: 2, desc: 'Capture 2 pieces with rooks', reward: 'A legendary card' },
  arcane: { name: 'Arcane Student', icon: 'wand-sparkles', goal: 3, desc: 'Use 3 items', reward: 'A legendary card' },
  wall: { name: 'Iron Wall', icon: 'shield-plus', goal: 5, desc: 'Don’t lose a piece for 5 of your turns', reward: 'Aegis, the golden barrier' },
  pressure: { name: 'Pressure', icon: 'target', goal: 2, desc: 'Give check 2 times', reward: 'Time Stop' },
};
const CAPTURE = { q: 'queen', p: 'pawns', n: 'knight', b: 'bishop', r: 'rook' };

const NEEDS = { queen: 'q', pawns: 'p', knight: 'n', bishop: 'b', rook: 'r' };
const QUEST_TURNS = 15; // a quest you haven't finished after this many of your turns is swapped out
const canStill = (st, c, kind) => !NEEDS[kind] || Object.keys(st.board).some(s => st.board[s] === c + NEEDS[kind] && !isFake(st, s));

function newQuest(st, c, fx, avoid, why) {
  const kinds = Object.keys(QUESTS).filter(k => k !== avoid && k !== st.quests[other(c)]?.kind && canStill(st, c, k));
  const kind = pick(kinds.length ? kinds : ['arcane', 'pressure', 'wall'].filter(k => k !== avoid));
  st.quests[c] = { kind, n: 0, goal: QUESTS[kind].goal, done: false, since: st.turns?.[c] ?? 0 };
  fx.push({ k: 'quest-new', color: c, kind, why, turns: QUEST_TURNS });
}

export function initQuests(st) {
  st.quests = { w: null, b: null };
  const sink = [];
  for (const c of ['w', 'b']) newQuest(st, c, sink);
}

/** Something happened that might count toward `c`'s quest. */
export function questTick(st, c, ev, fx) {
  const q = st.quests?.[c];
  if (!q || q.done) return;
  const hit = (ev.capture && CAPTURE[ev.capture] === q.kind) || (ev.item && q.kind === 'arcane')
    || (ev.check && q.kind === 'pressure') || (ev.turn && q.kind === 'wall');
  if (!hit) return;
  q.n++;
  fx.push({ k: 'quest', color: c, kind: q.kind, n: q.n, goal: q.goal });
  if (q.n >= q.goal) complete(st, c, fx);
}

function legendFor(st) {
  const pool = LEGENDS[{ weapons: 'weapon', cards: 'card' }[st.mode]] || LEGENDARY_KINDS; // Chaos: any legendary
  return pick(Math.random() < 0.7 ? pool : LEGENDARY_KINDS);
}

function complete(st, c, fx) {
  const q = st.quests[c];
  q.done = true;
  q.next = st.turns[c] + 2;
  fx.push({ k: 'quest-done', color: c, kind: q.kind, before: { ...st.board }, hide: hideMap(st) }); // board before the reward, for sequencing
  if (q.kind === 'queen') {
    const sq = Object.keys(st.board).find(s => st.board[s] === c + 'q' && !isFake(st, s) && !st.marks[s]?.disguise); // never point at a hidden queen
    if (sq) { mark(st, sq).shield = st.ply + 6; fx.push({ k: 'ascend', sq, color: c, quest: true }); }
    giveItem(st, c, legendFor(st), fx, 'quest', true);
  } else if (q.kind === 'pawns') {
    const fwd = s => (c === 'w' ? rankOf(s) : 7 - rankOf(s));
    const sq = Object.keys(st.board).filter(s => st.board[s] === c + 'p').sort((a, b) => fwd(b) - fwd(a))[0];
    if (sq) { st.board[sq] = c + 'q'; fx.push({ k: 'ascend', sq, color: c, quest: true }); }
    else giveItem(st, c, legendFor(st), fx, 'quest', true);
  } else if (q.kind === 'wall') {
    giveItem(st, c, 'aegis', fx, 'quest', true);
  } else if (q.kind === 'pressure') {
    giveItem(st, c, 'timestop', fx, 'quest', true);
  } else {
    giveItem(st, c, legendFor(st), fx, 'quest', true);
  }
}

/** A couple of turns after finishing a quest, the next one arrives. */
/**
 * Keeps quests alive: a couple of turns after finishing one the next arrives, a quest that can no
 * longer be done (your queen is gone…) is swapped right away, and a stale one expires.
 */
export function questRefresh(st, c, fx) {
  const q = st.quests?.[c];
  if (!q) return;
  if (q.done) { if (st.turns[c] >= q.next) newQuest(st, c, fx, q.kind); return; }
  if (!canStill(st, c, q.kind)) return newQuest(st, c, fx, q.kind, 'impossible');
  if (st.turns[c] - (q.since ?? 0) >= QUEST_TURNS) newQuest(st, c, fx, q.kind, 'expired');
}
export const questTurnsLeft = (st, c) => { const q = st.quests?.[c]; return q && !q.done ? Math.max(0, QUEST_TURNS - (st.turns[c] - (q.since ?? 0))) : null; };
