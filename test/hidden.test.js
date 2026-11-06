// Hidden-information cards: Disguise (secret queen) and Imposter (fake queen).
import { newGame, applyAction, viewFor, legalMoves } from '../shared/game.js';
import { readFen } from '../shared/rules.js';

let fails = 0;
const ok = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) fails++; };
const setup = fen => { const st = newGame('cards'); Object.assign(st, readFen(fen)); st.marks = {}; st.inv = { w: [], b: [] }; return st; };

// 1. Disguised queen on c4 (Black only sees a pawn). Black's king walks into its diagonal: the move is
//    refused and the disguise is revealed instead.
{
  const st = setup('7k/8/8/8/2P5/8/8/K7 b - - 0 1');
  st.board.c4 = 'wq'; st.marks.c4 = { disguise: true };
  ok(viewFor(st, 'b').board.c4 === 'wp', 'black sees the disguised queen as a pawn');
  ok(viewFor(st, 'w').board.c4 === 'wq', 'white (owner) sees the queen');
  const fx = applyAction(st, 'b', { type: 'move', from: 'h8', to: 'g8' }); // g8 is on the c4–g8 diagonal
  ok(fx.some(f => f.k === 'reveal' && f.blocked), 'walking into its line reveals it');
  ok(st.board.h8 === 'bk' && st.turn === 'b', 'the move did not happen and it is still black to move');
  ok(viewFor(st, 'b').board.c4 === 'wq', 'black now sees the queen');
}

// 2. A disguised queen moving like a pawn stays hidden; moving like a queen gives it away.
{
  const st = setup('6k1/8/8/8/8/8/2P5/K7 w - - 0 1');
  st.board.c2 = 'wq'; st.marks.c2 = { disguise: true };
  applyAction(st, 'w', { type: 'move', from: 'c2', to: 'c3' });
  ok(st.marks.c3?.disguise && st.history.at(-1).text === 'c3', 'pawn-like step keeps the disguise (and the log says "c3")');
  applyAction(st, 'b', { type: 'move', from: 'g8', to: 'f8' });
  const fx = applyAction(st, 'w', { type: 'move', from: 'c3', to: 'a5' });
  ok(fx.some(f => f.k === 'reveal') && !st.marks.a5?.disguise, 'a diagonal queen move reveals it');
}

// 3. An imposter can't capture, and a fake "check" just pops it.
{
  const st = setup('k7/8/8/3p4/8/8/8/3QK3 w - - 0 1');
  st.board.d1 = 'wq'; st.marks.d1 = { fake: 99 };
  ok(!legalMoves(st, 'w').some(m => m.from === 'd1' && m.to === 'd5'), 'the imposter has no capturing moves');
  ok(!viewFor(st, 'b').marks.d1, 'black can’t see which queen is fake');
  const fx = applyAction(st, 'w', { type: 'move', from: 'd1', to: 'a4' }); // "checks" the king on a8 along the file
  ok(fx.some(f => f.k === 'imposter') && !st.board.a4, 'a fake check pops the imposter');
  ok(st.turn === 'b', 'and the game just carries on');
}
process.exitCode = fails ? 1 : 0;
