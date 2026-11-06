// YesChess client: screens, game view, local (bot / pass & play) and online controllers.
import { icon } from './icons.js';
import { Board, pieceInline } from './board.js';
import { sfx, isMuted, setMuted } from './sound.js';
import { Net } from './net.js';
import { newGame, applyAction, viewFor, fxFor, legalMoves, itemAllowed, MODES } from '/shared/game.js';
import { ITEMS, itemStep, itemUsable } from '/shared/items.js';
import { EVENTS } from '/shared/events.js';
import { inCheck, kingSq, other, VALUE, NAMES } from '/shared/rules.js';
import { botAction } from '/shared/bot.js';
import { cardSVG } from './cards.js';
import { TIPS } from './tips.js';
import { VFX, PAL } from './vfx.js';

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const rid = () => (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
const CAT = { power: 'var(--coral)', weapon: 'var(--blue)', card: 'var(--violet)' };
const CAT_HEX = { power: '#FF5A36', weapon: '#2E6BFF', card: '#7B5CFF' };
const VPAL = { power: PAL.fire, weapon: PAL.blue, card: PAL.violet };
const MODE_ICON = { classic: 'crown', chaos: 'flame', weapons: 'swords', cards: 'layers' };
const COLOR_NAME = { w: 'White', b: 'Black' };

function fillIcons(root = document) {
  $$('[data-icon]', root).forEach(el => { if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon); });
}
function syncSoundButtons() {
  $$('[data-action="sound"]').forEach(b => { b.innerHTML = icon(isMuted() ? 'volume-x' : 'volume-2'); b.title = isMuted() ? 'Sound off' : 'Sound on'; });
}

function toast(text, { ic = 'sparkle', color } = {}) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  if (color) t.style.setProperty('--t-cat', color);
  t.innerHTML = `<span class="t-ic">${icon(ic)}</span><span>${esc(text)}</span>`;
  box.appendChild(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
}

