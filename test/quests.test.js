// Every quest type, played out on a small position: does it progress and complete?
import { newGame, applyAction } from '../shared/game.js';
import { readFen } from '../shared/rules.js';
import { QUESTS } from '../shared/quests.js';

let fails = 0;
function run(kind, fen, actions, extra = st => st) {
  const st = newGame('chaos');
  Object.assign(st, readFen(fen));
  Object.assign(st, { marks: {}, crates: [], mines: [], holes: [], portals: null, inv: { w: [], b: [] }, nextEvent: 999 });
  st.quests = { w: { kind, n: 0, goal: QUESTS[kind].goal, done: false }, b: { kind: 'arcane', n: 0, goal: 3, done: false } };
  extra(st);
  const seen = [];
  try {
    for (const a of actions) seen.push(...applyAction(st, st.turn, a));
  } catch (e) { console.log(`FAIL  ${kind}: ${e.message}`); fails++; return; }
  const ticks = seen.filter(f => f.k === 'quest' && f.color === 'w').map(f => f.n);
  const done = seen.some(f => f.k === 'quest-done' && f.color === 'w');
  console.log(`${done ? 'PASS' : 'FAIL'}  ${kind.padEnd(8)} progress ${JSON.stringify(ticks)}${done ? ' -> complete' : ''}`);
  if (!done) fails++;
}
const mv = (from, to) => ({ type: 'move', from, to });

run('queen', 'k7/8/8/3p4/8/8/3p4/K2Q4 w - - 0 1', [mv('d1', 'd2'), mv('a8', 'b8'), mv('d2', 'd5')]);
run('pawns', 'k7/8/8/8/1p6/2p1p3/3P4/K7 w - - 0 1', [mv('d2', 'c3'), mv('a8', 'b8'), mv('c3', 'b4')]);
run('knight', 'k7/8/8/8/4p3/2p5/8/KN6 w - - 0 1', [mv('b1', 'c3'), mv('a8', 'b8'), mv('c3', 'e4')]);
run('bishop', 'k7/8/1p6/8/8/4p3/8/K1B5 w - - 0 1', [mv('c1', 'e3'), mv('a8', 'a7'), mv('e3', 'b6')]);
run('rook', 'k7/8/8/2p4p/8/8/8/K6R w - - 0 1', [mv('h1', 'h5'), mv('a8', 'b8'), mv('h5', 'c5')]);
run('pressure', '7k/8/8/8/8/8/8/KR6 w - - 0 1', [mv('b1', 'b8'), mv('h8', 'h7'), mv('b8', 'b7')]);
run('wall', '7k/8/8/8/8/8/8/KR6 w - - 0 1', [
  mv('a1', 'a2'), mv('h8', 'g8'), mv('a2', 'a3'), mv('g8', 'f8'), mv('a3', 'a4'), mv('f8', 'e8'), mv('a4', 'a5'), mv('e8', 'd8'), mv('a5', 'a6')]);
run('arcane', 'k7/8/8/8/8/8/PPP5/K7 w - - 0 1', [
  { type: 'item', id: 1, picks: ['a2'] }, { type: 'item', id: 2, picks: ['b2'] }, { type: 'item', id: 3, picks: ['c2'] }],
  st => { st.inv.w = [{ id: 1, kind: 'shield' }, { id: 2, kind: 'shield' }, { id: 3, kind: 'shield' }]; });
// A quest that can't be finished any more is swapped straight away.
{
  const st = newGame('chaos');
  Object.assign(st, readFen('k7/8/8/8/8/8/8/K2Q3r b - - 0 1'));
  Object.assign(st, { marks: {}, crates: [], inv: { w: [], b: [] }, nextEvent: 999 });
  st.quests = { w: { kind: 'queen', n: 1, goal: 2, done: false, since: 0 }, b: { kind: 'arcane', n: 0, goal: 3, done: false, since: 0 } };
  const fx = applyAction(st, 'b', mv('h1', 'd1')); // black takes the white queen
  const swapped = fx.find(f => f.k === 'quest-new' && f.color === 'w');
  const ok = swapped?.why === 'impossible' && st.quests.w.kind !== 'queen';
  console.log(`${ok ? 'PASS' : 'FAIL'}  losing your queen swaps the Queen’s Hunt quest (now: ${st.quests.w.kind})`);
  if (!ok) fails++;
}
// Iron Wall tells you when it resets.
{
  const st = newGame('chaos');
  Object.assign(st, readFen('k7/8/8/8/8/8/P7/K6r b - - 0 1'));
  Object.assign(st, { marks: {}, crates: [], inv: { w: [], b: [] }, nextEvent: 999 });
  st.quests = { w: { kind: 'wall', n: 3, goal: 5, done: false, since: 0 }, b: { kind: 'arcane', n: 0, goal: 3, done: false, since: 0 } };
  st.board.a2 = 'wp'; st.board.h2 = 'br'; delete st.board.h1;
  const fx = applyAction(st, 'b', mv('h2', 'a2'));
  const ok = fx.some(f => f.k === 'quest' && f.kind === 'wall' && f.reset) && st.quests.w.n === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  losing a piece resets Iron Wall and says so`);
  if (!ok) fails++;
}
process.exitCode = fails ? 1 : 0;
