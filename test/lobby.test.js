// Lobby seats: a friend who reopens the link in another app/browser must not get stuck as a spectator.
// Run with the server up: npm run test:lobby
import { WebSocket } from 'ws';
const URL = process.env.URL || 'ws://localhost:3000/ws';
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = () => new Promise(r => { const ws = new WebSocket(URL); ws.inbox = []; ws.on('message', d => ws.inbox.push(JSON.parse(d))); ws.on('open', () => r(ws)); });
const last = (ws, t) => [...ws.inbox].reverse().find(m => m.t === t);
const log = [];
const ok = (cond, what) => { log.push(`${cond ? 'PASS' : 'FAIL'}  ${what}`); if (!cond) process.exitCode = 1; };

const host = await open(); host.send(JSON.stringify({ t: 'create', mode: 'chaos' })); await wait(200);
const id = last(host, 'created').id; host.close();
const a = await open(); a.send(JSON.stringify({ t: 'join', room: id, token: 'tok-host', name: 'Host' })); await wait(200);
ok(!!last(a, 'joined').color, 'host gets a seat');

// friend opens the link in app #1, then leaves
const b1 = await open(); b1.send(JSON.stringify({ t: 'join', room: id, token: 'tok-app1', name: 'Friend' })); await wait(200);
ok(!!last(b1, 'joined').color, 'friend (app 1) gets the second seat');
b1.close(); await wait(150);

// a quick refresh with the same token inside the grace period keeps the seat
const b1r = await open(); b1r.send(JSON.stringify({ t: 'join', room: id, token: 'tok-app1', name: 'Friend' })); await wait(200);
ok(last(b1r, 'joined').color === last(b1, 'joined').color, 'refresh within grace keeps the same seat');
b1r.close(); await wait(150);

// friend opens it in app #2 right away: watches at first, then is moved into the seat
const b2 = await open(); b2.send(JSON.stringify({ t: 'join', room: id, token: 'tok-app2', name: 'Friend2' })); await wait(200);
ok(last(b2, 'joined').color === null, 'app 2 starts as a spectator while the old seat is in its grace period');
await wait(4300);
const promoted = b2.inbox.filter(m => m.t === 'joined').at(-1);
ok(!!promoted.color, `app 2 is promoted into the abandoned seat (${promoted.color})`);
const room = last(b2, 'room');
ok(room.seats.w && room.seats.b && room.seats[promoted.color].name === 'Friend2' && !room.seats[promoted.color].ready, 'seat shows the new player, not ready');

// both ready -> game starts
a.send(JSON.stringify({ t: 'ready', ready: true })); b2.send(JSON.stringify({ t: 'ready', ready: true })); await wait(300);
ok(!!last(b2, 'state'), 'game starts once both are ready');

// once the game started, nobody can steal a seat
b2.close(); await wait(4300);
const c = await open(); c.send(JSON.stringify({ t: 'join', room: id, token: 'tok-thief', name: 'Thief' })); await wait(200);
ok(last(c, 'joined').color === null, 'after the game starts, a disconnected seat is NOT taken over');
console.log(log.join('\n'));
a.close(); c.close();