function modal(html, { onClose } = {}) {
  const m = $('#modal'), card = $('.modal-card', m);
  card.innerHTML = `<button class="icon-btn modal-close" aria-label="Close">${icon('x')}</button>${html}`;
  m.hidden = false;
  const close = () => { m.hidden = true; card.innerHTML = ''; m.onclick = null; document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  m.onclick = e => { if (e.target === m || e.target.closest('.modal-close')) close(); };
  fillIcons(card);
  return { card, close };
}

function confirmBox(title, text, okLabel = 'Yes') {
  return new Promise(resolve => {
    let done = false;
    const { card, close } = modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <div class="stack" style="margin-top:18px"><button class="btn btn-primary btn-lg" data-ok>${esc(okLabel)}</button><button class="btn btn-ghost btn-lg" data-no>Cancel</button></div>`,
    { onClose: () => { if (!done) resolve(false); } });
    card.querySelector('[data-ok]').onclick = () => { done = true; close(); resolve(true); };
    card.querySelector('[data-no]').onclick = () => close();
  });
}

function veil(text) { $('#veil-text').textContent = text; const v = $('#veil'); v.classList.remove('out'); v.hidden = false; }
async function unveil() { const v = $('#veil'); if (v.hidden) return; v.classList.add('out'); await sleep(280); v.hidden = true; v.classList.remove('out'); }

function show(id) {
  $$('.screen').forEach(s => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
  if (id === 'home') demo.start(); else demo.stop();
}

const ADJ = ['Brave', 'Sneaky', 'Lucky', 'Swift', 'Clever', 'Wild', 'Chill', 'Bold', 'Fuzzy', 'Mighty', 'Cosmic', 'Tiny', 'Jolly', 'Rogue'];
const NOUN = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King', 'Castle', 'Gambit', 'Fork', 'Meteor'];
function myName() {
  let n = store.get('yc-name');
  if (!n) { n = `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`; store.set('yc-name', n); }
  return n;
}

function modeChip(mode) { return `${icon(MODE_ICON[mode], 15)}<span>${MODES[mode].name}${mode === 'classic' ? '' : ' Chess'}</span>`; }

// =====================================================================
// Game view: renders a game and turns clicks into actions.
// A controller provides: kind ('bot' | 'hotseat' | 'online'), send(action), names, perspective().
// =====================================================================
class GameView {
  constructor(ctl) {
    this.ctl = ctl;
    this.view = null;
    this.sel = null;
    this.pick = null;
    this.pending = false;
    this.busyUntil = 0;
    this.seenItems = null;
    this.timers = [];
    this.queue = [];
    this.idleCbs = [];
    this.recent = [];
    mainBoard ||= new Board($('#board'));
    this.board = mainBoard;
    mainVfx ||= new VFX($('.board-wrap'), mainBoard);
    this.vfx = mainVfx;
    this.board.opts = {
      onSquare: (sq, o) => this.onSquare(sq, o),
      onDrop: (f, t) => this.onDrop(f, t),
      canDrag: sq => this.canDrag(sq),
    };
    $('#game-mode').className = `chip ${ctl.mode}`;
    $('#game-mode').innerHTML = modeChip(ctl.mode);
    $('.invite-mini').hidden = ctl.kind !== 'online';
    $('#overlay').hidden = $('#prompt').hidden = $('#popover').hidden = $('#banner').hidden = $('#callout').hidden = true;
    $('#hand-wrap').hidden = ctl.mode === 'classic';
    this.keyHandler = e => { if (e.key === 'Escape') { this.cancelPick(); this.sel = null; this.renderHighlights(); } };
    document.addEventListener('keydown', this.keyHandler);
  }

  destroy() {
    this.timers.forEach(clearTimeout);
    document.removeEventListener('keydown', this.keyHandler);
  }

  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  /** The color this screen acts as (the side to move in pass & play). */
  get me() { return this.ctl.perspective(this.view); }
  get myTurn() { return !!this.view && this.view.status === 'playing' && this.me === this.view.turn && !this.pending && !this.busy; }
  get busy() { return Date.now() < this.busyUntil || this.queue.length > 0; }

  /** Run cb once every queued animation has finished playing. */
  whenIdle(cb) {
    this.idleCbs.push(cb);
    if (!this.busy) this.flushIdle();
  }
  flushIdle() { const cbs = this.idleCbs; this.idleCbs = []; cbs.forEach(fn => fn()); }

  reset(view) {
    this.vfx.clear();
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.queue = [];
    this.busyUntil = 0;
    this.recent = [];
    this.started = false;
    this.sel = null; this.pick = null; this.seenItems = null;
    this.board.setOrientation(this.ctl.orientation(view));
    this.board.setPieces(view.board, { instant: true });
    $('#overlay').hidden = $('#prompt').hidden = $('#popover').hidden = $('#banner').hidden = $('#callout').hidden = true;
  }

  /** New state from the controller. Updates play one after another so nothing overlaps. */
  update(view, fx = []) {
    const start = !this.view || fx.some(f => f.k === 'start');
    if (start) this.reset(view);
    else if (this.busy) { this.queue.push([view, fx]); this.pending = false; return; }
    this.play(view, fx);
  }

  play(view, fx) {
    this.view = view;
    this.pending = false;
    this.board.setOrientation(this.ctl.orientation(view));
    if (this.pick) this.cancelPick();
    this.sel = null;
    this.recent = [];
    this.lastActor = fx.find(f => f.k === 'item')?.color || view.history.at(-1)?.color || null;

    // Each item use and each random event becomes its own beat:
    //   announce -> lock onto targets -> effect, so you can follow what happened.
    const phases = [[]];
    for (const f of fx) { if (f.k === 'event' || f.k === 'item') phases.push([f]); else phases.at(-1).push(f); }
    let t = 0;
    phases.forEach((ph, i) => {
      if (!ph.length) return;
      const boardAt = phases[i + 1]?.[0]?.before || view.board;
      const head = ph[0];
      if (head.k === 'event') {
        this.later(t, () => this.eventCutin(head, 1600));
        t += 1650;
        this.later(t, () => this.playPhase(ph, boardAt));
        t += 1100;
      } else if (head.k === 'item') {
        const def = ITEMS[head.kind];
        const mine = head.color === this.me && this.ctl.kind !== 'hotseat';
        const lead = mine ? 1250 : 1650;
        this.later(t, () => this.itemCutin(head, lead));
        t += lead;
        if (head.sqs.length) {
          this.later(t, () => { this.board.lockOn(head.sqs, CAT_HEX[def.cat], 450); sfx.lock(); });
          t += 550;
        }
        this.later(t, () => this.playPhase(ph, boardAt));
        t += 1100;
      } else {
        this.later(t, () => this.playPhase(ph, boardAt));
        t += ph.some(f => f.k === 'moves' || f.k === 'boom') ? 500 : 200;
      }
    });
    this.busyUntil = Date.now() + t;

    // Player strips (captures, items) update when the sequence ends so they don't spoil it.
    this.renderStatic({ strips: !this.started || t < 600 });
    this.started = true;
    this.renderHighlights();
    this.later(t + 10, () => { this.board.setMarks(this.view); this.renderStatic(); this.renderHighlights(); });
    const over = fx.find(f => f.k === 'over');
    if (over) {
      const mate = over.reason === 'checkmate';
      if (mate) this.later(t + 100, () => this.mateStamp());
      this.later(t + (mate ? 1800 : 700), () => this.showOver());
    }
    else if (view.status === 'over' && $('#overlay').hidden) this.showOver();
    this.later(t + 20, () => {
      const next = this.queue.shift();
      if (next) this.play(...next); else this.flushIdle();
    });
  }

  /** Big card over the board: who used what, and what it does. */
  callout({ icon: ic, cat, kicker, title, desc, html = '', hold = 1200, tap = false }) {
    const el = $('#callout');
    clearTimeout(this.calloutTimer);
    el.innerHTML = `<div class="co-card" style="--cat:${cat}"><span class="co-ic">${icon(ic)}</span><div style="min-width:0">
      <div class="co-k">${esc(kicker)}</div><div class="co-t">${esc(title)}</div>${desc ? `<div class="co-d">${esc(desc)}</div>` : ''}${html}
      ${tap ? '<div class="co-tap">Tap to close</div>' : ''}</div></div>`;
    el.className = 'callout';
    el.hidden = false;
    const close = () => { el.className = 'callout out'; this.calloutTimer = setTimeout(() => (el.hidden = true), 300); };
    el.onclick = close;
    this.calloutTimer = setTimeout(close, hold);
  }

  /**
   * Full-screen anime cut-in: a diagonal band slams in with speed lines, a giant piece and the move name.
   * Tap to skip.
   */
  cutin({ kind, who, name, desc, ic, cat, sting, piece, event = false, hold = 1400 }) {
    document.querySelector('.cutin')?.remove();
    const el = document.createElement('div');
    el.className = 'cutin' + (event ? ' event' : '') + (piece ? '' : ' no-piece');
    const lines = Array.from({ length: 22 }, () => `<i style="top:${(Math.random() * 100).toFixed(1)}%;left:${(Math.random() * 90).toFixed(1)}%;width:${(8 + Math.random() * 26).toFixed(1)}%"></i>`).join('');
    el.innerHTML = `<div class="ci-dim"></div><div class="ci-band" style="--cat:${cat}"><div class="ci-lines">${lines}</div>
      ${piece ? `<div class="ci-piece">${pieceInline(piece)}</div>` : ''}
      ${kind ? `<div class="ci-card">${cardSVG(kind)}<div class="shine"><i></i></div></div>` : `<div class="ci-icon">${icon(ic)}</div>`}
      <div class="ci-text"><div class="ci-who">${esc(who)}</div><div class="ci-name">${esc(name)}</div><div class="ci-desc">${esc(desc)}</div></div></div>`;
    document.body.appendChild(el);
    const q = s => el.querySelector(s);
    const band = q('.ci-band'), dim = q('.ci-dim');
    const BAND_IN = 'rotate(-7deg) translateX(0) scaleY(1)';
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'both' });
    band.animate([{ transform: 'rotate(-7deg) translateX(-105%) scaleY(.12)' }, { transform: BAND_IN }], { duration: 280, easing: 'cubic-bezier(.2,.9,.25,1.1)', fill: 'both' });
    q('.ci-lines').animate([{ transform: 'translateX(30%)' }, { transform: 'translateX(-30%)' }], { duration: 380, iterations: Infinity });
    q('.ci-piece')?.animate([{ transform: 'translateX(80vw) scale(1.4)' }, { transform: 'translateX(-14px) scale(1)', offset: 0.75 }, { transform: 'none' }], { duration: 440, delay: 80, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    q('.ci-icon')?.animate([{ transform: 'scale(0) rotate(-200deg)' }, { transform: 'none' }], { duration: 460, delay: 160, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
    // the trading card flips in, overshoots, then gets a shine sweep
    q('.ci-card')?.animate([
      { transform: 'rotateY(110deg) rotate(8deg) scale(.4)', opacity: 0 },
      { transform: 'rotateY(-14deg) rotate(-6deg) scale(1.12)', opacity: 1, offset: 0.6 },
      { transform: 'rotateY(0) rotate(-4deg) scale(1)', opacity: 1 },
    ], { duration: 560, delay: 120, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    q('.ci-card .shine i')?.animate([{ left: '-30%' }, { left: '130%' }], { duration: 420, delay: 640, easing: 'ease-in-out', fill: 'both' });
    q('.ci-name').animate([{ transform: 'skewX(-10deg) scale(2.8)', opacity: 0 }, { transform: 'skewX(-10deg) scale(1)', opacity: 1 }], { duration: 200, delay: 220, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'both' });
    [q('.ci-who'), q('.ci-desc')].forEach((n, i) => n.animate([{ opacity: 0, transform: n.classList.contains('ci-who') ? 'skewX(-10deg) translateY(8px)' : 'translateY(8px)' }, { opacity: 1, transform: n.classList.contains('ci-who') ? 'skewX(-10deg)' : 'none' }], { duration: 220, delay: 300 + i * 90, fill: 'both' }));
    sfx.charge();
    // impact frame when the name slams down
    const slam = setTimeout(() => {
      el.animate([{ filter: 'invert(1) contrast(2)' }, { filter: 'invert(1) contrast(2)', offset: 0.45 }, { filter: 'none', offset: 0.5 }, { filter: 'none' }], { duration: 150 });
      band.animate([{ transform: `${BAND_IN} translate(10px, -6px)` }, { transform: `${BAND_IN} translate(-8px, 5px)` }, { transform: BAND_IN }], { duration: 200 });
      sfx.slam();
      if (sting) sfx.sting(sting);
    }, 420);
    let gone = false;
    const exit = () => {
      if (gone) return; gone = true;
      clearTimeout(slam); clearTimeout(timer);
      band.animate([{ transform: BAND_IN }, { transform: 'rotate(-7deg) translateX(105%) scaleY(.12)' }], { duration: 240, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'forwards' });
      dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).onfinish = () => el.remove();
    };
    const timer = setTimeout(exit, Math.max(500, hold - 250));
    el.onclick = exit;
  }

  itemCutin(f, hold) {
    const def = ITEMS[f.kind];
    const who = this.ctl.label(f.color, this.me);
    const secret = def.secret && f.color !== this.me && this.ctl.kind !== 'hotseat';
    const piece = f.sqs.length && f.before?.[f.sqs[0]];
    this.cutin({
      kind: f.kind, who, name: def.name, ic: def.icon, cat: CAT_HEX[def.cat], sting: def.cat, hold,
      desc: secret ? 'A hidden mine is somewhere in the middle of the board…' : def.desc,
      piece: piece || null,
    });
  }

  eventCutin(ev, hold) {
    this.cutin({ kind: ev.id, who: 'Random event', name: ev.name, desc: ev.desc, ic: ev.icon, cat: '#1D1B18', sting: 'event', event: true, hold });
  }

  /** Manga stamp over the board (CHECK!, CHECKMATE!). */
  stamp(text, mate = false, variant = '') {
    const wrap = $('.board-wrap');
    wrap.querySelector('.stamp')?.remove();
    const el = document.createElement('div');
    el.className = 'stamp' + (mate ? ' mate' : '') + (variant ? ` ${variant}` : '');
    el.innerHTML = `<span>${esc(text)}</span>`;
    wrap.appendChild(el);
    const base = 'translate(-50%, -50%) rotate(-8deg)';
    el.animate([
      { transform: `${base} scale(3)`, opacity: 0 }, { transform: `${base} scale(.92)`, opacity: 1, offset: 0.14 },
      { transform: `${base} scale(1)`, opacity: 1, offset: 0.2 }, { transform: `${base} scale(1)`, opacity: 1, offset: 0.82 },
      { transform: `${base} scale(1.08)`, opacity: 0 },
    ], { duration: mate ? 1700 : 1000, easing: 'ease-out', fill: 'forwards' }).onfinish = () => el.remove();
  }

  mateStamp() {
    const v = this.view, k = v.result?.winner ? kingSq(v.board, other(v.result.winner)) : null;
    this.stamp('Checkmate!', true);
    this.board.impact(k, 2);
    if (k) this.vfx.mate(k);
    sfx.slam();
  }

  /** At game start, show what you were dealt so you know you have items. */
  startCallout() {
    const v = this.view, pool = MODES[v.mode].pool;
    if (!pool) return;
    const me = this.me;
    const noun = { power: 'power-ups', weapon: 'weapons', card: 'cards' }[pool];
    const chips = list => list.map(it => { const d = ITEMS[it.kind]; return `<span class="co-chip" style="--cat:${CAT[d.cat]}"><span>${icon(d.icon)}</span>${esc(d.name)}</span>`; }).join('');
    const items = this.ctl.kind === 'hotseat' ? v.inv.w : v.inv[me] || [];
    this.callout({
      icon: { power: 'sparkles', weapon: 'swords', card: 'layers' }[pool], cat: CAT[pool], hold: 4200, tap: true,
      kicker: this.ctl.kind === 'hotseat' ? `Each side starts with ${items.length} ${noun}` : `You start with ${items.length} ${noun}`,
      title: 'Your items',
      desc: `They sit under the board next to your name. On your turn, tap one to use it${pool === 'power' ? ', and grab the yellow crates to earn more' : ''}.`,
      html: `<div class="co-list">${chips(items)}</div>`,
    });
  }

  /** Fly an item icon from the board (or a square) into a player's item row. */
  flyItem(kind, fromSq, color) {
    const side = color === this.ctl.orientation(this.view) ? 'bottom' : 'top';
    const target = $(`#strip-${side} .tray, #strip-${side} .backs`);
    if (!target) return;
    const r = this.board.el.getBoundingClientRect();
    const [x0, y0] = fromSq ? this.board.screenCenter(fromSq) : [r.left + r.width / 2, r.top + r.height / 2];
    const tr = target.getBoundingClientRect();
    const x1 = tr.right - 18, y1 = tr.top + tr.height / 2;
    const d = kind && ITEMS[kind];
    const el = document.createElement('div');
    el.className = 'fly';
    el.style.setProperty('--cat', d ? CAT[d.cat] : 'var(--ink-3)');
    el.innerHTML = icon(d ? d.icon : 'gift');
    document.body.appendChild(el);
    sfx.whoosh();
    el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.3)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 40}px) scale(1.5)`, opacity: 1, offset: .3 },
      { transform: `translate(${x1}px, ${y1}px) scale(.8)`, opacity: 1 },
    ], { duration: 900, easing: 'cubic-bezier(.5,0,.3,1)' }).onfinish = () => {
      el.remove();
      target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
    };
  }

  playPhase(fx, boardAt) {
    if (fx[0]?.k === 'event') sfx.eventSfx(fx[0].id);
    const b = this.board, v = this.view, me = this.me;
    const batches = fx.filter(f => f.k === 'moves').map(f => ({ list: f.list, style: f.style }));
    const removeDelay = {};
    let soundMove = batches.length > 0, captured = false;
    for (const f of fx) {
      if (f.k === 'meteor') f.sqs.forEach((s, i) => (removeDelay[s] = 520 + i * 180));
      if (f.k === 'rocket') removeDelay[f.to] = 420;
      if (f.k === 'laser') removeDelay[f.to] = 520;
      if (f.k === 'boom' && f.kind === 'mine') f.sqs.forEach(s => (removeDelay[s] = 300));
    }
    // Mid-sequence the board shows an in-between position: only keep status marks (shield, frozen…)
    // whose piece is already where the final state has it, so bubbles never sit on the wrong piece.
    const marks = boardAt === v.board ? v.marks
      : Object.fromEntries(Object.entries(v.marks).filter(([sq]) => boardAt[sq] && boardAt[sq] === v.board[sq]));
    const apply = () => { b.setPieces(boardAt, { batches, removeDelay }); b.setMarks({ ...v, marks }); };
    if (fx.some(f => f.k === 'spin')) b.spin(apply); else apply();

    const who = c => this.ctl.label(c, me);
    for (const f of fx) {
      switch (f.k) {
        case 'start':
          this.later(500, () => this.startCallout());
          toast(this.ctl.kind === 'hotseat' ? 'Game on! White moves first.' : `Game on! You're ${COLOR_NAME[me] || 'watching'}.`, { ic: 'play' });
          sfx.notify();
          break;
        case 'moves': if (f.capture) captured = true; break;
        case 'capture': {
          captured = true;
          // plain captures stay plain; only captures made with a power get the big hit
          const item = fx.find(x => x.k === 'item');
          if (item) {
            this.vfx.capture(f.sq, { delay: 150, power: true, pal: VPAL[ITEMS[item.kind].cat] });
            this.later(170, () => b.impact(f.sq, 2));
          }
          break;
        }
        case 'check':
          sfx.check();
          if (!fx.some(x => x.k === 'over')) this.later(280, () => { this.stamp('Check!'); b.speedLines(f.sq, 1, '#E5383B'); this.vfx.check(f.sq); });
          break;
        case 'item': {
          const def = ITEMS[f.kind];
          this.recent.push(...f.sqs);
          this.recentColor = CAT_HEX[def.cat];
          f.sqs.forEach(s => b.ring(s, CAT_HEX[def.cat], 0, 2));
          if (f.kind === 'ghost' && f.sqs.length === 2) this.later(700, () => b.ring(f.sqs[1], '#FF5A36', 0, 1.8));
          if (!f.sqs.length && def.cat === 'card') { b.flash('#E6DEFF', 700); this.stamp(`${def.name}!`, false, 'card'); }
          this.signature(f);
          sfx.item(f.kind);
          break;
        }
        case 'emp':
          this.vfx.emp(f.sq, f.sqs);
          b.glow(f.sqs, '#2E6BFF', 1100);
          b.flash('#DCE6FF', 500); b.shake(4); sfx.zap();
          this.recent.push(...f.sqs); this.recentColor = '#2E6BFF';
          break;
        case 'aura': this.aura(f); this.recent.push(...f.sqs); break;
        case 'boom':
          f.sqs.forEach((s, i) => {
            const d = (f.kind === 'mine' ? 300 : f.kind === 'laser' ? 520 : f.kind === 'rocket' ? 420 : 0) + i * 70;
            if (f.kind === 'hole') { this.vfx.blackhole(s, [], { dur: 1.1, scale: 0.75 }); return; }
            this.vfx.explosion(s, { delay: d, scale: f.kind === 'rocket' || f.kind === 'mine' ? 1.25 : f.kind === 'shotgun' ? 0.8 : 1, pal: f.kind === 'laser' ? PAL.blue : PAL.fire });
            b.impact(s, f.kind === 'rocket' || f.kind === 'mine' ? 2 : 1, d);
          });
          if (f.from) b.muzzle(f.from, f.sqs);
          this.later(f.kind === 'rocket' ? 420 : f.kind === 'mine' ? 300 : 0, () => sfx.boom());
          soundMove = false;
          break;
        case 'laser': this.vfx.charge(f.from); this.vfx.beam(f.from, f.to, PAL.blue, 380); break;
        case 'rocket': b.rocket(f.to, f.color === b.orient); break;
        case 'meteor':
          f.sqs.forEach((s, i) => { this.vfx.meteor(s, 520 + i * 180); b.impact(s, 2, 520 + i * 180); this.later(520 + i * 180, () => sfx.boom()); });
          break;
        case 'shake': b.shake(9); this.later(180, () => b.shake(7)); this.later(380, () => b.shake(4)); break;
        case 'hole': this.vfx.blackhole(f.sq, f.eaten); this.later(1900, () => b.impact(f.sq, 2)); break;
        case 'portals': [f.a, f.b].forEach((s, i) => this.vfx.portal(s, PAL.violet, i * 200)); break;
        case 'portal': this.vfx.pop(f.from, PAL.violet); this.vfx.pop(f.to, PAL.violet, { delay: 260 }); break;
        case 'crate': b.ring(f.sq, '#FFC93D', 0, 1.4); break;
        case 'pickup': this.vfx.pop(f.sq, PAL.gold, { scale: 1.2 }); this.vfx.pillar(f.sq, PAL.gold); break;
        case 'gain': {
          const from = f.why === 'crate' ? fx.find(x => x.k === 'pickup')?.sq : null;
          if (f.kind && (f.color === me || this.ctl.kind === 'hotseat')) {
            const def = ITEMS[f.kind];
            const why = { crate: 'From the crate', draw: 'New item', mimic: 'Mimicked', wildcard: 'Wildcard became' }[f.why] || 'New item';
            this.later(250, () => { this.flyItem(f.kind, from, this.ctl.kind === 'hotseat' ? this.ctl.orientation(v) : f.color); sfx.gain(); });
            toast(`${why}: ${def.name}`, { ic: def.icon, color: CAT[def.cat] });
            this.later(1150, () => { $('#hand-wrap').classList.add('got-item'); this.later(1600, () => $('#hand-wrap').classList.remove('got-item')); });
          } else {
            this.later(250, () => this.flyItem(null, from, f.color));
            if (f.why === 'crate') toast(`${who(f.color)} grabbed a crate`, { ic: 'gift', color: 'var(--yellow)' });
          }
          break;
        }
        case 'bonus': {
          const what = { skip: 'skipped turn', double: 'Double Move', reverse: 'Reverse' }[f.kind] || 'bonus';
          toast(f.color === me ? `Bonus turn (${what})!` : `${who(f.color)} gets a bonus turn (${what})`, { ic: 'fast-forward', color: 'var(--violet)' });
          break;
        }
        case 'rewind': b.flash('#7B5CFF', 600); toast('Time rewound!', { ic: 'rewind', color: 'var(--coral)' }); sfx.event(); break;
        case 'toast': toast(f.text, { ic: f.icon || 'sparkle' }); break;
        case 'over': break;
      }
    }
    if (captured) sfx.capture(); else if (soundMove) sfx.move();
  }

  /** Each item's own board effect, so every power looks different. */
  signature(f) {
    const b = this.board, [a, c] = f.sqs, code = a && f.before?.[a];
    const v = this.vfx;
    const fx = {
      teleport: () => { if (a && c) { v.teleport(a, c); this.later(470, () => { b.impact(c, 1); b.speedLines(c, 1, '#FFC93D'); }); } },
      swap: () => { if (a) b.smoke(a); if (c) b.smoke(c, 60); if (a) b.log(a, 260); if (a) v.pop(a, PAL.fire, { delay: 380, scale: 0.8 }); if (c) v.pop(c, PAL.fire, { delay: 420, scale: 0.8 }); },
      clone: () => { if (c) { b.smoke(c, 0, 0.9); v.magic(c, PAL.fire, { R: 0.7, life: 0.9 }); v.pop(c, PAL.gold, { delay: 250 }); b.speedLines(c, 1, '#FF5A36'); } },
      ghost: () => { if (a && c && code) b.afterimages(a, c, code); if (a) v.magic(a, PAL.violet, { R: 0.7, n: 5, life: 0.8 }); if (c) v.pop(c, PAL.violet, { delay: 650 }); },
      mind: () => { if (a) { b.spiral(a); v.magic(a, PAL.violet, { R: 1.05, n: 5, spin: -2.2, life: 1.3 }); v.aura(a, PAL.violet); b.speedLines(a, 1, '#7B5CFF'); } },
      shield: () => { if (a) { b.hexShield(a); v.magic(a, PAL.blue, { R: 0.85, life: 1.2 }); v.pop(a, PAL.blue); } },
      freeze: () => { if (a) v.ice(a); },
      resurrect: () => { if (a) { v.shadowRise(a); this.later(650, () => this.stamp('Arise!', false, 'shadow')); } },
      evolve: () => { if (a) { v.aura(a, PAL.gold); v.pillar(a, PAL.fire, 300); this.later(450, () => { b.impact(a, 1); v.explosion(a, { scale: 0.7, pal: PAL.gold, dim: 0.45 }); }); } },
      steal: () => { if (a) { b.spiral(a, '#FF5A36'); v.magic(a, PAL.red, { R: 1, n: 5, spin: -2, life: 1.1 }); v.aura(a, PAL.red); } },
      emp: () => {},
      mine: () => { if (a) v.magic(a, PAL.red, { R: 0.6, n: 5, life: 0.9 }); },
    };
    fx[f.kind]?.();
  }

  aura(f) {
    const b = this.board;
    const map = {
      shield: () => f.sqs.forEach(s => { b.ring(s, '#2E6BFF', 0, 1.3); b.ring(s, '#2E6BFF', 150, 1.8); }),
      freeze: () => f.sqs.forEach(s => b.burst(s, ['#8FC8FF', '#FFFFFF', '#2E6BFF'], 14, 0.9)),
      clone: () => f.sqs.forEach(s => b.burst(s, ['#7B5CFF', '#FFFFFF'], 10)),
      mind: () => f.sqs.forEach(s => { b.ring(s, '#7B5CFF', 0, 1.6); b.ring(s, '#7B5CFF', 160, 2.2); }),
      revive: () => f.sqs.forEach(s => b.burst(s, ['#1F9D6B', '#FFFFFF', '#FFC93D'], 14)),
      evolve: () => f.sqs.forEach(s => b.burst(s, ['#FFC93D', '#FF5A36', '#FFFFFF'], 14, 1.2)),
      mine: () => f.sqs.forEach(s => b.ring(s, '#E5383B', 0, 1.2)),
      steal: () => f.sqs.forEach(s => { b.ring(s, '#FF5A36', 0, 1.8); b.burst(s, ['#FF5A36', '#1D1B18'], 10); }),
      zombie: () => { f.sqs.forEach((s, i) => this.vfx.shadowRise(s, i * 250)); if (f.sqs.length) this.later(800, () => this.stamp('Arise!', false, 'shadow')); },
      mutate: () => f.sqs.forEach((s, i) => { this.vfx.magic(s, PAL.green, { R: 0.9, n: 5, delay: i * 200 }); this.vfx.pop(s, PAL.green, { delay: 300 + i * 200 }); }),
      reverse: () => b.flash('#E6DEFF', 500),
      skip: () => b.flash('#E6DEFF', 500),
      double: () => b.flash('#E6DEFF', 500),
    };
    map[f.kind]?.();
  }

  // ------------------------------------------------------------ static UI
  renderStatic({ strips = true } = {}) {
    const v = this.view, me = this.me, orient = this.ctl.orientation(v);
    this.computeHand();
    if (strips) {
      this.renderStrip($('#strip-top'), other(orient));
      this.renderStrip($('#strip-bottom'), orient);
    }
    this.renderTurn();
    this.renderHand();
    this.renderLog();
    this.renderActions();
    this.ctl.renderNotice?.(this);
    this.legal = this.myTurn ? legalMoves(v, me) : [];
  }

  renderStrip(el, c) {
    const v = this.view, info = this.ctl.player(c, this.me);
    const lost = v.captured[other(c)];
    const order = 'qrbnp';
    const glyphs = [...lost].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(t => pieceInline(other(c) + t)).join('');
    const mat = x => v.captured[x].reduce((s, t) => s + VALUE[t], 0);
    const adv = mat(other(c)) - mat(c);
    const hidden = this.ctl.kind !== 'hotseat' && c !== this.me && MODES[v.mode].pool;
    const cat = { power: 'var(--coral)', weapon: 'var(--blue)', card: 'var(--violet)' }[MODES[v.mode].pool];
    const backs = hidden ? `<div class="backs" title="${v.inv[c].length} item(s)" style="--cat:${cat}">${v.inv[c].map(() => '<i></i>').join('')}</div>` : '';
    const showTray = MODES[v.mode].pool && (this.ctl.kind === 'hotseat' ? c === this.ctl.orientation(v) : c === this.me);
    const tray = showTray ? `<div class="tray">${(this.handState || []).map(h => `<button class="tray-it ${h.def.cat}${h.usable ? ' ready' : ' off'}${h.fresh ? ' drawn' : ''}${this.pick?.item.id === h.it.id ? ' active' : ''}" data-tray="${h.it.id}" aria-disabled="${!h.usable}" title="${esc(h.def.name)}: ${esc(h.def.desc)} (hold for details)" aria-label="${esc(h.def.name)}">${icon(h.def.icon)}</button>`).join('')}</div>` : '';
    const turn = v.status === 'playing' && v.turn === c
      ? (c === this.me || this.ctl.kind === 'hotseat' ? '<span class="turn-pill"><i></i>To move</span>' : `<span class="turn-pill think"><span class="waiting-dots"><i></i><i></i><i></i></span>${info.thinking}</span>`)
      : '';
    el.innerHTML = `
      <span class="avatar ${c}">${pieceInline(c + 'k')}</span>
      <div class="who"><span class="name">${esc(info.name)}</span><span class="sub">${info.status}</span></div>
      <div class="right"><div class="captured">${glyphs}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</div>${backs}${tray}${turn}</div>`;
    $$('[data-tray]', el).forEach(btn => {
      const h = () => this.handState.find(x => x.it.id === +btn.dataset.tray);
      // tap = use (or details if it can't be used right now), hold = details
      let hold = null, held = false;
      btn.onpointerdown = () => { held = false; clearTimeout(hold); hold = setTimeout(() => { held = true; this.itemInfo(h()); }, 450); };
      btn.onpointerup = btn.onpointerleave = btn.onpointercancel = () => clearTimeout(hold);
      btn.oncontextmenu = e => e.preventDefault();
      btn.onclick = () => {
        if (held) return;
        const x = h();
        if (x?.usable) this.startPick(x.it, $(`#hand [data-item="${x.it.id}"]`)); else this.itemInfo(x);
      };
    });
  }

  renderTurn() {
    const v = this.view, me = this.me, el = $('#turn-card');
    let t, s, mine = false, glyph = pieceInline(v.turn + 'k');
    if (v.status === 'over') {
      const r = v.result;
      t = r.winner ? (this.ctl.kind === 'hotseat' || !me ? `${COLOR_NAME[r.winner]} wins` : r.winner === me ? 'You win!' : 'You lost') : 'Draw';
      s = r.reason[0].toUpperCase() + r.reason.slice(1);
      glyph = icon(r.winner ? 'crown' : 'flag');
    } else if (this.ctl.kind === 'hotseat') {
      mine = true;
      t = `${COLOR_NAME[v.turn]} to move`;
      s = inCheck(v, v.turn) ? 'Check! Protect your king.' : v.bonus ? 'Bonus turn' : `Move ${v.full} · pass the device`;
    } else if (v.turn === me && this.busy && this.lastActor && this.lastActor !== me) {
      t = `${this.ctl.player(this.lastActor, me).name} is playing…`;
      s = 'Watch what happens';
    } else if (v.turn === me) {
      mine = true;
      t = inCheck(v, me) ? 'Check!' : v.bonus ? 'Bonus turn!' : 'Your move';
      const ready = (this.handState || []).filter(h => h.usable).length;
      const noun = { power: 'power-up', weapon: 'weapon', card: 'card' }[MODES[v.mode].pool];
      s = inCheck(v, me) ? 'Get your king out of danger' : v.bonus?.kind === 'double' ? 'Second move: a different piece'
        : ready ? `Move a piece, or use a ${noun} (${ready} ready)` : `Move ${v.full} · you play ${COLOR_NAME[me]}`;
    } else {
      t = me ? `${this.ctl.player(v.turn, me).name} is thinking` : `${COLOR_NAME[v.turn]} to move`;
      s = `Move ${v.full}`;
    }
    const changed = el.dataset.t !== t;
    el.dataset.t = t;
    el.className = 'turn-card' + (mine ? ' mine' : '') + (changed ? ' pulse' : '');
    el.innerHTML = `<span class="tc-ic">${glyph}</span><div><div class="tc-t">${esc(t)}</div><div class="tc-s">${esc(s)}</div></div>`;
  }

  computeHand() {
    const v = this.view, me = this.me;
    const items = (me && MODES[v.mode].pool && v.inv[me]) || [];
    this.handBlock = me ? (v.status !== 'playing' ? 'Game over' : v.turn !== me ? 'Wait for your turn' : this.busy ? 'Wait for the animation…' : itemAllowed(v, me)) : 'Spectating';
    const seen = this.seenItems;
    this.handState = items.map(it => ({ it, def: ITEMS[it.kind], fresh: !!seen && !seen.has(it.id), usable: !this.handBlock && !this.pending && itemUsable(v, me, it.kind) }));
  }

  renderHand() {
    const v = this.view, me = this.me, hand = $('#hand');
    if (!MODES[v.mode].pool) return;
    this.hidePeek();
    const items = (me && v.inv[me]) || [];
    const title = { power: 'Your power-ups', weapon: 'Your weapons', card: 'Your hand' }[MODES[v.mode].pool];
    $('#hand-title').textContent = this.ctl.kind === 'hotseat' ? `${COLOR_NAME[me]}'s items` : title;
    const block = this.handBlock;
    $('#hand-hint').textContent = items.length ? (block || 'Tap to use · hover for details') : '';
    hand.innerHTML = items.length ? this.handState.map(({ it, usable, fresh }) => {
      const d = ITEMS[it.kind];
      return `<div class="item-slot" data-slot="${it.id}"><button class="item ${d.cat}${fresh ? ' drawn' : ''}${usable ? '' : ' off'}${this.pick?.item.id === it.id ? ' active' : ''}" data-item="${it.id}" aria-disabled="${!usable}">
        <span class="i-art">${cardSVG(it.kind, { thumb: true })}</span>
        <span class="i-top"><span class="i-name">${esc(d.name)}</span>${d.free ? '<span class="i-free">Free</span>' : ''}</span>
        <span class="i-desc">${esc(d.desc)}</span></button>
        <button class="i-more" data-more="${it.id}" aria-label="More about ${esc(d.name)}" title="Read more">${icon('info')}</button></div>`;
    }).join('') : `<div class="hand-empty">${v.mode === 'chaos' ? 'Grab crates on the board to earn power-ups.' : 'No items right now. More arrive every few turns.'}</div>`;
    this.seenItems = new Set(items.map(i => i.id));
    const find = id => this.handState.find(h => h.it.id === +id);
    $$('.item', hand).forEach(btn => (btn.onclick = () => {
      const h = find(btn.dataset.item);
      if (h?.usable) this.startPick(h.it, btn); else if (h) this.itemInfo(h);
    }));
    $$('.i-more', hand).forEach(btn => (btn.onclick = e => { e.stopPropagation(); this.hidePeek(); this.itemInfo(find(btn.dataset.more)); }));
    $$('.item-slot', hand).forEach(slot => {
      slot.onpointerenter = e => { if (e.pointerType === 'mouse') this.showPeek(find(slot.dataset.slot).it.kind, slot); };
      slot.onpointerleave = () => this.hidePeek();
    });
  }

  /** Hover preview next to a hand card: the full trading card plus how to use it. */
  showPeek(kind, anchor) {
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => {
      const d = ITEMS[kind], t = TIPS[kind] || {};
      let el = $('#peek');
      if (!el) { el = document.createElement('div'); el.id = 'peek'; el.className = 'peek'; document.body.appendChild(el); }
      el.style.setProperty('--cat', CAT[d.cat]);
      el.innerHTML = `<div class="peek-card">${cardSVG(kind)}</div>
        <div class="peek-body"><div class="peek-turn">${d.free ? `${icon('fast-forward')}Free action: you still move after` : `${icon('clock')}Uses your turn`}</div>
        <p class="peek-desc">${esc(d.desc)}</p>${t.how ? `<h5>How to use</h5><p>${esc(t.how)}</p>` : ''}${t.tip ? `<h5>Good to know</h5><p>${esc(t.tip)}</p>` : ''}</div>`;
      el.hidden = false;
      const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      const left = r.left - w - 14 >= 8 ? r.left - w - 14 : Math.min(r.right + 14, innerWidth - w - 8);
      const top = Math.max(8, Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 8));
      el.style.left = `${left}px`; el.style.top = `${top}px`;
      el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    }, 260);
  }

  hidePeek() {
    clearTimeout(this.peekTimer);
    const el = $('#peek');
    if (el) el.hidden = true;
  }

  /** "Read more" panel for an item in your hand. */
  itemInfo(h) {
    if (!h) return;
    const d = h.def, t = TIPS[h.it.kind] || {}, kind = { power: 'Power-up', weapon: 'Weapon', card: 'Card' }[d.cat];
    const why = !h.usable && (this.handBlock || 'No valid targets right now');
    const { card, close } = modal(`<div class="info" style="--cat:${CAT[d.cat]}">
      <div class="info-card">${cardSVG(h.it.kind)}</div>
      <div class="info-body">
        <div class="info-chips"><span class="chip cat">${kind}</span><span class="chip">${d.free ? `${icon('fast-forward')}Free action` : `${icon('clock')}Uses your turn`}</span></div>
        <h2>${esc(d.name)}</h2>
        <p class="info-desc">${esc(d.desc)}</p>
        ${t.how ? `<h5>How to use</h5><p>${esc(t.how)}</p>` : ''}
        ${t.tip ? `<h5>Good to know</h5><p>${esc(t.tip)}</p>` : ''}
        ${d.free ? '<p class="muted small">Free actions don’t end your turn. Use it, then make your normal move.</p>' : ''}
        <div class="info-actions">${h.picking ? '<button class="btn btn-primary" data-ok>Got it</button>' : h.usable ? `<button class="btn btn-primary" data-use>${icon(d.icon)}Use it</button>` : `<span class="info-why">${icon('clock')}${esc(why)}</span>`}</div>
      </div></div>`);
    const ok = $('[data-ok]', card);
    if (ok) ok.onclick = () => close();
    const use = $('[data-use]', card);
    if (use) use.onclick = () => { close(); this.startPick(h.it, $(`#hand [data-item="${h.it.id}"]`)); };
    sfx.click();
  }

  renderLog() {
    const v = this.view, log = $('#log');
    if (!v.history.length) { log.innerHTML = '<li class="log-empty">No moves yet.</li>'; return; }
    let n = 0, html = '';
    v.history.forEach((h, i) => {
      if (h.color === 'w' && !h.item) html += `<li class="n">${++n}.</li>`;
      else if (i === 0 && h.color === 'b') html += `<li class="n">1…</li>`;
      const it = h.item && ITEMS[h.item];
      html += `<li class="m${it ? ' item-entry' : ''}${i === v.history.length - 1 ? ' latest' : ''}" style="${it ? `color:${CAT[it.cat]}` : ''}">${it ? icon(it.icon) : ''}${esc(h.text)}</li>`;
    });
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }

  renderActions() {
    const v = this.view, el = $('#side-actions');
    if (v.status === 'over') {
      el.innerHTML = this.ctl.kind === 'online'
        ? `<button class="btn btn-primary" data-g="rematch">${icon('rotate-ccw')}Rematch</button><button class="btn btn-ghost" data-g="home">${icon('log-out')}Leave</button>`
        : `<button class="btn btn-primary" data-g="again">${icon('rotate-ccw')}Play again</button><button class="btn btn-ghost" data-g="home">${icon('log-out')}Home</button>`;
    } else if (this.ctl.kind === 'online' && !this.me) {
      el.innerHTML = '';
    } else {
      el.innerHTML = `<button class="btn btn-ghost" data-g="resign">${icon('flag')}Resign</button>`
        + `<button class="btn btn-ghost" data-g="${this.ctl.kind === 'online' ? 'offer' : 'again'}">${icon('rotate-ccw')}${this.ctl.kind === 'online' ? 'Offer restart' : 'Restart'}</button>`;
    }
    $$('[data-g]', el).forEach(b => (b.onclick = () => this.gameAction(b.dataset.g)));
  }

  async gameAction(a) {
    if (a === 'resign') {
      if (await confirmBox('Resign this game?', 'Your opponent will be declared the winner.', 'Resign')) this.ctl.send({ type: 'resign' }, this.me);
    } else if (a === 'again') {
      if (this.view.status === 'playing' && !(await confirmBox('Restart?', 'The current game will be lost.', 'Restart'))) return;
      this.ctl.restart();
    } else if (a === 'rematch' || a === 'offer') {
      this.ctl.rematch();
    } else if (a === 'home') {
      leaveGame();
    }
  }

  showOver() {
    const v = this.view, me = this.me, r = v.result;
    if (!r) return;
    const solo = this.ctl.kind === 'hotseat' || !me;
    const win = r.winner && r.winner === me;
    const title = r.reason === 'checkmate' ? 'Checkmate!' : r.reason === 'resignation' ? 'Resigned' : r.reason === 'opponent left' ? 'Opponent left' : r.winner ? 'Game over' : 'Draw';
    const sub = !r.winner ? `By ${r.reason}.` : solo ? `${COLOR_NAME[r.winner]} wins.` : win ? 'You win. Nicely played!' : `${this.ctl.player(r.winner, me).name} wins.`;
    const cls = !r.winner ? 'draw' : solo || win ? '' : 'lose';
    const el = $('#overlay');
    el.innerHTML = `<div class="over-card"><div class="trophy ${cls}">${icon(r.winner ? (cls === 'lose' ? 'flag' : 'crown') : 'swords')}</div>
      <h2>${title}</h2><p>${esc(sub)}</p><div class="row">
      ${this.ctl.kind === 'online' ? `<button class="btn btn-primary btn-lg" data-o="rematch">${icon('rotate-ccw')}<span>${this.ctl.rematchLabel()}</span></button>`
        : `<button class="btn btn-primary btn-lg" data-o="again">${icon('rotate-ccw')}Play again</button>`}
      <button class="btn btn-ghost btn-lg" data-o="look">Look at the board</button></div></div>`;
    el.hidden = false;
    $$('[data-o]', el).forEach(b => (b.onclick = () => {
      if (b.dataset.o === 'look') { el.hidden = true; return; }
      this.gameAction(b.dataset.o);
    }));
    if (solo || win) { sfx.win(); if (r.winner) { const k = kingSq(v.board, r.winner); this.board.burst(k, ['#FFC93D', '#FF5A36', '#1F9D6B', '#2E6BFF'], 22, 2); } } else sfx.lose();
  }

  // ------------------------------------------------------------ interaction
  canDrag(sq) {
    if (!this.myTurn || this.pick || Date.now() < this.busyUntil - 300) return false;
    const p = this.view.board[sq];
    return !!p && p[0] === this.me && this.legal.some(m => m.from === sq);
  }

  onSquare(sq, { dragStart } = {}) {
    if (!this.myTurn) return;
    const v = this.view;
    if (this.pick) {
      const s = this.pick.step;
      if (s && !s.choices && s.targets.includes(sq)) this.advancePick(sq);
      else $('#prompt').animate([{ transform: 'translate(-50%, -100%)' }, { transform: 'translate(calc(-50% - 6px), -100%)' }, { transform: 'translate(calc(-50% + 6px), -100%)' }, { transform: 'translate(-50%, -100%)' }], { duration: 260 });
      return;
    }
    if (this.sel && !dragStart && this.legal.some(m => m.from === this.sel && m.to === sq)) { this.tryMove(this.sel, sq); return; }
    const p = v.board[sq];
    if (p && p[0] === this.me && this.legal.some(m => m.from === sq)) {
      this.sel = dragStart || this.sel !== sq ? sq : null;
      if (this.sel) sfx.click();
    } else {
      if (p && p[0] === this.me && v.marks[sq]?.frozen > v.ply) toast('That piece is frozen!', { ic: 'snowflake' });
      this.sel = null;
    }
    this.renderHighlights();
  }

  onDrop(from, to) {
    if (!this.legal.some(m => m.from === from && m.to === to)) { this.sel = from; this.renderHighlights(); return false; }
    this.tryMove(from, to);
    return true;
  }

  tryMove(from, to) {
    const options = this.legal.filter(m => m.from === from && m.to === to);
    if (options.some(m => m.promotion)) {
      const c = this.me;
      this.choose('Promote to…', ['q', 'r', 'b', 'n'].map(t => ({ value: t, html: pieceInline(c + t), label: NAMES[t] })), t => this.send({ type: 'move', from, to, promotion: t }), () => {
        this.board.setPieces(this.view.board, { instant: true });
        this.sel = null; this.renderHighlights();
      });
      return;
    }
    this.send({ type: 'move', from, to });
  }

  send(action) {
    this.sel = null;
    this.pick = null;
    $('#prompt').hidden = $('#popover').hidden = true;
    if (this.ctl.kind === 'online') this.pending = true;
    this.ctl.send(action, this.me);
  }

  renderHighlights() {
    const v = this.view;
    if (!v) return;
    const check = v.status === 'playing' && inCheck(v, v.turn) ? kingSq(v.board, v.turn) : null;
    const hl = { last: v.lastMove, check, recent: this.recent, recentColor: this.recentColor };
    if (this.pick) {
      const def = ITEMS[this.pick.item.kind];
      hl.cat = CAT[def.cat];
      hl.targets = this.pick.step && !this.pick.step.choices ? this.pick.step.targets : [];
      hl.picked = this.pick.picks.filter(p => p.length === 2);
    } else if (this.sel) {
      hl.sel = this.sel;
      hl.moves = this.legal.filter(m => m.from === this.sel).map(m => ({ to: m.to, cap: !!m.captured }));
    }
    this.board.setHighlights(hl);
  }

  // ------------------------------------------------------------ items
  startPick(item, btn) {
    if (!item || !this.myTurn) return;
    if (this.pick?.item.id === item.id) { this.cancelPick(); return; }
    this.sel = null;
    this.hidePeek();
    this.pick = { item, picks: [], step: itemStep(this.view, this.me, item.kind, []), btn };
    $$('.item').forEach(b => b.classList.toggle('active', b === btn));
    $$('.tray-it').forEach(b => b.classList.toggle('active', +b.dataset.tray === item.id));
    sfx.click();
    this.renderPick();
  }

  advancePick(value) {
    const p = this.pick;
    p.picks.push(value);
    p.step = itemStep(this.view, this.me, p.item.kind, p.picks);
    sfx.click();
    if (!p.step) this.commitPick(); else this.renderPick();
  }

  commitPick() {
    const p = this.pick;
    p.btn?.classList.add('played');
    $('#popover').hidden = true;
    this.send({ type: 'item', id: p.item.id, picks: p.picks });
  }

  cancelPick() {
    this.pick = null;
    $('#prompt').hidden = $('#popover').hidden = true;
    $$('.item, .tray-it').forEach(b => b.classList.remove('active'));
    this.renderHighlights();
  }

  renderPick() {
    const p = this.pick, def = ITEMS[p.item.kind], s = p.step;
    const pr = $('#prompt');
    pr.style.setProperty('--cat', CAT[def.cat]);
    const text = s ? `${def.name}: ${s.prompt}` : `Play ${def.name}?`;
    pr.innerHTML = `<span class="p-ic">${icon(def.icon)}</span><span class="p-txt">${esc(text)}</span>
      <button class="btn btn-x btn-info" data-p="info" aria-label="What does ${esc(def.name)} do?" title="What does this do?">${icon('info')}</button>${s ? '' : `<button class="btn btn-go" data-p="go">Play</button>`}<button class="btn btn-x" data-p="x">Cancel</button>`;
    pr.hidden = false;
    $('[data-p="x"]', pr).onclick = () => this.cancelPick();
    $('[data-p="info"]', pr).onclick = () => this.itemInfo({ it: p.item, def, usable: false, picking: true });
    const go = $('[data-p="go"]', pr);
    if (go) go.onclick = () => this.commitPick();
    if (s && !s.targets.length) { toast('No valid targets for that', { ic: def.icon }); this.cancelPick(); return; }
    if (s?.choices) {
      const html = c => (c.value.length === 1 ? pieceInline(this.me + c.value) : icon(ITEMS[c.value]?.icon || 'sparkle'));
      this.choose(s.prompt, s.choices.map(c => ({ value: c.value, label: c.label, html: html(c) })), v => this.advancePick(v), () => this.cancelPick());
    } else $('#popover').hidden = true;
    this.renderHighlights();
  }

  choose(title, choices, onPick, onCancel) {
    const el = $('#popover');
    el.innerHTML = `<h4>${esc(title)}</h4><div class="choices">${choices.map((c, i) => `<button class="choice" data-i="${i}">${c.html}<span>${esc(c.label)}</span></button>`).join('')}</div>
      <button class="link" style="margin-top:12px;font-size:13px" data-cancel>Cancel</button>`;
    el.hidden = false;
    $$('.choice', el).forEach(b => (b.onclick = () => { el.hidden = true; onPick(choices[+b.dataset.i].value); }));
    $('[data-cancel]', el).onclick = () => { el.hidden = true; onCancel?.(); };
  }
}

