// Board renderer: squares, Chess Merida pieces, animations, drag & drop and particle effects.
import { icon } from './icons.js';
import { ALL_SQUARES, fileOf, rankOf } from '/shared/rules.js';

const GLYPH = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/** Two stacked Merida glyphs: the opposite-colour glyph painted light as a fill, then the piece's own glyph in ink. */
export function pieceHTML(code) {
  const [c, t] = code, n = GLYPH[t];
  return `<i class="cm cm-${c === 'w' ? 'b' : 'w'}-${n} f"></i><i class="cm cm-${c}-${n} l"></i>`;
}
export const pieceInline = code => `<span class="pc-inline">${pieceHTML(code)}</span>`;

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts; // { onSquare(sq), onDrop(from,to) -> bool, canDrag(sq) -> bool }
    this.orient = 'w';
    this.pieces = {}; // sq -> element
    this.tokenKeys = {};
    el.innerHTML = '<div class="squares"></div><div class="pieces"></div><svg class="annot" viewBox="0 0 8 8" aria-hidden="true"></svg><div class="fx"></div>';
    this.sqLayer = el.querySelector('.squares');
    this.pcLayer = el.querySelector('.pieces');
    this.annotLayer = el.querySelector('.annot');
    this.fxLayer = el.querySelector('.fx');
    this.annot = { arrows: new Map(), marks: new Set() };
    this.sqs = {};
    for (const s of ALL_SQUARES) {
      const d = document.createElement('div');
      d.className = 'sq' + ((fileOf(s) + rankOf(s)) % 2 === 0 ? ' d' : '');
      d.dataset.sq = s;
      this.sqs[s] = d;
      this.sqLayer.appendChild(d);
    }
    this.layout();
    if (opts.interactive !== false) this.bindPointer();
  }

  setOrientation(c) {
    if (c === this.orient) return;
    this.orient = c;
    this.layout();
    for (const [sq, el] of Object.entries(this.pieces)) el.style.transform = this.tf(sq);
    this.renderAnnotations();
  }

  // ------------------------------------------------------------- annotations
  // Right-click a square to highlight it, right-drag to draw an arrow (like chess.com).
  // A left click or the next move clears them.
  toggleAnnotation(from, to) {
    const a = this.annot;
    if (from === to) { a.marks.has(from) ? a.marks.delete(from) : a.marks.add(from); }
    else { const k = from + to; a.arrows.has(k) ? a.arrows.delete(k) : a.arrows.set(k, [from, to]); }
    this.renderAnnotations();
  }
  clearAnnotations() {
    if (!this.annot.arrows.size && !this.annot.marks.size) return;
    this.annot.arrows.clear(); this.annot.marks.clear();
    this.renderAnnotations();
  }
  renderAnnotations(preview) {
    const c = sq => { const [x, y] = this.xy(sq); return [x + 0.5, y + 0.5]; };
    let out = '';
    for (const sq of this.annot.marks) { const [x, y] = this.xy(sq); out += `<rect x="${x}" y="${y}" width="1" height="1" class="an-mark"/>`; }
    const arrow = ([f, t], cls = '') => {
      const [x1, y1] = c(f), [x2, y2] = c(t), dx = x2 - x1, dy = y2 - y1;
      const pts = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1)
        ? (Math.abs(dy) > Math.abs(dx) ? [[x1, y1], [x1, y2], [x2, y2]] : [[x1, y1], [x2, y1], [x2, y2]]) // knight: an L
        : [[x1, y1], [x2, y2]];
      const [px, py] = pts.at(-2), len = Math.hypot(x2 - px, y2 - py), ux = (x2 - px) / len, uy = (y2 - py) / len;
      const head = 0.42, w = 0.36, bx = x2 - ux * head, by = y2 - uy * head;
      const line = [...pts.slice(0, -1), [bx, by]].map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('');
      return `<g class="an-arrow ${cls}"><path d="${line}"/><polygon points="${x2},${y2} ${bx - uy * w},${by + ux * w} ${bx + uy * w},${by - ux * w}"/></g>`;
    };
    for (const pr of this.annot.arrows.values()) out += arrow(pr);
    if (preview && preview[0] !== preview[1]) out += arrow(preview, 'preview');
    this.annotLayer.innerHTML = out;
  }

  xy(sq) {
    const f = fileOf(sq), r = rankOf(sq);
    return this.orient === 'w' ? [f, 7 - r] : [7 - f, r];
  }
  tf(sq, scale) { const [x, y] = this.xy(sq); return `translate(${x * 100}%, ${y * 100}%)${scale ? ` scale(${scale})` : ''}`; }

  layout() {
    for (const s of ALL_SQUARES) {
      const d = this.sqs[s], [x, y] = this.xy(s);
      d.style.gridColumn = x + 1;
      d.style.gridRow = y + 1;
      d.querySelectorAll('.coord').forEach(c => c.remove());
      if (x === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${s[1]}</span>`);
      if (y === 7) d.insertAdjacentHTML('beforeend', `<span class="coord file">${s[0]}</span>`);
    }
  }

  sqAt(clientX, clientY) {
    const r = this.el.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * 8), y = Math.floor(((clientY - r.top) / r.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.orient === 'w' ? 'abcdefgh'[x] + (8 - y) : 'abcdefgh'[7 - x] + (y + 1);
  }

  /** Centre of a square in px, relative to the board. */
  center(sq) {
    const w = this.el.clientWidth / 8, [x, y] = this.xy(sq);
    return [(x + 0.5) * w, (y + 0.5) * w, w];
  }

  // ------------------------------------------------------------------ pieces
  makePiece(code, sq) {
    const el = document.createElement('div');
    el.className = 'pc';
    el.dataset.code = code;
    el.innerHTML = `<div class="g">${pieceHTML(code)}</div>`;
    el.style.transform = this.tf(sq);
    this.pcLayer.appendChild(el);
    return el;
  }

  /**
   * Bring pieces in line with `board`, animating `batches` of [from, to] moves first.
   * removeDelay: { sq: ms } delays the disappearance of pieces destroyed by effects.
   */
  setPieces(board, { batches = [], removeDelay = {}, addDelay = 0, instant = false } = {}) {
    if (batches.length && !instant) this.clearAnnotations();
    const els = { ...this.pieces };
    const moved = new Map(); // el -> { from, to, style }
    const doomed = [];
    for (const { list, style } of batches) {
      const carry = list.map(([f, t]) => [els[f], f, t]).filter(([el]) => el);
      carry.forEach(([, f]) => delete els[f]);
      for (const [el, f, t] of carry) {
        if (els[t] && !carry.some(([e]) => e === els[t])) doomed.push([els[t], t, 140]);
        els[t] = el;
        const prev = moved.get(el);
        moved.set(el, { from: prev ? prev.from : f, to: t, style });
      }
    }
    const next = {};
    for (const [sq, el] of Object.entries(els)) {
      const code = board[sq];
      if (!code) { doomed.push([el, sq, removeDelay[sq] ?? (moved.has(el) ? 320 : 0)]); continue; }
      if (el.dataset.code !== code) {
        el.dataset.code = code;
        const g = el.querySelector('.g');
        g.innerHTML = pieceHTML(code);
        g.animate([{ transform: 'scale(.5) rotate(-20deg)' }, { transform: 'none' }], { duration: 450, easing: SPRING, delay: 120 });
      }
      next[sq] = el;
    }
    for (const [sq, code] of Object.entries(board)) {
      if (next[sq]) continue;
      const el = this.makePiece(code, sq);
      if (!instant) el.querySelector('.g').animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SPRING, delay: addDelay, fill: 'backwards' });
      next[sq] = el;
    }
    // animate moves
    for (const [el, { from, to, style }] of moved) {
      const target = Object.keys(next).find(s => next[s] === el) || to;
      const a = this.tf(from), b = this.tf(target);
      el.style.transform = b;
      if (instant || style === 'instant' || (this.skip && this.skip.from === from && this.skip.to === target)) continue;
      const [x1, y1] = this.xy(from), [x2, y2] = this.xy(target);
      const dist = Math.hypot(x2 - x1, y2 - y1);
      let frames, duration = Math.min(200 + dist * 30, 380);
      if (style === 'blink') {
        frames = [{ transform: a, opacity: 1 }, { transform: `${a} scale(.2)`, opacity: 0, offset: .45 }, { transform: `${b} scale(.2)`, opacity: 0, offset: .55 }, { transform: b, opacity: 1 }];
        duration = 820;
      } else if (style === 'ghost') {
        frames = [{ transform: a, opacity: 1 }, { opacity: .25, offset: .5 }, { transform: b, opacity: 1 }];
        duration = 760;
      } else if (style === 'arc') {
        const mid = `translate(${((x1 + x2) / 2) * 100}%, ${((y1 + y2) / 2) * 100 - 40}%) scale(1.2)`;
        frames = [{ transform: a }, { transform: mid }, { transform: b }];
        duration = 720;
      } else frames = [{ transform: a }, { transform: b }];
      el.classList.add('lift');
      el.animate(frames, { duration, easing: EASE }).onfinish = () => el.classList.remove('lift');
    }
    this.skip = null;
    for (const [el, , delay] of doomed) this.vanish(el, delay);
    this.pieces = next;
  }

  vanish(el, delay = 0) {
    el.style.zIndex = 1;
    const g = el.querySelector('.g');
    g.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(1.25)', opacity: 1, offset: .25 }, { transform: 'scale(.2) rotate(30deg)', opacity: 0 }],
      { duration: 340, delay, easing: EASE, fill: 'forwards' }).onfinish = () => el.remove();
  }

  /** Status classes on pieces + tokens on squares (crates, portals, holes, own mines). */
  setMarks(view) {
    for (const [sq, el] of Object.entries(this.pieces)) {
      const m = view.marks[sq] || {};
      el.classList.toggle('shield', (m.shield || 0) > view.ply);
      el.classList.toggle('frozen', (m.frozen || 0) > view.ply);
      el.classList.toggle('zombie', !!m.zombie);
      // only the owner's view carries these marks
      const badge = m.fake ? 'venetian-mask' : m.disguise ? 'eye' : '';
      if ((el.dataset.badge || '') !== badge) {
        el.dataset.badge = badge;
        el.querySelector('.badge')?.remove();
        if (badge) el.insertAdjacentHTML('beforeend', `<span class="badge ${m.fake ? 'fake' : 'disguise'}" title="${m.fake ? 'Your imposter (fake queen)' : 'Disguised: your opponent sees a pawn'}">${icon(badge)}</span>`);
      }
      el.classList.toggle('fake', !!m.fake);
      el.classList.toggle('disguised', !!m.disguise);
    }
    const tokens = {};
    const add = (sq, html) => (tokens[sq] = (tokens[sq] || '') + html);
    view.crates.forEach(s => add(s, `<div class="tok crate"><span>${icon('gift')}</span></div>`));
    view.holes.forEach(h => add(h.sq, '<div class="tok hole"><span></span></div>'));
    if (view.portals) [view.portals.a, view.portals.b].forEach(s => add(s, '<div class="tok portal"><span></span></div>'));
    view.mines.forEach(m => add(m.sq, `<div class="tok mine"><span>${icon('bomb')}</span></div>`));
    for (const s of ALL_SQUARES) {
      const html = tokens[s] || '';
      if (this.tokenKeys[s] === html) continue;
      this.tokenKeys[s] = html;
      this.sqs[s].querySelectorAll('.tok').forEach(t => t.remove());
      if (html) this.sqs[s].insertAdjacentHTML('afterbegin', html);
    }
  }

  setHighlights({ last, sel, moves = [], targets = [], picked = [], recent = [], recentColor, check, cat } = {}) {
    const rc = new Set(recent);
    if (recentColor) this.el.style.setProperty('--recent', recentColor);
    const dots = new Set(moves.filter(m => !m.cap).map(m => m.to));
    const caps = new Set(moves.filter(m => m.cap).map(m => m.to));
    const tg = new Set(targets), pk = new Set(picked);
    this.el.style.setProperty('--cat', cat || 'var(--coral)');
    for (const s of ALL_SQUARES) {
      const c = this.sqs[s].classList;
      c.toggle('last', !!last && (last.from === s || last.to === s));
      c.toggle('sel', sel === s);
      c.toggle('dot', dots.has(s));
      c.toggle('cap', caps.has(s));
      c.toggle('target', tg.has(s));
      c.toggle('picked', pk.has(s));
      c.toggle('check', check === s);
      c.toggle('recent', rc.has(s));
    }
    for (const [sq, el] of Object.entries(this.pieces)) el.classList.toggle('selected', sq === sel);
    this.moveTargets = new Set([...dots, ...caps, ...tg]);
  }

  // ------------------------------------------------------------------ input
  bindPointer() {
    let down = null, rdown = null;
    const el = this.el;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      if (e.button === 2) { rdown = this.sqAt(e.clientX, e.clientY); return; }
      if (e.button !== 0) return;
      this.clearAnnotations();
      const sq = this.sqAt(e.clientX, e.clientY);
      if (!sq) return;
      down = { sq, x: e.clientX, y: e.clientY, drag: false, pid: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (rdown) { const over = this.sqAt(e.clientX, e.clientY); if (over !== this.rover) { this.rover = over; this.renderAnnotations(over ? [rdown, over] : null); } return; }
      if (!down) { this.hover(this.sqAt(e.clientX, e.clientY)); return; }
      if (!down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 && this.opts.canDrag?.(down.sq) && this.pieces[down.sq]) {
        down.drag = true;
        this.opts.onSquare?.(down.sq, { dragStart: true });
        this.pieces[down.sq]?.classList.add('dragging');
      }
      if (down.drag) {
        const pc = this.pieces[down.sq];
        if (!pc) return;
        const r = el.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 800 - 50, y = ((e.clientY - r.top) / r.height) * 800 - 50;
        pc.style.transform = `translate(${x}%, ${y}%)`;
        const over = this.sqAt(e.clientX, e.clientY);
        for (const s of ALL_SQUARES) this.sqs[s].classList.toggle('hover-move', s === over && this.moveTargets?.has(s));
      }
    });
    const up = e => {
      if (e.button === 2 && rdown) {
        const to = this.sqAt(e.clientX, e.clientY), from = rdown;
        rdown = null; this.rover = null;
        if (to) this.toggleAnnotation(from, to); else this.renderAnnotations();
        return;
      }
      if (!down) return;
      const d = down; down = null;
      const sq = this.sqAt(e.clientX, e.clientY);
      for (const s of ALL_SQUARES) this.sqs[s].classList.remove('hover-move');
      const pc = this.pieces[d.sq];
      if (d.drag) {
        pc?.classList.remove('dragging');
        if (sq && sq !== d.sq && this.opts.onDrop?.(d.sq, sq)) { this.skip = { from: d.sq, to: sq }; return; }
        if (pc) { const cur = pc.style.transform; pc.style.transform = this.tf(d.sq); pc.animate([{ transform: cur }, { transform: this.tf(d.sq) }], { duration: 200, easing: EASE }); }
        return;
      }
      if (sq) this.opts.onSquare?.(sq, {});
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('pointerleave', () => this.hover(null));
  }

  hover(sq) {
    if (this.hovered === sq) return;
    this.pieces[this.hovered]?.classList.remove('hov');
    this.hovered = sq;
    const ok = sq && this.opts.canDrag?.(sq);
    if (ok) this.pieces[sq]?.classList.add('hov');
    this.el.style.cursor = ok || (sq && this.moveTargets?.has(sq)) ? 'pointer' : '';
  }

  /** Screen-space centre of a square (for flying elements to/from the board). */
  screenCenter(sq) {
    // the board can be zoomed (slow-motion camera): scale layout offsets to on-screen pixels
    const r = this.el.getBoundingClientRect(), z = r.width / (this.el.clientWidth || r.width), [x, y, w] = this.center(sq);
    return [r.left + x * z, r.top + y * z, w * z];
  }

  /** Crosshairs that snap onto target squares before an effect lands. */
  lockOn(sqs, color, hold = 600) {
    for (const sq of sqs) {
      const [x, y, w] = this.center(sq);
      const r = this.spawn('reticle', x, y, '<i></i><i></i><i></i><i></i>');
      r.style.width = r.style.height = w * 1.04 + 'px';
      r.style.color = color;
      r.animate([
        { transform: 'translate(-50%,-50%) scale(2.4) rotate(-90deg)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1) rotate(0)', opacity: 1, offset: .3 },
        { transform: 'translate(-50%,-50%) scale(.9)', opacity: 1, offset: .55 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .8 },
        { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 0 },
      ], { duration: hold + 500, easing: 'ease-out' }).onfinish = () => r.remove();
    }
  }

  /**
   * Anime impact frame: two harsh inverted frames, radial speed lines from the hit, and a hard shake.
   * strength 1 = normal hit, 2 = big (rockets, meteors, checkmate).
   */
  impact(sq, strength = 1, delay = 0) {
    const run = () => {
      const hard = 'invert(1) grayscale(1) contrast(3)';
      this.el.animate([
        { filter: hard }, { filter: hard, offset: 0.32 }, { filter: 'none', offset: 0.33 },
        { filter: 'grayscale(1) contrast(2) brightness(1.4)', offset: 0.55 }, { filter: 'none', offset: 0.56 }, { filter: 'none' },
      ], { duration: strength > 1 ? 220 : 160 });
      if (sq) this.speedLines(sq, strength);
      this.shake(strength > 1 ? 12 : 7);
    };
    if (delay) setTimeout(run, delay); else run();
  }

  /** Radial manga speed lines bursting out of a square. */
  speedLines(sq, strength = 1, color = '#1D1B18') {
    const [x, y, w] = this.center(sq);
    const size = w * (strength > 1 ? 9 : 6);
    const n = strength > 1 ? 30 : 22;
    let polys = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.15;
      const r0 = 0.16 + Math.random() * 0.1, r1 = 0.5;
      const spread = 0.012 + Math.random() * 0.022;
      const p = (ang, r) => `${50 + Math.cos(ang) * r * 100},${50 + Math.sin(ang) * r * 100}`;
      polys += `<polygon points="${p(a - spread, r1)} ${p(a + spread, r1)} ${p(a, r0)}" />`;
    }
    const el = this.spawn('burstlines', x, y, `<svg viewBox="0 0 100 100" fill="${color}">${polys}</svg>`);
    el.style.width = el.style.height = size + 'px';
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.35) rotate(0deg)', opacity: 1 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(4deg)', opacity: 0.9, offset: 0.4 },
      { transform: 'translate(-50%,-50%) scale(1.25) rotate(6deg)', opacity: 0 },
    ], { duration: strength > 1 ? 520 : 400, easing: 'cubic-bezier(.1,.8,.3,1)' }).onfinish = () => el.remove();
  }

  // ------------------------------------------------------- signature item effects
  /** Manga smoke puff (substitution / shadow clone). */
  smoke(sq, delay = 0, scale = 1) {
    const [x, y, w] = this.center(sq);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.6, d = w * (0.16 + Math.random() * 0.22) * scale;
      const s = w * (0.5 + Math.random() * 0.35) * scale;
      const p = this.spawn('puff', x + Math.cos(a) * d * 0.4, y + Math.sin(a) * d * 0.4);
      p.style.width = p.style.height = s + 'px';
      p.animate([
        { transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - w * 0.15}px)) scale(1.15)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.15}px), calc(-50% + ${Math.sin(a) * d * 1.15 - w * 0.22}px)) scale(1.2)`, opacity: 1, offset: 0.62 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.4}px), calc(-50% + ${Math.sin(a) * d * 1.4 - w * 0.4}px)) scale(1.35)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 200, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }).onfinish = () => p.remove();
    }
  }

  /** The wooden log left behind by a substitution. */
  log(sq, delay = 0) {
    const [x, y, w] = this.center(sq);
    const l = this.spawn('logfx', x, y, `<svg viewBox="0 0 60 28"><rect x="2" y="4" width="46" height="20" rx="6" fill="#B07A45" stroke="#1D1B18" stroke-width="3"/><path d="M12 8 v12 M26 6 v16" stroke="#7E5229" stroke-width="2.5"/><ellipse cx="48" cy="14" rx="8" ry="10" fill="#E2B27A" stroke="#1D1B18" stroke-width="3"/><circle cx="48" cy="14" r="3.5" fill="none" stroke="#7E5229" stroke-width="2"/></svg>`);
    l.style.width = w * 0.85 + 'px';
    l.animate([
      { transform: 'translate(-50%,-50%) scale(.3) rotate(-30deg)', opacity: 0 },
      { transform: 'translate(-50%,-80%) scale(1.1) rotate(10deg)', opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%,-60%) scale(1) rotate(-8deg)', opacity: 1, offset: 0.7 },
      { transform: `translate(-50%, ${w * 0.6}px) scale(.9) rotate(40deg)`, opacity: 0 },
    ], { duration: 1000, delay, easing: 'ease-in-out', fill: 'backwards' }).onfinish = () => l.remove();
  }

  /** Vertical light pillar (teleport, resurrection). */
  pillar(sq, color = '#FFFFFF', delay = 0) {
    const [x, y, w] = this.center(sq);
    const p = this.spawn('pillar', x, y);
    p.style.width = w * 0.7 + 'px';
    p.style.height = y + w * 0.5 + 'px';
    p.style.background = color;
    p.animate([
      { transform: 'translate(-50%, -100%) translateY(50%) scaleX(0)', opacity: 1 },
      { transform: 'translate(-50%, -100%) translateY(50%) scaleX(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -100%) translateY(50%) scaleX(.6)', opacity: 0.9, offset: 0.6 },
      { transform: 'translate(-50%, -100%) translateY(50%) scaleX(0)', opacity: 0 },
    ], { duration: 700, delay, easing: 'ease-out', fill: 'backwards' }).onfinish = () => p.remove();
  }

  /** Hexagon barrier (shield). */
  hexShield(sq) {
    const [x, y, w] = this.center(sq);
    const h = this.spawn('hexfx', x, y, `<svg viewBox="0 0 100 100"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="rgba(46,107,255,.18)" stroke="#2E6BFF" stroke-width="6" stroke-linejoin="round"/><polygon points="50,18 80,35 80,65 50,82 20,65 20,35" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`);
    h.style.width = h.style.height = w * 1.3 + 'px';
    h.animate([
      { transform: 'translate(-50%,-50%) scale(2.2) rotate(-30deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(.9) rotate(0)', opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1, offset: 0.5 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
    ], { duration: 1000, easing: 'ease-out' }).onfinish = () => h.remove();
  }

  /** Ice shards exploding outwards (freeze). */
  iceShards(sq) {
    const [x, y, w] = this.center(sq);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, d = w * (0.55 + Math.random() * 0.5);
      const s = this.spawn('shard', x, y);
      s.style.width = w * 0.16 + 'px'; s.style.height = w * (0.38 + Math.random() * 0.25) + 'px';
      s.style.background = i % 3 ? '#BFE2FF' : '#FFFFFF';
      const rot = (a * 180) / Math.PI + 90;
      s.animate([
        { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(.2)`, opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) rotate(${rot}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.1}px), calc(-50% + ${Math.sin(a) * d * 1.1}px)) rotate(${rot}deg) scale(.8)`, opacity: 0 },
      ], { duration: 650, easing: 'cubic-bezier(.1,.8,.3,1)' }).onfinish = () => s.remove();
    }
    this.ring(sq, '#8FC8FF', 0, 2);
  }

  /** Afterimages along a path (ghost). */
  afterimages(from, to, code, color = '#FF5A36') {
    const [x1, y1, w] = this.center(from), [x2, y2] = this.center(to);
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const g = this.spawn('afterimage', x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, `<span class="pc-inline">${pieceHTML(code)}</span>`);
      g.style.fontSize = w * 0.83 + 'px';
      g.style.color = color;
      g.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.2 }, { opacity: 0 }], { duration: 650, delay: i * 70, fill: 'backwards' }).onfinish = () => g.remove();
    }
  }

  /** Hypno-spiral rings (mind control). */
  spiral(sq, color = '#7B5CFF') {
    const [x, y, w] = this.center(sq);
    for (let i = 0; i < 3; i++) {
      const r = this.spawn('spiralfx', x, y);
      r.style.width = r.style.height = w * (1.9 - i * 0.45) + 'px';
      r.style.borderColor = color;
      r.animate([
        { transform: 'translate(-50%,-50%) scale(1.6) rotate(0deg)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1) rotate(200deg)', opacity: 1, offset: 0.4 },
        { transform: 'translate(-50%,-50%) scale(.3) rotate(540deg)', opacity: 0 },
      ], { duration: 900, delay: i * 90, easing: 'ease-in-out', fill: 'backwards' }).onfinish = () => r.remove();
    }
  }

  /** Rising aura flames (evolution / power-up). */
  aura(sq, colors = ['#FFC93D', '#FF5A36', '#FFFFFF'], n = 18) {
    const [x, y, w] = this.center(sq);
    for (let i = 0; i < n; i++) {
      const f = this.spawn('flame', x + (Math.random() - 0.5) * w * 0.8, y + w * 0.35);
      const s = w * (0.12 + Math.random() * 0.14);
      f.style.width = f.style.height = s + 'px';
      f.style.background = colors[i % colors.length];
      f.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${(Math.random() - 0.5) * w * 0.3}px), calc(-50% - ${w * (0.7 + Math.random() * 0.6)}px)) scale(.2)`, opacity: 0 },
      ], { duration: 600 + Math.random() * 300, delay: Math.random() * 450, easing: 'ease-out', fill: 'backwards' }).onfinish = () => f.remove();
    }
  }

  /** Crackling electric arcs over squares (EMP). */
  arcs(sqs, color = '#2E6BFF') {
    const W = this.el.clientWidth;
    const pts = sqs.map(s => this.center(s));
    const svg = this.spawn('arcfx', 0, 0);
    svg.style.width = svg.style.height = W + 'px';
    let html = '';
    for (let i = 0; i < 9; i++) {
      const [ax, ay] = pts[Math.floor(Math.random() * pts.length)], [bx, by] = pts[Math.floor(Math.random() * pts.length)];
      let d = `M${ax},${ay}`;
      for (let k = 1; k <= 6; k++) { const t = k / 6; d += ` L${ax + (bx - ax) * t + (Math.random() - 0.5) * W * 0.05},${ay + (by - ay) * t + (Math.random() - 0.5) * W * 0.05}`; }
      html += `<path d="${d}" fill="none" stroke="${i % 2 ? '#fff' : color}" stroke-width="${i % 2 ? 2 : 4}" stroke-linejoin="round"/>`;
    }
    svg.innerHTML = `<svg width="${W}" height="${W}">${html}</svg>`;
    svg.animate([{ opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'steps(6)' }).onfinish = () => svg.remove();
  }

  /** Muzzle flash + pellet streaks (shotgun). */
  muzzle(from, targets) {
    this.ring(from, '#FFC93D', 0, 2.2);
    this.burst(from, ['#FFC93D', '#FFFFFF', '#FF5A36'], 16, 1.3);
    for (const t of targets) { this.beam(from, t, '#FFC93D'); }
  }

  /** Energy gathering into a square before a shot (laser charge). */
  charge(sq, color = '#2E6BFF') {
    const [x, y, w] = this.center(sq);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = w * (0.9 + Math.random() * 0.6);
      const p = this.spawn('particle', x + Math.cos(a) * d, y + Math.sin(a) * d);
      p.style.background = i % 2 ? '#fff' : color;
      p.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
        { opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${-Math.cos(a) * d}px), calc(-50% + ${-Math.sin(a) * d}px)) scale(.4)`, opacity: 1 },
      ], { duration: 380, delay: Math.random() * 120, easing: 'ease-in', fill: 'backwards' }).onfinish = () => p.remove();
    }
  }

  /** Light up a set of squares (e.g. an EMP area). */
  glow(sqs, color, duration = 900) {
    for (const sq of sqs) {
      const [x, y, w] = this.center(sq);
      const g = this.spawn('glow', x, y);
      g.style.width = g.style.height = w + 'px';
      g.style.background = color;
      g.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: .55, transform: 'translate(-50%,-50%) scale(1)', offset: .3 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1)' }],
        { duration, easing: 'ease-out' }).onfinish = () => g.remove();
    }
  }

  // ---------------------------------------------------------------- effects
  spawn(cls, x, y, html = '') {
    const d = document.createElement('div');
    d.className = cls;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.innerHTML = html;
    this.fxLayer.appendChild(d);
    return d;
  }

  burst(sq, colors = ['#FF5A36', '#FFC93D', '#1D1B18'], n = 12, power = 1, delay = 0) {
    const [cx, cy, w] = this.center(sq);
    for (let i = 0; i < n; i++) {
      const p = this.spawn('particle', cx, cy);
      p.style.background = colors[i % colors.length];
      const ang = (i / n) * Math.PI * 2 + Math.random() * .5, dist = w * (.45 + Math.random() * .6) * power;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      p.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random() * 360}deg) scale(.3)`, opacity: 0 },
      ], { duration: 520 + Math.random() * 260, delay, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'backwards' }).onfinish = () => p.remove();
    }
  }

  ring(sq, color = '#2E6BFF', delay = 0, scale = 1.6) {
    const [cx, cy, w] = this.center(sq);
    const r = this.spawn('ring', cx, cy);
    r.style.color = color;
    r.style.width = r.style.height = w + 'px';
    r.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 }, { transform: `translate(-50%,-50%) scale(${scale})`, opacity: 0 }],
      { duration: 600, delay, easing: EASE, fill: 'backwards' }).onfinish = () => r.remove();
  }

  explode(sq, delay = 0, big = false) {
    this.burst(sq, ['#FF5A36', '#FFC93D', '#1D1B18', '#FFFFFF'], big ? 18 : 13, big ? 1.5 : 1.1, delay);
    this.ring(sq, '#FF5A36', delay, big ? 2.4 : 1.8);
    this.impact(sq, big ? 2 : 1, delay);
  }

  beam(from, to, color = '#2E6BFF') {
    const [x1, y1, w] = this.center(from), [x2, y2] = this.center(to);
    const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
    const b = this.spawn('beam', x1, y1);
    b.style.width = len + 'px';
    b.style.background = color;
    b.style.marginTop = -(w * 0.07) + 'px';
    b.animate([
      { transform: `rotate(${ang}rad) scaleX(0)`, opacity: 1 },
      { transform: `rotate(${ang}rad) scaleX(1)`, opacity: 1, offset: .35 },
      { transform: `rotate(${ang}rad) scaleX(1) scaleY(.2)`, opacity: 0 },
    ], { duration: 520, easing: EASE }).onfinish = () => b.remove();
  }

  meteor(sq, delay = 0) {
    const [x, y, w] = this.center(sq);
    const m = this.spawn('meteor', x, y);
    m.animate([
      { transform: `translate(calc(-50% + ${w * 3}px), calc(-50% - ${w * 5}px)) scale(.6)`, opacity: 0 },
      { opacity: 1, offset: .2 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
    ], { duration: 520, delay, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'backwards' }).onfinish = () => { m.remove(); this.explode(sq, 0, true); };
  }

  rocket(sq, fromBottom = true) {
    const [x, y, w] = this.center(sq);
    const r = this.spawn('rocket-fx', x, y, icon('rocket', 24));
    const sy = fromBottom ? this.el.clientHeight + w : -w;
    const rot = fromBottom ? -45 : 135;
    r.animate([
      { transform: `translate(-50%, calc(-50% + ${sy - y}px)) rotate(${rot}deg)` },
      { transform: `translate(-50%,-50%) rotate(${rot}deg)` },
    ], { duration: 420, easing: 'cubic-bezier(.5,0,.9,.5)' }).onfinish = () => r.remove();
  }

  flash(color = '#fff', duration = 420) {
    const f = this.spawn('flash', 0, 0);
    f.style.background = color;
    f.animate([{ opacity: .85 }, { opacity: 0 }], { duration, easing: 'ease-out' }).onfinish = () => f.remove();
  }

  shake(px = 5) {
    this.el.animate([
      { transform: 'none' }, { transform: `translate(${px}px, ${-px / 2}px)` }, { transform: `translate(${-px}px, ${px / 2}px)` },
      { transform: `translate(${px / 2}px, ${px / 3}px)` }, { transform: 'none' },
    ], { duration: 360, easing: 'ease-out' });
  }

  /** 3D flip around the vertical axis; `mid` runs at the edge-on moment. */
  spin(mid) {
    this.el.animate([{ transform: 'perspective(900px) rotateY(0)' }, { transform: 'perspective(900px) rotateY(90deg)' }], { duration: 320, easing: 'ease-in' })
      .onfinish = () => {
        mid();
        this.el.animate([{ transform: 'perspective(900px) rotateY(-90deg)' }, { transform: 'perspective(900px) rotateY(0)' }], { duration: 420, easing: SPRING });
      };
  }
}
