// YesChess server: static files + tiny WebSocket room server. Rooms live in memory (no database).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { newGame, applyAction, viewFor, fxFor, forfeit, MODES } from './shared/game.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLAIM_AFTER_MS = 60_000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------------------------------------------------------------- static files
function resolveFile(urlPath) {
  if (urlPath === '/' || /^\/r\/[a-z0-9]+\/?$/i.test(urlPath)) return path.join(ROOT, 'public', 'index.html');
  if (urlPath === '/vendor/chess.js') return path.join(ROOT, 'node_modules', 'chess.js', 'dist', 'esm', 'chess.js');
  const base = urlPath.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
  const file = path.normalize(path.join(base, decodeURIComponent(urlPath)));
  if (!file.startsWith(base + path.sep)) return null; // path traversal guard
  if (urlPath.startsWith('/shared/') && !file.startsWith(path.join(ROOT, 'shared') + path.sep)) return null;
  return file;
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://x').pathname;
  if (urlPath === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`ok ${rooms.size} rooms`); }
  const file = resolveFile(urlPath);
  try {
    if (!file) throw new Error('bad path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

// ---------------------------------------------------------------------- rooms
/** room = { id, mode, seats: { w, b }, spectators: Set<ws>, state, ready, rematch, lastActive } */
const rooms = new Map();
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function roomId() {
  let id;
  do id = [...randomBytes(6)].map(b => ALPHABET[b % ALPHABET.length]).join('');
  while (rooms.has(id));
  return id;
}

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function roomInfo(room) {
  const seat = c => room.seats[c] && {
    name: room.seats[c].name, connected: room.seats[c].connected, ready: room.ready[c], rematch: room.rematch[c],
    away: room.seats[c].connected ? 0 : Date.now() - room.seats[c].since, claimAfter: CLAIM_AFTER_MS,
  };
  return { t: 'room', id: room.id, mode: room.mode, started: !!room.state, seats: { w: seat('w'), b: seat('b') } };
}

function broadcastRoom(room) {
  const info = roomInfo(room);
  for (const c of ['w', 'b']) send(room.seats[c]?.ws, info);
  for (const ws of room.spectators) send(ws, info);
}

function broadcastState(room, fx = []) {
  const st = room.state;
  for (const c of ['w', 'b']) send(room.seats[c]?.ws, { t: 'state', view: viewFor(st, c), fx: fxFor(fx, c) });
  for (const ws of room.spectators) send(ws, { t: 'state', view: viewFor(st, null), fx: fxFor(fx, null) });
}

function startGame(room) {
  room.state = newGame(room.mode);
  room.rematch = { w: false, b: false };
  broadcastRoom(room);
  broadcastState(room, [{ k: 'start' }]);
}

const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, n);

function handle(ws, msg) {
  const room = ws.roomId && rooms.get(ws.roomId);
  const color = ws.color;
  if (room) room.lastActive = Date.now();

  switch (msg.t) {
    case 'create': {
      const mode = MODES[msg.mode] ? msg.mode : 'classic';
      const r = { id: roomId(), mode, seats: { w: null, b: null }, spectators: new Set(), state: null, ready: { w: false, b: false }, rematch: { w: false, b: false }, lastActive: Date.now() };
      rooms.set(r.id, r);
      return send(ws, { t: 'created', id: r.id });
    }

    case 'join': {
      const r = rooms.get(String(msg.room || '').toLowerCase());
      if (!r) return send(ws, { t: 'error', code: 'no-room', msg: 'This room doesn’t exist (or it expired).' });
      const token = clean(msg.token, 64);
      const name = clean(msg.name, 24) || 'Player';
      let c = ['w', 'b'].find(k => r.seats[k]?.token === token);
      if (!c) {
        const open = ['w', 'b'].filter(k => !r.seats[k]);
        if (open.length) c = open[Math.floor(Math.random() * open.length)];
      }
      r.lastActive = Date.now();
      ws.roomId = r.id;
      if (!c) {
        ws.color = null;
        r.spectators.add(ws);
        send(ws, { t: 'joined', color: null, id: r.id, mode: r.mode });
      } else {
        const prev = r.seats[c];
        if (prev?.ws && prev.ws !== ws) { send(prev.ws, { t: 'error', code: 'replaced', msg: 'This game was opened in another tab.' }); prev.ws.roomId = null; prev.ws.close(); }
        r.seats[c] = { token, name, ws, connected: true, since: 0 };
        ws.color = c;
        send(ws, { t: 'joined', color: c, id: r.id, mode: r.mode });
      }
      broadcastRoom(r);
      if (r.state) send(ws, { t: 'state', view: viewFor(r.state, ws.color), fx: [] });
      return;
    }

    case 'ready': {
      if (!room || !color || room.state) return;
      room.ready[color] = msg.ready !== false;
      broadcastRoom(room);
      if (room.seats.w && room.seats.b && room.ready.w && room.ready.b) startGame(room);
      return;
    }

    case 'act': {
      if (!room?.state || !color) return;
      const scratch = structuredClone(room.state);
      try {
        const fx = applyAction(scratch, color, msg.action);
        room.state = scratch;
        broadcastState(room, fx);
      } catch (e) {
        send(ws, { t: 'error', code: 'rejected', msg: e.message });
        send(ws, { t: 'state', view: viewFor(room.state, color), fx: [] }); // resync
      }
      return;
    }

    case 'rematch': {
      if (!room?.state || !color) return;
      room.rematch[color] = msg.want !== false;
      if (room.rematch.w && room.rematch.b) {
        [room.seats.w, room.seats.b] = [room.seats.b, room.seats.w]; // swap colors
        for (const c of ['w', 'b']) if (room.seats[c]?.ws) { room.seats[c].ws.color = c; send(room.seats[c].ws, { t: 'joined', color: c, id: room.id, mode: room.mode }); }
        startGame(room);
      } else broadcastRoom(room);
      return;
    }

    case 'claim': {
      if (!room?.state || !color) return;
      const opp = room.seats[color === 'w' ? 'b' : 'w'];
      if (opp && !opp.connected && Date.now() - opp.since > CLAIM_AFTER_MS) {
        const fx = forfeit(room.state, color === 'w' ? 'b' : 'w', 'opponent left');
        broadcastState(room, fx);
      }
      return;
    }

    case 'leave': {
      if (!room) return;
      if (color && room.state) broadcastState(room, forfeit(room.state, color, 'opponent left'));
      detach(ws, room);
      ws.roomId = null;
      return;
    }

    case 'ping': return send(ws, { t: 'pong' });
  }
}

function detach(ws, room) {
  room.spectators.delete(ws);
  const seat = ws.color && room.seats[ws.color];
  if (seat && seat.ws === ws) {
    seat.connected = false;
    seat.ws = null;
    seat.since = Date.now();
    if (!room.state) room.ready[ws.color] = false;
  }
  broadcastRoom(room);
}

// ------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg.t === 'string') {
      try { handle(ws, msg); } catch (e) { console.error('handler error', e); }
    }
  });
  ws.on('close', () => {
    const room = ws.roomId && rooms.get(ws.roomId);
    if (room) detach(ws, room);
  });
});

// Heartbeat: drop dead sockets (so opponents see "disconnected") and keep proxies from idling us out.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 25_000);

// Forget rooms nobody has touched for a while.
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    const anyone = r.seats.w?.connected || r.seats.b?.connected || r.spectators.size;
    if ((!anyone && now - r.lastActive > 30 * 60_000) || now - r.lastActive > 12 * 3600_000) rooms.delete(id);
  }
}, 5 * 60_000);

server.listen(PORT, () => console.log(`YesChess running at http://localhost:${PORT}`));