// =====================================================================
// Controllers
// =====================================================================
class LocalCtl {
  constructor(mode, kind) {
    this.mode = mode;
    this.kind = kind; // 'bot' | 'hotseat'
    this.humanColor = 'w';
    this.st = newGame(mode);
  }
  perspective(v) { return this.kind === 'hotseat' ? v?.turn || 'w' : this.humanColor; }
  orientation() { return this.kind === 'hotseat' ? 'w' : this.humanColor; }
  label(c, me) { return this.kind === 'hotseat' ? COLOR_NAME[c] : c === me ? 'You' : 'Computer'; }
  player(c) {
    if (this.kind === 'hotseat') return { name: COLOR_NAME[c], status: 'Same device', thinking: '' };
    return c === this.humanColor
      ? { name: myName(), status: `<span class="status-dot on"></span>You · ${COLOR_NAME[c]}`, thinking: '' }
      : { name: 'Computer', status: `${icon('bot', 13)}Bot · ${COLOR_NAME[c]}`, thinking: 'Thinking' };
  }
  view() { return viewFor(this.st, this.kind === 'hotseat' ? this.st.turn : this.humanColor, { reveal: this.kind === 'hotseat' }); }
  start(gv) { this.gv = gv; gv.update(this.view(), [{ k: 'start' }]); this.botLoop(); }

