// Talks to a running server (npm start) over raw WebSockets, bypassing the UI, to check that
// the server is authoritative: out-of-turn, illegal and forged actions are rejected.
import WebSocket from 'ws';
const URL = process.env.URL || 'ws://localhost:3000/ws';
const open = () => new Promise(r => { const ws = new WebSocket(URL); const q = []; ws.inbox = q; ws.on('message', d => q.push(JSON.parse(d))); ws.on('open', () => r(ws)); });
const send = (ws, m) => ws.send(JSON.stringify(m));
const wait = ms => new Promise(r => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find(m => m.t === t);

const a = await open();
send(a, { t: 'create', mode: 'weapons' }); await wait(150);
const id = last(a, 'created').id;
const b = await open();
send(a, { t: 'join', room: id, token: 'tok-a', name: 'Alice' });
send(b, { t: 'join', room: id, token: 'tok-b', name: 'Bob' }); await wait(150);
send(a, { t: 'ready' }); send(b, { t: 'ready' }); await wait(200);
const colorA = last(a, 'joined').color;
const [white, black] = colorA === 'w' ? [a, b] : [b, a];
const results = [];
const attempt = async (ws, action, label) => {
  ws.inbox.length = 0; send(ws, { t: 'act', action }); await wait(120);
  const err = last(ws, 'error');
  results.push(`${err ? 'REJECTED' : 'accepted'}  ${label}${err ? ' — ' + err.msg : ''}`);
};
await attempt(black, { type: 'move', from: 'e7', to: 'e5' }, 'black moves out of turn');
await attempt(white, { type: 'move', from: 'e2', to: 'e5' }, 'white illegal pawn jump');
await attempt(white, { type: 'move', from: 'e1', to: 'e8' }, 'white king teleports');
await attempt(white, { type: 'item', id: 9999, picks: ['e7'] }, 'white uses an item it does not own');
const view = last(white, 'state').view;
const blackItems = last(white, 'state').view.inv.b;
await attempt(white, { type: 'item', id: blackItems[0].id, picks: [] }, "white uses black's item id");
const rocket = view.inv.w.find(i => i.kind === 'rocket');
if (rocket) await attempt(white, { type: 'item', id: rocket.id, picks: ['e8'] }, 'white rockets the black king');
await attempt(white, { type: 'move', from: 'e2', to: 'e4' }, 'white legal e4');
results.push(`black sees opponent hand as: ${JSON.stringify(last(black, 'state').view.inv.w.map(i => i.kind))}`);
results.push(`black sees white mines: ${JSON.stringify(last(black, 'state').view.mines)}`);
console.log(results.join('\n'));
a.close(); b.close();
