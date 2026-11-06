# YesChess

**chess, but anything goes.**

It's a chess game I made where the rules are real chess, and then everything else is not. You get power-ups, weapons, cards, random events, anime cut-ins and a laser rook. It's very serious and very balanced (it is not balanced).

Play the bot, pass-and-play on one screen, or send a link to a friend and fight online. There are no accounts, no database, nothing to pay for and no build step.

---

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**. You need Node 18+.

To play someone on the same Wi-Fi, send them `http://<your-local-ip>:3000`. To play someone anywhere, see [Hosting](#hosting-free).

## Modes

| Mode | Vibe |
| --- | --- |
| **Classic** | Normal chess. For cowards. |
| **Chaos** | Everything at once: power-ups, weapons *and* cards drop from crates and every 4 turns, random events, hold up to 5 items. Most fusion combos. The main event. |
| **Weapon Chess** | 2 weapons to start, +1 every 3 turns. Things explode. |
| **Card Chess** | 3 cards to start, draw every 2 turns. Uno energy. |

**Ground rules so it stays chess-ish:**
- Kings are immune to everything.
- No item can leave your own king in check.
- An event never leaves the player who just moved in check.

## The stuff

<details>
<summary><b>Power-ups</b> (10)</summary>

| | |
| --- | --- |
| Teleport | Blink one of your pieces to any empty square. |
| Shield | Protect a piece from capture for 2 enemy turns. *Free action.* |
| Time Rewind | Undo your opponent's last turn. Then it's your move. |
| Clone | Duplicate a pawn, knight, bishop or rook onto an adjacent square. |
| Mind Control | Move one enemy knight, bishop or rook this turn. It can attack its own team. |
| Swap | Swap one of your pieces with any other piece. (Substitution jutsu sound included.) |
| Ghost | A bishop, rook or queen moves straight through other pieces. |
| Freeze | An enemy piece can't move for its next 2 turns. *Free action.* |
| Resurrection | Bring back one of your captured pieces near your back rank. |
| Evolution | Upgrade a pawn into a knight, bishop or rook. |
</details>

<details>
<summary><b>Weapons</b> (5)</summary>

| | |
| --- | --- |
| Laser | Fire a beam in a straight line. Destroys the first enemy it hits. |
| Rocket | Blast any enemy piece except the king or queen. |
| Landmine | Hide a trap on an empty square in the middle of the board. Your opponent can't see it. *Free action.* |
| EMP | 3×3 pulse: enemies there are stunned and lose their shields, mines are wiped, and your opponent can't use items next turn. |
| Shotgun | Blast every adjacent enemy pawn, knight, bishop or rook around one of your pieces. |
</details>

<details>
<summary><b>Cards</b> (7)</summary>

| | |
| --- | --- |
| Reverse | Flip the turn order: you play twice in a row, then your opponent does. |
| Skip | Your opponent skips their next turn. (Not if you give check.) |
| Double Move | Two moves this turn with two different pieces. |
| Shuffle | Scramble every pawn to a random square on its rank. |
| Steal | Convert an enemy knight, bishop, or a pawn in the middle ranks, to your side. |
| Mimic | Copy a random item from your opponent's hand. |
| Wildcard | Turn into any power-up you want. |
</details>

<details>
<summary><b>Random events</b> (8, Chaos mode)</summary>

| | |
| --- | --- |
| Meteor Strike | Three squares get flattened. Shields absorb the hit. |
| Earthquake | Pieces get shaken onto neighbouring squares. |
| Black Hole | Opens for a few turns. Anything that lands on it is gone. |
| Gravity Flip | Everything slides one square toward one side of the board. |
| Board Rotation | Kingside becomes queenside. Castling rights are lost. |
| Portals | Two linked portals. Land on one, pop out of the other. |
| Zombie Pieces | A fallen piece from each side claws its way back. |
| Mutation | One random piece on each side turns into something else. |
</details>

Every item and event has its own trading card art, a cut-in, a board effect and a synthesized sound.

## How it works

```
server.js          static files + WebSocket rooms (all in memory)
shared/            the game engine, used by BOTH the browser and the server
  rules.js         normal chess stuff, glued onto chess.js
  state.js         modes, item pools, status effects, board hazards
  items.js         all 22 power-ups / weapons / cards
  events.js        the 8 random events
  game.js          turn flow, bonus turns, draws, per-player views
  bot.js           the computer (alpha-beta, depth 2 + quiescence)
public/            the client: plain ES modules, no bundler
  js/app.js        screens, game view, the cut-in/effects sequencer
  js/board.js      board, drag & drop, all the particle nonsense
  js/cards.js      trading card art, generated as SVG
  js/sound.js      every sound effect, synthesized live with WebAudio
  js/net.js        WebSocket client with auto-reconnect
test/
  fuzz.js          plays ~200 random games and checks nothing breaks
  server.test.js   tries to cheat against the server
```

- **Chess rules** come from [chess.js](https://github.com/jhlywa/chess.js). The chaos is layered on top in its own modules.
- **The server is in charge.** Clients only send intents, like "move e2 to e4" or "use item #7 on c5". The server validates each one with the same code the UI uses. Each player gets their own view of the game, so your opponent's hand and your hidden mines never reach their browser. You can't inspect-element your way to a win.
- **Rooms** are just `/r/<id>` links. Your seat is remembered in `localStorage`, so you can refresh or close the tab and come back. If your opponent disappears for 60 seconds, you can claim the win. Rematches swap colours.
- **Dependencies:** `chess.js` and `ws`, and that's it. Pieces use the [Chess Merida font](https://www.jsdelivr.com/package/npm/chess-merida-font) from jsDelivr. Icons are inlined [Lucide](https://lucide.dev) paths (ISC).

## Tests

```bash
npm test                     # engine fuzz test across every mode
npm run test:server          # anti-cheat checks (start the server first)
npm run test:lobby           # lobby seat hand-over checks (server running)
```

## Hosting (free)

Online play needs something that runs a Node process with WebSockets. GitHub Pages, Netlify and Vercel-static **won't work**.

**Render** (free, no card). The repo already has a [`render.yaml`](render.yaml) blueprint, so setup is one click:
1. Sign in to [render.com](https://render.com) with GitHub.
2. Click **New → Blueprint** and pick this repo, then **Apply**.

That's it. From then on, **every push to `main` deploys automatically**, but only after the GitHub **CI** workflow (engine fuzz test + anti-cheat test) passes. Your game lives at `https://yeschess.onrender.com` (or whatever name Render gives it), and room links look like `https://yeschess.onrender.com/r/abc123`.

Free instances fall asleep after about 15 minutes idle, so the first load can take 30–60 seconds. Rooms live in memory and disappear when the instance sleeps or redeploys. That's fine for this game.

**Instant share from your own PC** (no account):

```bash
npm start
npx cloudflared tunnel --url http://localhost:3000
```

That gives you a temporary `https://….trycloudflare.com` link that works while your PC is on.

## License

MIT. Do whatever you want with it.