  send(action, color) {
    const c = this.kind === 'hotseat' ? this.st.turn : color;
    if (action.type === 'resign') this.resigner = c;
    const scratch = structuredClone(this.st);
    let fx;
    try { fx = applyAction(scratch, c, action); } catch (e) { toast(e.message, { ic: 'x' }); this.gv.update(this.view(), []); return; }
    this.st = scratch;
    const shown = this.kind === 'hotseat' ? fx.map(({ pub, ...f }) => f) : fxFor(fx, this.humanColor);
    this.gv.update(this.view(), shown);
    this.botLoop();
  }

  botLoop() {
    if (this.kind !== 'bot') return;
    clearTimeout(this.botTimer);
    const bc = other(this.humanColor);
    if (this.st.status !== 'playing' || this.st.turn !== bc) return;
    const token = (this.botToken = {});
    this.gv.whenIdle(() => {
      if (token !== this.botToken) return;
      this.botTimer = setTimeout(() => this.botAct(bc), 800);
    });
  }

  botAct(bc) {
    if (this.st.turn !== bc || this.st.status !== 'playing') return;
    const usedItem = this.botItemPly === this.st.ply;
    const a = botAction(this.st, bc, { usedItem });
    if (!a) return;
    if (a.type === 'item') this.botItemPly = this.st.ply;
    this.send(a, bc);
  }

  restart() {
    clearTimeout(this.botTimer);
    if (this.kind === 'bot') this.humanColor = other(this.humanColor);
    this.st = newGame(this.mode);
    this.gv.update(this.view(), [{ k: 'start' }]);
    this.botLoop();
  }
  rematch() { this.restart(); }
  destroy() { clearTimeout(this.botTimer); }
}

class OnlineCtl {
  constructor(session) { this.s = session; this.kind = 'online'; this.mode = session.mode; }
  perspective() { return this.s.color; }
  orientation() { return this.s.color || 'w'; }
  label(c, me) { return c === me ? 'You' : this.seat(c)?.name || COLOR_NAME[c]; }
  seat(c) { return this.s.room?.seats?.[c]; }
  player(c, me) {
    const seat = this.seat(c);
    const name = seat?.name || COLOR_NAME[c];
    if (c === me) return { name, status: `<span class="status-dot on"></span>You · ${COLOR_NAME[c]}`, thinking: '' };
    const on = seat?.connected;
    return { name, status: `<span class="status-dot ${on ? 'on' : 'off'}"></span>${on ? 'Online' : 'Disconnected'} · ${COLOR_NAME[c]}`, thinking: 'Thinking' };
  }
  send(action) { if (!this.s.net.send({ t: 'act', action })) { toast('Not connected — reconnecting…', { ic: 'wifi-off' }); gv.pending = false; } }
  rematch() {
    const want = !this.seat(this.s.color)?.rematch;
    this.s.net.send({ t: 'rematch', want });
  }
  rematchLabel() {
    const me = this.seat(this.s.color), opp = this.seat(other(this.s.color || 'w'));
    if (me?.rematch) return 'Waiting for opponent…';
    if (opp?.rematch) return 'Accept rematch';
    return 'Rematch';
  }
  restart() { this.rematch(); }
  renderNotice() {
    const el = $('#notice'), me = this.s.color;
    const v = gv?.view;
    if (!me || !v) { el.hidden = true; return; }
    const opp = this.seat(other(me)), mine = this.seat(me);
    clearTimeout(this.noticeTimer);
    let html = '';
    if (this.s.status === 'reconnecting') html = `${icon('wifi-off', 18)}<span>Connection lost. Reconnecting…</span>`;
    else if (opp && !opp.connected && v.status === 'playing') {
      const left = Math.ceil((opp.claimAfter - opp.away - (Date.now() - this.s.roomAt)) / 1000);
      html = `${icon('wifi-off', 18)}<span>${esc(opp.name)} disconnected.${left > 0 ? ` You can claim the win in ${left}s.` : ''}</span>${left > 0 ? '' : '<button class="btn btn-ink btn-sm" data-n="claim">Claim win</button>'}`;
      this.noticeTimer = setTimeout(() => this.renderNotice(), 1000);
    } else if (!opp && v.status === 'playing') html = `${icon('users', 18)}<span>Waiting for your opponent to return…</span>`;
    else if (opp?.rematch && !mine?.rematch) html = `${icon('rotate-ccw', 18)}<span>${esc(opp.name)} wants to ${v.status === 'over' ? 'play again' : 'restart'}.</span><button class="btn btn-primary btn-sm" data-n="accept">Accept</button>`;
    else if (mine?.rematch) html = `${icon('clock', 18)}<span>Waiting for ${esc(opp?.name || 'opponent')} to accept…</span><button class="btn btn-ghost btn-sm" data-n="cancel">Cancel</button>`;
    el.innerHTML = html;
    el.hidden = !html;
    const b = $('[data-n]', el);
    if (b) b.onclick = () => {
      if (b.dataset.n === 'claim') this.s.net.send({ t: 'claim' });
      else this.s.net.send({ t: 'rematch', want: b.dataset.n === 'accept' });
    };
  }
  destroy() { clearTimeout(this.noticeTimer); }
}

// =====================================================================
// App flow
// =====================================================================
let mainBoard = null; // one Board instance, reused across games
let mainVfx = null;
let gv = null;       // current GameView
let ctl = null;      // current controller
let session = null;  // online session { net, id, color, mode, room, status }

function openGame(controller) {
  gv?.destroy();
  ctl?.destroy?.();
  ctl = controller;
  show('game');
  gv = new GameView(ctl);
}

async function startLocal(mode, kind = 'bot') {
  endSession();
  if (location.pathname !== '/') history.pushState({}, '', '/');
  veil(kind === 'bot' ? 'Setting up the board…' : 'Pass & play — get ready…');
  await sleep(380);
  openGame(new LocalCtl(mode, kind));
  ctl.start(gv);
  await unveil();
}

async function leaveGame() {
  if (ctl?.kind === 'online' && gv?.view?.status === 'playing' && session?.color) {
    if (!(await confirmBox('Leave the game?', 'Leaving now forfeits the game.', 'Leave'))) return;
    session.net.send({ t: 'leave' });
  } else if (ctl && ctl.kind !== 'online' && gv?.view?.status === 'playing' && gv.view.history.length > 2) {
    if (!(await confirmBox('Leave the game?', 'Your current game will be lost.', 'Leave'))) return;
  }
  goHome();
}

function goHome() {
  endSession();
  gv?.destroy(); gv = null;
  ctl?.destroy?.(); ctl = null;
  if (location.pathname !== '/') history.pushState({}, '', '/');
  show('home');
}

function endSession() {
  if (!session) return;
  session.net.close();
  session = null;
}

// ---------------------------------------------------------------- online
function createRoom(mode) {
  endSession();
  veil('Creating your room…');
  const net = new Net({
    onOpen: () => net.send({ t: 'create', mode }),
    onMessage: msg => {
      if (msg.t === 'created') { net.close(); history.pushState({}, '', `/r/${msg.id}`); joinRoom(msg.id); }
    },
    onStatus: s => { if (s === 'reconnecting') { net.close(); unveil(); toast('Couldn’t reach the server', { ic: 'wifi-off' }); } },
  });
}

function joinRoom(id) {
  endSession();
  veil('Joining room…');
  const key = `yc-t-${id}`;
  let token = store.get(key);
  if (!token) { token = rid(); store.set(key, token); }
  const s = (session = { id, token, color: null, mode: null, room: null, status: 'connecting' });
  s.net = new Net({
    onOpen: () => s.net.send({ t: 'join', room: id, token, name: myName() }),
    onStatus: st => { s.status = st; if (ctl?.kind === 'online') ctl.renderNotice(); if (st === 'reconnecting' && !$('#lobby').hidden) renderLobby(); },
    onMessage: msg => onRoomMessage(s, msg),
  });
}

function onRoomMessage(s, msg) {
  if (s !== session) return;
  switch (msg.t) {
    case 'joined':
      s.color = msg.color;
      s.mode = msg.mode;
      break;
    case 'room': {
      const prev = s.room;
      s.room = msg;
      s.roomAt = Date.now();
      s.mode = msg.mode;
      if (!msg.started) {
        if ($('#lobby').hidden) { show('lobby'); unveil(); }
        const opp = msg.seats[other(s.color || 'w')];
        if (prev && s.color && opp && !prev.seats[other(s.color)]) { toast(`${opp.name} joined!`, { ic: 'users', color: 'var(--green)' }); sfx.notify(); }
        renderLobby();
      } else if (gv && ctl?.kind === 'online') {
        gv.renderStrip($('#strip-top'), other(ctl.orientation()));
        gv.renderStrip($('#strip-bottom'), ctl.orientation());
        gv.renderActions();
        ctl.renderNotice();
        if (!$('#overlay').hidden && gv.view?.status === 'over') { const b = $('[data-o="rematch"] span'); if (b) b.textContent = ctl.rematchLabel(); }
        const opp = msg.seats[other(s.color || 'w')], was = prev?.seats?.[other(s.color || 'w')];
        if (opp && was && opp.connected !== was.connected) toast(opp.connected ? `${opp.name} reconnected` : `${opp.name} disconnected`, { ic: opp.connected ? 'wifi' : 'wifi-off' });
        if (opp?.rematch && !was?.rematch) sfx.notify();
      }
      break;
    }
    case 'state':
      if (!gv || ctl?.kind !== 'online') {
        openGame(new OnlineCtl(s));
        unveil();
      }
      gv.update(msg.view, msg.fx);
      break;
    case 'error':
      if (msg.code === 'rejected') { toast(msg.msg, { ic: 'x' }); break; }
      endSession();
      unveil();
      modal(`<h2>${msg.code === 'no-room' ? 'Room not found' : 'Disconnected'}</h2><p class="muted">${esc(msg.msg)}</p>
        <div class="stack" style="margin-top:18px"><button class="btn btn-primary btn-lg" data-x>Back to home</button></div>`, { onClose: goHome })
        .card.querySelector('[data-x]').onclick = () => { $('#modal').hidden = true; goHome(); };
      break;
  }
}

function inviteUrl() { return `${location.origin}/r/${session?.id || ''}`; }

function renderLobby() {
  const s = session, r = s?.room;
  if (!r) return;
  $('#lobby-mode').className = `chip ${r.mode}`;
  $('#lobby-mode').innerHTML = modeChip(r.mode);
  $('#lobby-code').textContent = `Room ${r.id}`;
  $('#invite-url').value = inviteUrl();
  $('.share-btn').hidden = !navigator.share;
  const me = s.color, opp = other(me || 'w');
  const full = r.seats.w && r.seats.b;
  $('#lobby-title').textContent = !me ? 'This room is full' : full ? (r.seats[opp].ready ? `${r.seats[opp].name} is ready!` : 'Your friend is here') : 'Your room is ready';
  $('#lobby-sub').textContent = !me ? 'You can watch once the game starts.' : full ? 'Hit ready when you are. The game starts when you both are.' : 'Send this link to a friend. The game starts when you’re both ready.';
  const row = c => {
    const seat = r.seats[c];
    if (!seat) return `<li class="seat empty"><span class="avatar ${c}"></span><div><div class="seat-name">Waiting for a friend<span class="waiting-dots"><i></i><i></i><i></i></span></div><div class="seat-sub">Plays ${COLOR_NAME[c]}</div></div></li>`;
    const you = c === me;
    return `<li class="seat"><span class="avatar ${c}">${pieceInline(c + 'k')}</span><div><div class="seat-name">${esc(seat.name)}${you ? ' (you)' : ''}</div>
      <div class="seat-sub"><span class="status-dot ${seat.connected ? 'on' : 'off'}"></span>${seat.connected ? 'Connected' : 'Disconnected'} · ${COLOR_NAME[c]}</div></div>
      <span class="seat-state ${seat.ready ? 'ok' : ''}">${seat.ready ? `${icon('check')}Ready` : 'Not ready'}</span></li>`;
  };
  $('#seats').innerHTML = row(me || 'w') + row(me ? opp : 'b');
  const btn = $('#ready-btn');
  const amReady = me && r.seats[me]?.ready;
  btn.hidden = !me;
  btn.classList.toggle('is-ready', !!amReady);
  btn.innerHTML = s.status === 'reconnecting' ? 'Reconnecting…' : amReady ? `${icon('check')}Ready — waiting${full ? '' : ' for a friend'}` : 'I’m ready';
  btn.disabled = s.status === 'reconnecting';
  $('#name-input').value = myName();
}

async function copyInvite(btn) {
  const url = inviteUrl();
  try { await navigator.clipboard.writeText(url); } catch {
    const i = $('#invite-url'); i.value = url; i.select(); document.execCommand('copy');
  }
  toast('Invite link copied!', { ic: 'link', color: 'var(--green)' });
  sfx.click();
  if (btn) {
    const label = btn.querySelector('span:last-child');
    if (label && label.textContent !== 'Copied!') { const old = label.textContent; label.textContent = 'Copied!'; setTimeout(() => (label.textContent = old), 1600); }
  }
}

// ---------------------------------------------------------------- modals
function friendModal() {
  let mode = store.get('yc-mode') || 'chaos';
  const opts = Object.entries(MODES).map(([k, m]) => `<button class="mode-opt${k === mode ? ' on' : ''}" data-mode="${k}">
    <span class="m-ic m-${k}">${icon(MODE_ICON[k])}</span><b>${m.name}${k === 'classic' ? '' : ' Chess'}</b><small>${m.tag}</small></button>`).join('');
  const { card, close } = modal(`<h2>Play with a friend</h2><p class="muted">Pick a mode, then send the link. No sign-up, nothing to install.</p>
    <div class="modes">${opts}</div>
    <div class="stack"><button class="btn btn-primary btn-lg" data-f="online">${icon('link')}Create invite link</button>
    <div class="divider">or</div>
    <button class="btn btn-ghost btn-lg" data-f="hotseat">${icon('users')}Pass &amp; play on this device</button></div>`);
  $$('.mode-opt', card).forEach(b => (b.onclick = () => {
    mode = b.dataset.mode; store.set('yc-mode', mode);
    $$('.mode-opt', card).forEach(x => x.classList.toggle('on', x === b));
    sfx.click();
  }));
  $('[data-f="online"]', card).onclick = () => { close(); createRoom(mode); };
  $('[data-f="hotseat"]', card).onclick = () => { close(); startLocal(mode, 'hotseat'); };
}

function howToModal() {
  const ref = (list, cls) => list.map(([k, d]) => `<div class="ref-item ${cls || d.cat}"><span class="r-art">${cardSVG(k)}</span><div><b>${esc(d.name)}${d.free ? ' · free' : ''}</b><span>${esc(d.desc)}</span></div></div>`).join('');
  const items = Object.entries(ITEMS);
  modal(`<div class="howto"><h2>How to play</h2>
    <p>Every mode uses real chess rules: castling, en passant, promotion, check and checkmate. Checkmate the enemy king to win. Kings can never be hit by weapons or events.</p>
    <ul>
      <li><b>Turn:</b> make one move <i>or</i> use one item that ends your turn. Items marked <b>free</b> can be used before your move.</li>
      <li><b>Items</b> sit in your hand. Your opponent sees how many you have, not which ones.</li>
      <li>An item can never leave your own king in check. If you're in check, deal with it first.</li>
    </ul>
    <h3>Modes</h3>
    <ul>
      <li><b>Classic</b>: plain chess.</li>
      <li><b>Chaos</b>: start with 2 power-ups, grab <b>crates</b> on the board for more, and survive random events every few turns.</li>
      <li><b>Weapons</b>: start with 2 weapons and get another every 3 turns.</li>
      <li><b>Cards</b>: start with 3 cards and draw one every 2 turns.</li>
    </ul>
    <h3>Power-ups (Chaos)</h3><div class="ref">${ref(items.filter(([, d]) => d.cat === 'power'))}</div>
    <h3>Weapons</h3><div class="ref">${ref(items.filter(([, d]) => d.cat === 'weapon'))}</div>
    <h3>Cards</h3><div class="ref">${ref(items.filter(([, d]) => d.cat === 'card'))}</div>
    <h3>Random events (Chaos)</h3><div class="ref">${ref(Object.entries(EVENTS), 'event')}</div>
    <h3>Playing a friend</h3>
    <p>Click <b>Play with a Friend</b>, pick a mode and send the link. When you're both ready, colours are assigned and the game begins. If someone drops out, they can reopen the same link to pick up where they left off.</p></div>`);
}

// ---------------------------------------------------------------- home demo
const demo = {
  board: null, st: null, timer: null,
  start() {
    if (matchMedia('(max-width: 560px)').matches) return;
    if (!this.board) this.board = new Board($('#demo-board'), { interactive: false });
    if (!this.st) this.reset();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), 900);
  },
  stop() { clearTimeout(this.timer); },
  reset() {
    this.st = newGame('chaos');
    this.st.nextEvent = 3;
    this.board.setPieces(this.st.board, { instant: true });
    this.board.setMarks(this.st);
  },
  tick() {
    if ($('#home').hidden) return;
    const st = this.st, c = st.turn;
    if (st.status !== 'playing' || st.ply > 90) { this.reset(); this.timer = setTimeout(() => this.tick(), 1200); return; }
    let a = null;
    const usable = st.inv[c].filter(i => itemUsable(st, c, i.kind) && !ITEMS[i.kind].free);
    if (usable.length && Math.random() < 0.25) {
      const it = usable[0], picks = [];
      for (let s = itemStep(st, c, it.kind, picks); s; s = itemStep(st, c, it.kind, picks)) picks.push(s.targets[Math.floor(Math.random() * s.targets.length)]);
      a = { type: 'item', id: it.id, picks };
    } else {
      const ms = legalMoves(st, c);
      const caps = ms.filter(m => m.captured);
      const m = (caps.length && Math.random() < 0.6 ? caps : ms)[Math.floor(Math.random() * (caps.length && Math.random() < 0.6 ? caps : ms).length)];
      a = { type: 'move', from: m.from, to: m.to, promotion: m.promotion && 'q' };
    }
    let fx = [];
    try { fx = applyAction(st, c, a); } catch { this.reset(); }
    const b = this.board;
    const ev = fx.find(f => f.k === 'event');
    const batches = fx.filter(f => f.k === 'moves').map(f => ({ list: f.list, style: f.style }));
    b.setPieces(st.board, { batches });
    b.setMarks(st);
    fx.forEach(f => {
      if (f.k === 'boom') f.sqs.forEach(s => b.explode(s));
      if (f.k === 'meteor') f.sqs.forEach((s, i) => b.meteor(s, i * 150));
      if (f.k === 'capture') b.burst(f.sq, ['#1D1B18', '#FFC93D'], 8, 0.7);
      if (f.k === 'laser') b.beam(f.from, f.to);
      if (f.k === 'aura') f.sqs.forEach(s => b.ring(s, '#FF5A36'));
    });
    const cap = $('#demo-caption');
    if (ev) cap.textContent = `${ev.name}!`;
    else if (fx.some(f => f.k === 'item')) cap.textContent = `${COLOR_NAME[c]} used ${ITEMS[fx.find(f => f.k === 'item').kind].name}`;
    else cap.textContent = 'Chaos mode, live';
    this.timer = setTimeout(() => this.tick(), ev ? 1900 : 1250);
  },
};

// ---------------------------------------------------------------- wiring
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]');
  const st = e.target.closest('[data-start]');
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); leaveGame(); return; }
  if (st) { sfx.click(); startLocal(st.dataset.start, 'bot'); return; }
  if (!a) return;
  switch (a.dataset.action) {
    case 'sound': setMuted(!isMuted()); syncSoundButtons(); sfx.click(); break;
    case 'friend': sfx.click(); friendModal(); break;
    case 'howto': sfx.click(); howToModal(); break;
    case 'copy': copyInvite(a); break;
    case 'share': navigator.share?.({ title: 'Play YesChess with me', text: 'Join my chess game:', url: inviteUrl() }).catch(() => {}); break;
    case 'ready': {
      const me = session?.color;
      if (!me) break;
      const now = !session.room?.seats?.[me]?.ready;
      session.net.send({ t: 'ready', ready: now });
      sfx.click();
      break;
    }
    case 'leave': leaveGame(); break;
  }
});

$('#name-input').addEventListener('change', e => {
  const n = e.target.value.trim().slice(0, 24);
  if (!n) { e.target.value = myName(); return; }
  store.set('yc-name', n);
  if (session) session.net.send({ t: 'join', room: session.id, token: session.token, name: n });
});

function route() {
  const m = location.pathname.match(/^\/r\/([a-z0-9]+)\/?$/i);
  if (m) joinRoom(m[1].toLowerCase());
  else goHome();
}
window.addEventListener('popstate', () => { gv?.destroy(); gv = null; ctl?.destroy?.(); ctl = null; route(); });

fillIcons();
syncSoundButtons();
route();
// Read-only handle for automated UI tests (layout / animation consistency checks).
window.__yc = { get gv() { return gv; }, get ctl() { return ctl; } };
