// RPG / anime-style VFX: a canvas layer over the board with additive ("lighter") blending.
// Glow sprites, light rays, shockwaves, ground cracks, magic circles, lightning, black holes…
// The board briefly darkens behind big effects so the light actually pops on the light theme.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t * t * t;
const easeBack = t => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

export const PAL = {
  fire: ['#FFF1B8', '#FFB23F', '#FF5A1F', '#E0260B'],
  blue: ['#E6F2FF', '#7FB2FF', '#2E6BFF', '#1B3FD1'],
  violet: ['#F0E6FF', '#B18CFF', '#7B5CFF', '#4B22D6'],
  gold: ['#FFFBE0', '#FFE58A', '#FFC93D', '#FF9A1F'],
  ice: ['#FFFFFF', '#CFEAFF', '#8FC8FF', '#3D8BFF'],
  shadow: ['#E9DDFF', '#A66BFF', '#7B2CFF', '#3A0CA3'],
  red: ['#FFE3DC', '#FF8A73', '#FF3B30', '#B3121B'],
  green: ['#EFFFE6', '#9DF27A', '#3FD16B', '#1F9D6B'],
};

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
const sprites = new Map();
/** Soft glow with a hot white core. */
function glow(color) {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.16, rgba(color, 1));
  gr.addColorStop(0.42, rgba(color, 0.38));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  sprites.set(color, c);
  return c;
}
/** Soft blob without the white core (smoke, shadows). */
function blob(color) {
  const key = 'b' + color;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(color, 1));
  gr.addColorStop(0.5, rgba(color, 0.55));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

function jagged(x0, y0, x1, y1, segs, amp) {
  const pts = [[x0, y0]], dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs, o = rand(-amp, amp) * len * Math.sin(t * Math.PI);
    pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
  }
  pts.push([x1, y1]);
  return pts;
}
/** Sharp alternating zig-zag (lightning), calmer near the end point. */
function zigzag(x0, y0, x1, y1, segs, amp) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const pts = [[x0, y0]];
  let side = Math.random() < 0.5 ? -1 : 1;
  for (let i = 1; i < segs; i++) {
    const t = i / segs + rand(-0.03, 0.03), o = side * rand(0.45, 1) * amp * len * (1 - t * 0.6);
    side = -side;
    pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
  }
  pts.push([x1, y1]);
  return pts;
}
/** A main bolt plus two forks that split off partway down. */
function zapPaths(p) {
  const main = zigzag(p.x0, p.y0, p.x1, p.y1, 8, 0.13);
  const out = [{ pts: main, w: p.w }];
  const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), dir = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
  for (let i = 0; i < 2; i++) {
    const [bx, by] = main[2 + Math.floor(Math.random() * 4)];
    const ang = dir + (i ? 1 : -1) * rand(0.45, 0.85), l = len * rand(0.16, 0.28);
    out.push({ pts: zigzag(bx, by, bx + Math.cos(ang) * l, by + Math.sin(ang) * l, 4, 0.2), w: p.w * 0.42, down: true });
  }
  return out;
}
/** Filled ribbon along a path: thin at the sky end and wide at the impact (or the reverse for forks). */
function ribbon(ctx, pts, w, down = false) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i], [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(n - 1, i + 1)];
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1, f = i / (n - 1);
    const hw = (w * (down ? 1 - f * 0.8 : 0.3 + f * 0.7)) / 2;
    L.push([x - (dy / d) * hw, y + (dx / d) * hw]);
    R.push([x + (dy / d) * hw, y - (dx / d) * hw]);
  }
  ctx.beginPath();
  L.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
}
function polyline(ctx, pts, n = pts.length) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

const UNDER = new Set(['dim', 'smoke']);
const CEL = new Set(['cel', 'splash']); // flat cartoon shapes (source-over, above the dim)
const OVER = new Set(['disk']);

export class VFX {
  constructor(host, board) {
    this.host = host;
    this.board = board;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vfx';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    this.timers = new Set();
    this.dimP = null;
    this.timeScale = 1; // < 1 = slow motion (replays)
    addEventListener('resize', () => this.fit(true));
  }

  // ------------------------------------------------------------ engine
  fit(force = false) {
    const r = { width: this.host.offsetWidth, height: this.host.offsetHeight }; // layout size, unaffected by the replay zoom
    const key = `${r.width}x${r.height}`;
    if (!force && key === this.key) return;
    this.key = key;
    const m = Math.round(Math.max(r.width, r.height) * 0.45);
    const w = r.width + m * 2, h = r.height + m * 2, dpr = Math.min(devicePixelRatio || 1, 2);
    Object.assign(this.canvas.style, { left: `${-m}px`, top: `${-m}px`, width: `${w}px`, height: `${h}px` });
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
  }
  /** On-screen size / layout size: the board can be zoomed by the replay camera. */
  zoom() { return this.canvas.getBoundingClientRect().width / (this.canvas.offsetWidth || 1) || 1; }
  /** Square -> [x, y, size] in canvas pixels. */
  at(sq) {
    const c = this.canvas.getBoundingClientRect(), z = this.zoom(), [x, y] = this.board.screenCenter(sq);
    return [(x - c.left) / z, (y - c.top) / z, this.board.el.clientWidth / 8];
  }
  boardRect() {
    const c = this.canvas.getBoundingClientRect(), z = this.zoom(), r = this.board.el.getBoundingClientRect();
    return [(r.left - c.left) / z, (r.top - c.top) / z, r.width / z, r.height / z];
  }
  /** Canvas-space centre of the board. */
  boardCenter() { const [x, y, w, h] = this.boardRect(); return [x + w / 2, y + h / 2, w / 8]; }
  later(ms, fn) {
    if (!ms) return fn();
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms / this.timeScale);
    this.timers.add(id);
  }
  clear() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.parts = [];
    this.dimP = null;
  }
  add(p) {
    p.t = 0;
    this.parts.push(p);
    if (this.parts.length > 2200) this.parts.splice(0, this.parts.length - 2200);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(() => this.frame());
    }
    return p;
  }
  /** Darken the board behind an effect. Overlapping calls extend one shared dim. */
  dim(a = 0.55, dur = 1) {
    const p = this.dimP;
    if (p && this.parts.includes(p)) { p.a = Math.max(p.a, a); p.life = Math.max(p.life, p.t + dur); return; }
    this.dimP = this.add({ type: 'dim', a, life: dur, rect: this.boardRect() });
  }
  go(fn, delay = 0) {
    this.later(delay, () => { this.fit(); fn(); });
  }

  frame() {
    // performance.now(), not the rAF timestamp: that one can be slightly *behind* and give a negative dt
    const now = performance.now(), dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000)) * this.timeScale;
    this.last = now;
    try { this.step(dt); } catch (err) {
      // one bad particle must never freeze the layer
      console.error(err);
      this.parts = [];
      this.running = false;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  step(dt) {
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / d, this.canvas.height / d);
    const alive = [];
    for (const p of this.parts) {
      p.t += dt;
      if (p.t >= p.life) continue;
      if (p.emit) p.emit(p, dt);
      if (p.vx !== undefined) {
        const drag = Math.max(0, 1 - (p.drag || 0) * dt);
        p.vx *= drag; p.vy *= drag;
        p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      alive.push(p);
    }
    this.parts = alive;
    ctx.globalCompositeOperation = 'source-over';
    for (const p of alive) if (UNDER.has(p.type)) this.draw(p);
    for (const p of alive) if (CEL.has(p.type)) this.draw(p);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of alive) if (!UNDER.has(p.type) && !CEL.has(p.type) && !OVER.has(p.type)) this.draw(p);
    ctx.globalCompositeOperation = 'source-over';
    for (const p of alive) if (OVER.has(p.type)) this.draw(p);
    ctx.globalAlpha = 1;
    if (alive.length) requestAnimationFrame(() => this.frame());
    else { this.running = false; ctx.clearRect(0, 0, this.canvas.width / d, this.canvas.height / d); }
  }

  draw(p) {
    const ctx = this.ctx, k = Math.max(0, Math.min(1, p.t / p.life));
    switch (p.type) {
      case 'dim': {
        const a = p.a * Math.min(1, p.t / 0.12) * Math.min(1, (p.life - p.t) / 0.35);
        const [x, y, w, h] = p.rect;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#080512';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, w, h, 14) : ctx.rect(x, y, w, h);
        ctx.fill();
        break;
      }
      case 'glow': case 'smoke': {
        const s = p.s0 + (p.s1 - p.s0) * (p.ease ? easeOut(k) : k);
        const fadeIn = p.fadeIn ? Math.min(1, k / p.fadeIn) : 1;
        ctx.globalAlpha = Math.max(0, p.a * fadeIn * (1 - k) ** (p.fade || 1));
        const img = p.type === 'smoke' ? blob(p.color) : glow(p.color);
        if (p.sx) ctx.drawImage(img, p.x - (s * p.sx) / 2, p.y - s / 2, s * p.sx, s);
        else ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
        break;
      }
      case 'streak': {
        const sp = Math.hypot(p.vx, p.vy) || 1, len = p.len * (0.35 + 0.65 * Math.min(1, sp / (p.sp0 || sp)));
        const x2 = p.x - (p.vx / sp) * len, y2 = p.y - (p.vy / sp) * len;
        ctx.lineCap = 'round';
        ctx.globalAlpha = p.a * (1 - k) * 0.35;
        ctx.strokeStyle = p.color; ctx.lineWidth = p.w * 3.2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.globalAlpha = p.a * (1 - k);
        ctx.strokeStyle = p.core || '#FFFFFF'; ctx.lineWidth = p.w;
        ctx.stroke();
        break;
      }
      case 'ray': {
        const L = p.len * easeOut(Math.min(1, k * 2.6)), r0 = p.r0 || 0;
        const c = Math.cos(p.ang), s = Math.sin(p.ang), nx = -s * p.w, ny = c * p.w;
        const bx = p.x + c * r0, by = p.y + s * r0, ex = p.x + c * (r0 + L), ey = p.y + s * (r0 + L);
        ctx.globalAlpha = p.a * (1 - k) ** 1.4;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.moveTo(bx + nx, by + ny); ctx.lineTo(ex, ey); ctx.lineTo(bx - nx, by - ny); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.moveTo(bx + nx * 0.35, by + ny * 0.35); ctx.lineTo(ex, ey); ctx.lineTo(bx - nx * 0.35, by - ny * 0.35); ctx.closePath(); ctx.fill();
        break;
      }
      case 'ring': {
        const r = p.r0 + (p.r1 - p.r0) * easeOut(k), sy = p.sy || 1;
        const a = p.a * (1 - k) ** 1.3;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = a * 0.35; ctx.lineWidth = p.w * 2.6 * (1 - k * 0.7);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * sy, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = a; ctx.lineWidth = Math.max(1, p.w * (1 - k * 0.8));
        ctx.strokeStyle = p.core || p.color;
        ctx.stroke();
        break;
      }
      case 'crack': {
        const n = Math.max(2, Math.ceil(p.pts.length * Math.min(1, k / 0.12)));
        const a = p.a * (k < 0.45 ? 1 : (1 - k) / 0.55);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        polyline(ctx, p.pts, n);
        ctx.globalAlpha = a * 0.4; ctx.strokeStyle = p.color; ctx.lineWidth = p.w * 3.5; ctx.stroke();
        ctx.globalAlpha = a; ctx.strokeStyle = '#FFF6D6'; ctx.lineWidth = p.w; ctx.stroke();
        break;
      }
      case 'bolt': {
        if (!p.pts || p.t - (p.gen || 0) > 0.05) { p.pts = jagged(p.x0, p.y0, p.x1, p.y1, 9, 0.13); p.gen = p.t; }
        const a = p.a * (1 - k) * rand(0.55, 1);
        ctx.lineJoin = 'round';
        polyline(ctx, p.pts);
        ctx.globalAlpha = a * 0.35; ctx.strokeStyle = p.color; ctx.lineWidth = p.w * 4; ctx.stroke();
        ctx.globalAlpha = a; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = p.w; ctx.stroke();
        break;
      }
      case 'beam': {
        const env = Math.min(1, k / 0.12) * (k > 0.6 ? (1 - k) / 0.4 : 1);
        const w = p.w * env * rand(0.85, 1.15);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1);
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 0.28; ctx.lineWidth = w * 2.6; ctx.stroke();
        ctx.globalAlpha = 0.85; ctx.lineWidth = w; ctx.stroke();
        ctx.strokeStyle = '#FFFFFF'; ctx.globalAlpha = 1; ctx.lineWidth = w * 0.38; ctx.stroke();
        break;
      }
      case 'flare': {
        const a = p.a * (1 - k) ** 2, L = p.len * (0.6 + 0.4 * easeOut(Math.min(1, k * 3)));
        ctx.globalAlpha = a;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        const img = glow(p.color);
        ctx.drawImage(img, -L / 2, -L * 0.035, L, L * 0.07);
        ctx.drawImage(img, -L * 0.035, -L / 2, L * 0.07, L);
        ctx.rotate(Math.PI / 4);
        ctx.drawImage(img, -L * 0.25, -L * 0.02, L * 0.5, L * 0.04);
        ctx.drawImage(img, -L * 0.02, -L * 0.25, L * 0.04, L * 0.5);
        ctx.restore();
        ctx.drawImage(img, p.x - L * 0.2, p.y - L * 0.2, L * 0.4, L * 0.4);
        break;
      }
      case 'circle': {
        const sc = easeBack(Math.min(1, k / 0.22)), a = p.a * (k > 0.65 ? (1 - k) / 0.35 : 1);
        const R = p.R * sc, rot = (p.rot || 0) + p.spin * p.t;
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, p.sy || 1);
        ctx.strokeStyle = p.color; ctx.fillStyle = p.color; ctx.lineCap = 'round';
        const pass = (alpha, lw) => {
          ctx.globalAlpha = a * alpha; ctx.lineWidth = lw;
          ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, R * 0.84, 0, TAU); ctx.stroke();
          ctx.save(); ctx.rotate(rot);
          ctx.beginPath();
          for (let i = 0; i < 40; i++) { const t = (i / 40) * TAU, o = i % 5 ? 0.9 : 0.86; ctx.moveTo(Math.cos(t) * R * o, Math.sin(t) * R * o); ctx.lineTo(Math.cos(t) * R * 0.98, Math.sin(t) * R * 0.98); }
          ctx.stroke();
          // the star: pentagram for odd n, hexagram (two triangles) otherwise
          const r = R * 0.84, pt = t => [Math.cos(t) * r, Math.sin(t) * r];
          ctx.beginPath();
          if ((p.n || 6) % 2) {
            for (let i = 0; i <= 5; i++) { const [px, py] = pt(((i * 2) / 5) * TAU - Math.PI / 2); ctx[i ? 'lineTo' : 'moveTo'](px, py); }
          } else {
            for (const off of [-Math.PI / 2, Math.PI / 2]) for (let i = 0; i <= 3; i++) { const [px, py] = pt((i / 3) * TAU + off); ctx[i ? 'lineTo' : 'moveTo'](px, py); }
          }
          ctx.stroke();
          ctx.restore();
          ctx.save(); ctx.rotate(-rot * 1.6);
          ctx.beginPath(); ctx.arc(0, 0, R * 0.5, 0, TAU); ctx.stroke();
          ctx.beginPath();
          for (let i = 0; i <= 4; i++) { const t = (i / 4) * TAU; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(t) * R * 0.5, Math.sin(t) * R * 0.5); }
          ctx.stroke();
          for (let i = 0; i < 8; i++) { const t = (i / 8) * TAU; ctx.beginPath(); ctx.arc(Math.cos(t) * R * 0.67, Math.sin(t) * R * 0.67, R * 0.045, 0, TAU); ctx.stroke(); }
          ctx.restore();
        };
        pass(0.3, Math.max(4, R * 0.07));
        pass(1, Math.max(1.4, R * 0.022));
        ctx.restore();
        break;
      }
      case 'orbit': {
        // comet: head glow + a fading trail of its last positions
        const px = p.cx + Math.cos(p.ang) * p.r, py = p.cy + Math.sin(p.ang) * p.r;
        const tr = p.trail || (p.trail = []);
        tr.push([px, py]);
        if (tr.length > (p.tail || 9)) tr.shift();
        const fade = Math.min(1, p.t / 0.15) * p.a;
        ctx.strokeStyle = p.color; ctx.lineCap = 'round';
        for (let i = 1; i < tr.length; i++) {
          const f = i / tr.length;
          ctx.globalAlpha = fade * f;
          ctx.lineWidth = p.w * (0.3 + f * 0.9);
          ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke();
        }
        ctx.globalAlpha = fade;
        const hs = p.w * 4;
        ctx.drawImage(glow(p.color), px - hs / 2, py - hs / 2, hs, hs);
        break;
      }
      case 'disk': {
        const grow = easeOut(Math.min(1, k / 0.18)), shrink = k > 0.86 ? (1 - k) / 0.14 : 1;
        const R = p.R * grow * shrink * (1 + 0.04 * Math.sin(p.t * 22));
        ctx.globalAlpha = 0.85;
        ctx.drawImage(blob('#000000'), p.x - R * 1.6, p.y - R * 1.6, R * 3.2, R * 3.2);
        ctx.globalAlpha = 1; ctx.fillStyle = '#000000';
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1.5, R * 0.07);
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.03, p.t * 5, p.t * 5 + TAU * 0.7); ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.18, -p.t * 3, -p.t * 3 + TAU * 0.45); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'column': {
        const env = Math.min(1, k / 0.15) * (1 - k) ** 1.2, W = p.W * (1 - k * 0.55);
        ctx.globalAlpha = env * p.a;
        ctx.drawImage(glow(p.color), p.x - W / 2, p.y - p.H, W, p.H * 1.1);
        ctx.drawImage(glow('#FFFFFF'), p.x - W * 0.18, p.y - p.H, W * 0.36, p.H * 1.1);
        break;
      }
      case 'cel': { // flat cartoon smoke puff with a highlight and a shadow
        const grow = easeOut(Math.min(1, k / 0.35)), shrink = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        const r = p.r * (0.35 + 0.65 * grow) * (0.55 + 0.45 * shrink);
        if (r <= 0.5) break;
        ctx.globalAlpha = p.a * Math.min(1, shrink * 1.6);
        ctx.fillStyle = p.shade;
        ctx.beginPath(); ctx.arc(p.x + r * 0.12, p.y + r * 0.16, r, 0, TAU); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = p.light;
        ctx.beginPath(); ctx.arc(p.x - r * 0.28, p.y - r * 0.3, r * 0.45, 0, TAU); ctx.fill();
        break;
      }
      case 'splash': { // spiky ground splash seen in perspective
        const grow = easeOut(Math.min(1, k / 0.25)), a = p.a * (k > 0.5 ? (1 - k) / 0.5 : 1);
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, p.sy || 0.42);
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        ctx.beginPath();
        p.spikes.forEach(([ang, len, w], i) => {
          const L = len * grow, b = p.r0;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(ang - w) * b, Math.sin(ang - w) * b);
          ctx.lineTo(Math.cos(ang) * (b + L), Math.sin(ang) * (b + L));
          ctx.lineTo(Math.cos(ang + w) * b, Math.sin(ang + w) * b);
        });
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = p.inner; ctx.globalAlpha = a * 0.9;
        ctx.beginPath(); ctx.arc(0, 0, p.r0 * 1.05 * grow, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'slash': { // anime crescent slash: sweeps in, hangs for a beat, fades
        const rev = easeOut(Math.min(1, k / 0.22)), a = p.a * (k > 0.45 ? (1 - k) / 0.55 : 1);
        const N = 26, pts = [], inner = [];
        for (let i = 0; i <= N; i++) {
          const f = i / N, ang = p.a0 + p.span * f * rev * p.dir, w = p.t * Math.sin(Math.PI * f) * (0.4 + 0.6 * rev);
          pts.push([p.x + Math.cos(ang) * (p.R + w / 2), p.y + Math.sin(ang) * (p.R + w / 2) * (p.sy || 1)]);
          inner.push([p.x + Math.cos(ang) * (p.R - w / 2), p.y + Math.sin(ang) * (p.R - w / 2) * (p.sy || 1)]);
        }
        const shape = (scale) => {
          ctx.beginPath();
          pts.forEach(([x, y], i) => { const [ix, iy] = inner[i], mx = (x + ix) / 2, my = (y + iy) / 2; ctx[i ? 'lineTo' : 'moveTo'](mx + (x - mx) * scale, my + (y - my) * scale); });
          for (let i = inner.length - 1; i >= 0; i--) { const [x, y] = pts[i], [ix, iy] = inner[i], mx = (x + ix) / 2, my = (y + iy) / 2; ctx.lineTo(mx + (ix - mx) * scale, my + (iy - my) * scale); }
          ctx.closePath(); ctx.fill();
        };
        ctx.globalAlpha = a * 0.45; ctx.fillStyle = p.color; shape(1.9);
        ctx.globalAlpha = a; ctx.fillStyle = p.color; shape(1);
        ctx.fillStyle = '#FFFFFF'; shape(0.4);
        break;
      }
      case 'zap': { // thick anime lightning: a sharp zig-zag ribbon, wider near the ground, with forks
        const gen = Math.floor(p.t / p.every);
        if (gen !== p.gen) { p.gen = gen; p.paths = zapPaths(p); }
        // bright, a quick strobe, then it thins out and fades
        const strobe = p.t > 0.07 && p.t < 0.11 ? 0.35 : 1, fade = k < 0.5 ? 1 : (1 - k) / 0.5;
        const a = p.a * strobe * fade, thin = 1 - k * 0.45;
        for (const path of p.paths) {
          ribbon(ctx, path.pts, path.w * 3.2 * thin, path.down); ctx.globalAlpha = a * 0.28; ctx.fillStyle = p.color; ctx.fill();
          ribbon(ctx, path.pts, path.w * 1.45 * thin, path.down); ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.fill();
          ribbon(ctx, path.pts, path.w * 0.55 * thin, path.down); ctx.fillStyle = '#FFFFFF'; ctx.fill();
        }
        break;
      }
      case 'hemi': { // glowing half-dome bursting up from the ground
        const grow = easeBack(Math.min(1, k / 0.25)), a = p.a * (k > 0.45 ? (1 - k) / 0.55 : 1), R = p.R * grow;
        if (R <= 1) break;
        ctx.save();
        ctx.beginPath(); ctx.rect(p.x - R * 1.7, p.y - R * 1.7, R * 3.4, R * 1.7); ctx.clip(); // upper half only
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(glow(p.color), p.x - R * 1.5, p.y - R * 1.5, R * 3, R * 3);
        ctx.restore();
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(2, R * 0.08); ctx.globalAlpha = a * 0.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, R, Math.PI, TAU); ctx.stroke();
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, R * 0.025); ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(p.x, p.y, R, Math.PI, TAU); ctx.stroke();
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1.5, R * 0.05); ctx.globalAlpha = a * 0.8;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, R, R * 0.34, 0, 0, TAU); ctx.stroke();
        // white-hot core where the bolt hit
        ctx.globalAlpha = a; ctx.drawImage(glow('#FFFFFF'), p.x - R * 0.7, p.y - R * 0.5, R * 1.4, R * 0.9);
        break;
      }
      case 'dome': { // energy sphere with lightning crawling inside
        const grow = easeBack(Math.min(1, k / 0.3)), a = p.a * (k > 0.6 ? (1 - k) / 0.4 : 1), R = p.R * grow;
        if (R <= 1) break;
        ctx.globalAlpha = a * 0.55;
        ctx.drawImage(glow(p.color), p.x - R * 1.25, p.y - R * 1.25, R * 2.5, R * 2.5);
        ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1.5, R * 0.06);
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, R * 0.02); ctx.stroke();
        if (!p.bolts || p.t - (p.gen || 0) > 0.06) {
          p.gen = p.t;
          p.bolts = Array.from({ length: 3 }, () => { const a1 = rand(0, TAU), a2 = a1 + rand(1.2, 2.6); return jagged(p.x + Math.cos(a1) * R * 0.85, p.y + Math.sin(a1) * R * 0.85, p.x + Math.cos(a2) * R * 0.85, p.y + Math.sin(a2) * R * 0.85, 7, 0.22); });
        }
        ctx.lineJoin = 'round';
        for (const b of p.bolts) {
          polyline(ctx, b);
          ctx.globalAlpha = a * 0.5; ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(2, R * 0.08); ctx.stroke();
          ctx.globalAlpha = a; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, R * 0.025); ctx.stroke();
        }
        break;
      }
      case 'tongue': { // cel flame tongue licking upward
        const a = p.a * Math.min(1, k / 0.15) * (1 - k), h = p.h * (0.4 + 0.6 * easeOut(Math.min(1, k / 0.4))), w = p.w * (1 - k * 0.5);
        const sway = Math.sin(p.t * 14 + p.ph) * w * 0.35;
        const draw = (sc, color) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(p.x - w * sc, p.y);
          ctx.quadraticCurveTo(p.x - w * sc * 0.9, p.y - h * sc * 0.55, p.x + sway, p.y - h * sc);
          ctx.quadraticCurveTo(p.x + w * sc * 0.9, p.y - h * sc * 0.55, p.x + w * sc, p.y);
          ctx.quadraticCurveTo(p.x, p.y + w * sc * 0.6, p.x - w * sc, p.y);
          ctx.fill();
        };
        ctx.globalAlpha = a * 0.5; draw(1.35, p.color);
        ctx.globalAlpha = a; draw(1, p.color);
        ctx.globalAlpha = a; draw(0.45, '#FFFFFF');
        break;
      }
      case 'shard': {
        const a = p.a * (1 - k) ** 1.5, s = p.s;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + p.spin * p.t);
        ctx.globalAlpha = a * 0.55; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.32, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.32, 0); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = a; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.restore();
        break;
      }
    }
  }

  // ------------------------------------------------------------ building blocks
  sparks(x, y, S, n, pal, { speed = [5, 13], g = 3, len = [0.2, 0.5], life = [0.35, 0.8], spread = TAU, dir = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir + rand(-spread / 2, spread / 2), sp = S * rand(...speed);
      this.add({ type: 'streak', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sp0: sp, drag: 3.2, g: S * g, len: S * rand(...len), w: Math.max(1.3, S * 0.028), color: pick(pal), core: '#FFFFFF', a: 1, life: rand(...life) });
    }
  }
  rays(x, y, S, n, color, { len = [2, 4], w = [0.04, 0.1], life = [0.35, 0.6], r0 = 0.15 } = {}) {
    for (let i = 0; i < n; i++) this.add({ type: 'ray', x, y, ang: rand(0, TAU), len: S * rand(...len), w: S * rand(...w), r0: S * r0, color, a: 0.9, life: rand(...life) });
  }
  cracks(x, y, S, n, color, { len = [0.9, 1.9], life = 1.3 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.3, 0.3), L = S * rand(...len);
      const pts = jagged(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 7, 0.18);
      this.add({ type: 'crack', pts, w: Math.max(1.4, S * 0.04), color, a: 1, life: life * rand(0.85, 1.15) });
      if (Math.random() < 0.6) { // a branch
        const [bx, by] = pts[3], b = a + rand(-0.9, 0.9), BL = L * 0.45;
        this.add({ type: 'crack', pts: jagged(bx, by, bx + Math.cos(b) * BL, by + Math.sin(b) * BL, 4, 0.2), w: Math.max(1, S * 0.028), color, a: 0.85, life: life * 0.9 });
      }
    }
  }
  ring(x, y, S, color, { r0 = 0.2, r1 = 2.2, w = 0.12, life = 0.55, core } = {}) {
    this.add({ type: 'ring', x, y, r0: S * r0, r1: S * r1, w: S * w, color, core, a: 1, life });
  }
  orb(x, y, size, color, life, a = 1) {
    this.add({ type: 'glow', x, y, s0: size, s1: size * 1.25, color, a, life, ease: true });
  }
  embers(x, y, S, n, pal) {
    for (let i = 0; i < n; i++) {
      const s = S * rand(0.07, 0.15);
      this.add({ type: 'glow', x: x + rand(-0.4, 0.4) * S, y: y + rand(-0.4, 0.4) * S, vx: rand(-1, 1) * S * 0.9, vy: -S * rand(0.5, 1.8), drag: 0.6, s0: s, s1: s * 0.4, color: pick(pal), a: 1, life: rand(0.9, 1.8), fadeIn: 0.1 });
    }
  }
  flames(x, y, S, pal, { dur = 0.9, rate = 70, width = 0.42, rise = [1.6, 3.4], size = [0.28, 0.55] } = {}) {
    let acc = 0;
    this.add({
      type: 'none', life: dur, emit: (p, dt) => {
        acc += rate * dt;
        for (; acc >= 1; acc--) {
          const s = S * rand(...size);
          this.add({ type: 'glow', x: x + rand(-width, width) * S, y: y + S * rand(0.1, 0.4), vx: rand(-0.3, 0.3) * S, vy: -S * rand(...rise), drag: 1.2, s0: s, s1: s * 0.15, color: pick(pal), a: 0.9, life: rand(0.45, 0.9), fade: 0.8 });
        }
      },
    });
  }

  /** Cartoon smoke: a cluster of flat puffs. */
  puffs(x, y, S, n, { color = '#5B5F7A', shade = '#3A3D52', light = '#8E92AE', rise = 1, spread = 0.7, size = [0.3, 0.55], life = [0.7, 1.2], a = 1, ring = false } = {}) {
    for (let i = 0; i < n; i++) {
      const ang = ring ? (i / n) * TAU + rand(-0.2, 0.2) : rand(0, TAU), d = ring ? spread * S : rand(0, spread) * S;
      const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d * (ring ? 0.45 : 1);
      this.add({ type: 'cel', x: px, y: py, vx: Math.cos(ang) * S * (ring ? 1.6 : 0.6), vy: -S * rise * rand(0.4, 1.2) + (ring ? Math.sin(ang) * S * 0.6 : 0), drag: 2.5, r: S * rand(...size), color, shade, light, a, life: rand(...life) });
    }
  }
  splash(x, y, S, { color = '#2B3D8F', inner = '#9FB6FF', r0 = 0.35, n = 9, len = [0.6, 1.4], life = 0.6, sy = 0.42 } = {}) {
    const spikes = Array.from({ length: n }, (_, i) => [(i / n) * TAU + rand(-0.25, 0.25), S * rand(...len), rand(0.12, 0.22)]);
    this.add({ type: 'splash', x, y, r0: S * r0, spikes, color, inner, sy, a: 1, life });
  }
  crescent(x, y, S, { pal = PAL.red, R = 0.9, a0 = rand(0, TAU), span = 2.6, dir = 1, t = 0.32, life = 0.55, sy = 1 } = {}) {
    this.add({ type: 'slash', x, y, R: S * R, a0, span, dir, t: S * t, color: pal[2], sy, a: 1, life });
  }
  tongues(x, y, S, pal, { n = 10, spread = 0.45, h = [0.7, 1.4], w = [0.16, 0.28], life = [0.5, 0.85], delay = 0 } = {}) {
    for (let i = 0; i < n; i++) this.later(delay + rand(0, 250), () => this.add({
      type: 'tongue', x: x + rand(-spread, spread) * S, y: y + rand(0, 0.35) * S, vx: 0, vy: -S * rand(0.4, 1), drag: 1,
      h: S * rand(...h), w: S * rand(...w), ph: rand(0, TAU), color: pick(pal.slice(1, 3)), a: 0.95, life: rand(...life),
    }));
  }
  /** Lightning from the sky with a ground splash (Thunder, Thunder God). */
  /**
   * Lightning strike (Thunder, Thunder God), after the classic anime look:
   * a thick, sharp zig-zag bolt with forks slams down, the screen flashes, a glowing half-dome
   * bursts up from the ground over a flat dark splash, and electric arcs crawl outward.
   */
  strike(sq, { pal = PAL.blue, delay = 0, big = false } = {}) {
    this.go(() => {
      const [x, y, s] = this.at(sq), S = big ? s * 1.25 : s;
      const gy = y + S * 0.18; // where the bolt meets the ground
      this.dim(0.74, 1.15);
      // a faint pre-strike crackle in the sky
      this.add({ type: 'glow', x: x + S * 0.3, y: y - S * 7, s0: S * 2, s1: S * 3, color: pal[2], a: 0.5, life: 0.25, fadeIn: 0.5 });
      this.later(90, () => {
        this.add({ type: 'zap', x0: x + rand(-0.6, 0.6) * S, y0: y - S * 11, x1: x, y1: gy, w: S * 0.2, color: pal[1], a: 1, life: 0.42, every: 0.1 });
        // impact: white-out flash, then the ground reacts
        this.orb(x, gy, S * 7, '#FFFFFF', 0.16);
        this.add({ type: 'flare', x, y: gy, len: S * 4.5, color: pal[1], a: 1, life: 0.35 });
        this.add({ type: 'hemi', x, y: gy, R: S * 0.95, color: pal[1], a: 1, life: 0.7 });
        this.splash(x, gy, S * 1.15, { color: '#26399A', inner: '#4F74FF', n: 11, len: [0.7, 1.6], life: 0.75, sy: 0.38 });
        this.splash(x, gy, S * 0.8, { color: '#3D63F0', inner: '#BFD4FF', n: 8, len: [0.35, 0.8], life: 0.5, sy: 0.38 });
        this.add({ type: 'ring', x, y: gy, r0: S * 0.4, r1: S * 2.6, w: S * 0.09, color: pal[1], core: '#FFFFFF', a: 1, life: 0.55, sy: 0.36 });
        this.sparks(x, gy, S, 16, ['#FFFFFF', pal[1]], { speed: [5, 12], g: 6, dir: -Math.PI / 2, spread: 2.6 });
        // electric arcs crawling out along the ground
        for (let i = 0; i < 6; i++) this.later(40 + i * 45, () => {
          const a = rand(0, TAU), r = S * rand(0.9, 1.8);
          this.lightning(x, gy, x + Math.cos(a) * r, gy + Math.sin(a) * r * 0.38, pal[2], { w: Math.max(1.4, S * 0.03), life: 0.22 });
        });
      });
      // a second, thinner afterstrike
      this.later(300, () => this.add({ type: 'zap', x0: x + rand(-0.9, 0.9) * S, y0: y - S * 10, x1: x, y1: gy, w: S * 0.1, color: pal[1], a: 0.85, life: 0.2, every: 1 }));
    }, delay);
  }

  // ------------------------------------------------------------ effects
  /** Big blast. Styles keep it from repeating: fire | mushroom | plasma | nova | dirt. */
  explosion(sq, { scale = 1, pal = PAL.fire, delay = 0, dim = 0.55, style = 'fire' } = {}) {
    if (style !== 'fire') return this.blast(sq, { scale, pal, delay, dim, style });
    this.go(() => {
      const [x, y, s] = this.at(sq), S = s * scale;
      this.dim(dim, 1.2);
      this.orb(x, y, S * 5.5, pal[0], 0.24);
      this.orb(x, y, S * 2.8, pal[1], 0.5, 0.95);
      for (let i = 0; i < 46; i++) {
        const a = rand(0, TAU), sp = S * rand(0.8, 4.6), sz = S * rand(0.35, 0.9);
        this.add({ type: 'glow', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 4.5, g: -S * 1.6, s0: sz, s1: sz * 0.2, color: pick(pal.slice(1)), a: 0.7, life: rand(0.45, 0.95) });
      }
      this.sparks(x, y, S, 34, [pal[0], pal[1]]);
      this.rays(x, y, S, 12, pal[0]);
      this.ring(x, y, S, pal[1], { r1: 2.5 });
      this.ring(x, y, S, pal[0], { r1: 3.5, w: 0.05, life: 0.8 });
      this.cracks(x, y, S, 7, pal[2]);
      this.embers(x, y, S, 18, [pal[0], pal[1], '#B6FF7A']);
    }, delay);
  }

  blast(sq, { scale = 1, pal = PAL.fire, delay = 0, dim = 0.55, style }) {
    this.go(() => {
      const [x, y, s] = this.at(sq), S = s * scale;
      this.dim(dim, 1.3);
      this.orb(x, y, S * 5, pal[0], 0.2);
      if (style === 'mushroom') { // fireball + cartoon smoke column
        this.orb(x, y, S * 2.6, pal[1], 0.45);
        for (let i = 0; i < 30; i++) { const a = rand(0, TAU), sp = S * rand(0.5, 3), sz = S * rand(0.3, 0.75); this.add({ type: 'glow', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - S * 1.5, drag: 4, g: -S * 2, s0: sz, s1: sz * 0.2, color: pick(pal.slice(1)), a: 0.75, life: rand(0.4, 0.8) }); }
        this.later(120, () => this.puffs(x, y - S * 0.4, S, 14, { color: '#5A4A44', shade: '#3A2E2A', light: '#8C7A70', rise: 2.2, spread: 0.5, size: [0.3, 0.55], life: [0.8, 1.3] }));
        this.puffs(x, y + S * 0.2, S, 10, { color: '#6B5B55', shade: '#43383A', light: '#9A8A80', ring: true, spread: 0.6, size: [0.22, 0.4], rise: 0.2 });
        this.ring(x, y + S * 0.15, S, pal[1], { r1: 2.8, w: 0.1, life: 0.6 });
        this.sparks(x, y, S, 26, [pal[0], pal[1]]);
        this.rays(x, y, S, 8, pal[0], { len: [1.6, 3] });
      } else if (style === 'plasma') { // energy dome that pops
        this.add({ type: 'dome', x, y, R: S * 1.05, color: pal[1], a: 1, life: 0.7 });
        this.add({ type: 'flare', x, y, len: S * 4, color: pal[1], a: 1, life: 0.45 });
        this.later(250, () => { this.ring(x, y, S, pal[1], { r0: 0.8, r1: 3, w: 0.1, life: 0.55 }); this.sparks(x, y, S, 30, [pal[0], pal[1]], { speed: [6, 14] }); this.orb(x, y, S * 3, pal[0], 0.2); });
        this.cracks(x, y, S, 6, pal[2]);
      } else if (style === 'nova') { // star burst
        this.add({ type: 'flare', x, y, len: S * 5, color: pal[1], a: 1, life: 0.5, rot: rand(0, 1) });
        this.rays(x, y, S, 18, pal[0], { len: [1.5, 3.5], w: [0.03, 0.07] });
        this.ring(x, y, S, pal[1], { r1: 2, w: 0.06, life: 0.5 });
        this.ring(x, y, S, pal[0], { r1: 3, w: 0.03, life: 0.7 });
        for (let i = 0; i < 16; i++) this.add({ type: 'flare', x: x + rand(-1.2, 1.2) * S, y: y + rand(-1.2, 1.2) * S, len: S * rand(0.4, 0.9), color: pal[0], a: 1, life: rand(0.3, 0.6) });
      } else { // dirt: a mine going off
        this.splash(x, y + S * 0.1, S, { color: '#4A3A2C', inner: pal[1], n: 11, len: [0.8, 1.7] });
        this.puffs(x, y, S, 16, { color: '#7A6A58', shade: '#4E4236', light: '#A89884', rise: 1.6, spread: 0.6, size: [0.25, 0.5] });
        this.orb(x, y, S * 2.4, pal[1], 0.4);
        this.sparks(x, y, S, 18, [pal[0], pal[1]], { g: 8 });
      }
      this.embers(x, y, S, 12, [pal[0], pal[1]]);
    }, delay);
  }

  /** Crescent Slash: three anime sword arcs across the squares in front of the piece. */
  slash(from, area = [], hits = [], pal = PAL.red) {
    this.go(() => {
      const [fx0, fy0, s] = this.at(from);
      const mid = area[1] || area[0] || from, [x, y] = this.at(mid);
      this.dim(0.6, 1.1);
      this.add({ type: 'flare', x: fx0, y: fy0, len: s * 2.4, color: pal[1], a: 1, life: 0.3 });
      const base = Math.atan2(y - fy0, x - fx0);
      [[base - 2.3, 1], [base + 2.3, -1], [base - 1.6, 1]].forEach(([a0, dir], i) => this.later(i * 90, () => {
        this.crescent(x, y, s, { pal, R: 1.05 + i * 0.12, a0, span: 2.2, dir, t: 0.34, life: 0.6, sy: 0.8 });
        this.sparks(x, y, s, 10, [pal[0], pal[1]], { speed: [5, 11], life: [0.25, 0.5] });
      }));
      hits.forEach((h, i) => this.later(160 + i * 70, () => {
        const [hx, hy] = this.at(h);
        this.add({ type: 'flare', x: hx, y: hy, len: s * 3, color: pal[1], a: 1, life: 0.4, rot: 0.6 });
        this.puffs(hx, hy, s, 6, { color: '#3B2233', shade: '#24131F', light: '#7A4560', rise: 0.8, spread: 0.3, size: [0.18, 0.3], life: [0.5, 0.8] });
      }));
    });
  }

  /** Hyper Beam: a long charge, then a massive beam to the board edge with rings along it. */
  hyperbeam(from, to, hits = [], pal = PAL.blue) {
    this.go(() => {
      const [x0, y0, s] = this.at(from), [x1, y1] = this.at(to);
      const ang = Math.atan2(y1 - y0, x1 - x0), ex = x1 + Math.cos(ang) * s * 0.6, ey = y1 + Math.sin(ang) * s * 0.6;
      this.dim(0.78, 2.1);
      this.charge(from, pal, 0.55);
      this.add({ type: 'circle', x: x0, y: y0, R: s * 1.1, n: 6, spin: 5, color: pal[1], a: 1, life: 0.7 });
      this.later(560, () => {
        this.add({ type: 'beam', x0, y0, x1: ex, y1: ey, w: s * 0.75, color: pal[2], life: 1.1 });
        this.add({ type: 'beam', x0, y0, x1: ex, y1: ey, w: s * 0.3, color: pal[1], life: 1.1 });
        this.add({ type: 'flare', x: x0, y: y0, len: s * 6, color: pal[1], a: 1, life: 0.7 });
        this.orb(x0, y0, s * 6, '#FFFFFF', 0.2);
        const len = Math.hypot(ex - x0, ey - y0), n = Math.max(2, Math.floor(len / s));
        for (let i = 1; i <= n; i++) this.later(i * 45, () => { // rings travelling down the beam
          const t = i / (n + 1), rx = x0 + (ex - x0) * t, ry = y0 + (ey - y0) * t;
          this.add({ type: 'ring', x: rx, y: ry, r0: s * 0.5, r1: s * 0.9, w: s * 0.08, color: pal[1], core: '#FFFFFF', a: 1, life: 0.5, sy: 1 });
          this.sparks(rx, ry, s, 3, [pal[0], pal[1]], { dir: ang + Math.PI / 2 * (i % 2 ? 1 : -1), spread: 1.2, speed: [3, 7], life: [0.2, 0.4] });
        });
        hits.forEach((h, i) => this.blast(h, { scale: 0.95, pal, delay: 120 + i * 110, dim: 0.78, style: 'plasma' }));
      });
    });
  }

  /** Orbital Strike: targeting circle, then a pillar of light from space and a mushroom blast. */
  orbital(sq, area = [], pal = PAL.blue) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.8, 2.2);
      this.add({ type: 'circle', x, y, R: s * 1.6, n: 6, spin: -3, color: PAL.red[2], a: 1, life: 0.75 });
      this.add({ type: 'circle', x, y, R: s * 1.0, n: 5, spin: 4, color: PAL.red[1], a: 0.8, life: 0.75 });
      this.later(620, () => {
        this.add({ type: 'column', x, y: y + s * 0.4, W: s * 3.4, H: s * 13, color: pal[1], a: 1, life: 0.9 });
        this.orb(x, y, s * 8, '#FFFFFF', 0.25);
        this.add({ type: 'dome', x, y, R: s * 1.7, color: pal[1], a: 1, life: 0.8 });
        this.splash(x, y + s * 0.2, s * 1.6, { color: '#1A2660', inner: pal[1], n: 12 });
        this.ring(x, y, s, pal[1], { r1: 4.5, w: 0.14, life: 0.8 });
        this.ring(x, y, s, '#FFFFFF', { r1: 3, w: 0.05, life: 0.6 });
        this.cracks(x, y, s * 1.4, 9, pal[2]);
        this.later(200, () => this.puffs(x, y - s * 0.5, s * 1.5, 18, { color: '#56607E', shade: '#353C55', light: '#8A94B8', rise: 2.4, spread: 0.6, size: [0.3, 0.55], life: [0.9, 1.5] }));
        this.puffs(x, y + s * 0.3, s * 1.5, 14, { ring: true, spread: 0.75, size: [0.25, 0.4], rise: 0.2 });
        area.filter(a => a !== sq).forEach((a2, i) => this.later(60 + i * 30, () => { const [ax, ay] = this.at(a2); this.orb(ax, ay, s * 1.6, pal[1], 0.4, 0.8); }));
        this.embers(x, y, s * 1.5, 24, [pal[0], pal[1], '#FFFFFF']);
      });
    });
  }

  /** Absolute Zero: blue fire, a frost dome and ice over the whole area. */
  zero(sq, sqs = [], area = []) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.7, 1.7);
      this.add({ type: 'circle', x, y, R: s * 1.6, n: 6, spin: 1.5, color: PAL.ice[1], a: 1, life: 1.4 });
      this.tongues(x, y + s * 0.3, s, PAL.ice, { n: 16, spread: 1.2, h: [0.8, 1.7] });
      this.add({ type: 'dome', x, y, R: s * 1.7, color: PAL.ice[2], a: 0.9, life: 1.1 });
      this.later(300, () => { this.orb(x, y, s * 6, '#FFFFFF', 0.2); this.ring(x, y, s, PAL.ice[1], { r1: 3.6, w: 0.1, life: 0.7 }); });
      (sqs.length ? sqs : area).forEach((t, i) => this.later(320 + i * 50, () => this.ice(t)));
      this.puffs(x, y + s * 0.4, s * 1.4, 12, { color: '#B9D4EE', shade: '#7E9CC0', light: '#FFFFFF', ring: true, spread: 0.8, size: [0.22, 0.38], rise: 0.3, a: 0.9 });
    });
  }

  /** Golden barrier over a group of pieces. */
  aegis(sq, sqs = []) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.55, 1.4);
      this.add({ type: 'circle', x, y, R: s * 1.55, n: 6, spin: 1.2, color: PAL.gold[1], a: 1, life: 1.3 });
      this.add({ type: 'dome', x, y, R: s * 1.6, color: PAL.gold[1], a: 1, life: 1.2 });
      this.rays(x, y, s, 12, PAL.gold[0], { len: [2, 3.6] });
      sqs.forEach((t, i) => this.later(250 + i * 60, () => this.pop(t, PAL.gold, { scale: 0.7 })));
    });
  }

  /** A pawn ascends: light column, golden wings, rays, then a crown burst. */
  ascend(sq) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.72, 1.9);
      this.add({ type: 'column', x, y: y + s * 0.4, W: s * 1.7, H: s * 11, color: PAL.gold[1], a: 1, life: 1.3 });
      this.add({ type: 'circle', x, y: y + s * 0.2, R: s * 1.2, n: 6, spin: 2, color: PAL.gold[1], a: 1, life: 1.4, sy: 0.5 });
      this.flames(x, y, s, PAL.gold, { dur: 1.1, rate: 90 });
      [[-1, Math.PI * 0.95], [1, Math.PI * 0.05]].forEach(([d, a0], i) => this.later(250 + i * 40, () => { // wings
        for (let j = 0; j < 3; j++) this.crescent(x + d * s * 0.2, y - s * 0.2, s, { pal: PAL.gold, R: 0.75 + j * 0.28, a0: a0 + (d < 0 ? 0.1 : -0.1) * j, span: 1.25, dir: d < 0 ? 1 : -1, t: 0.22 - j * 0.04, life: 1.1, sy: 0.85 });
      }));
      this.later(700, () => { this.orb(x, y, s * 6, '#FFFFFF', 0.25); this.rays(x, y, s, 20, PAL.gold[0], { len: [3, 6], life: [0.6, 1] }); this.ring(x, y, s, PAL.gold[1], { r1: 4, w: 0.1, life: 0.8 }); this.embers(x, y, s * 1.4, 26, PAL.gold); });
    });
  }

  /** Time Stop: a clock face sweeps the board and the world inverts for a moment. */
  timestop() {
    this.go(() => {
      const [x, y, s] = this.boardCenter();
      this.dim(0.45, 1.6);
      this.add({ type: 'circle', x, y, R: s * 3.6, n: 6, spin: -0.8, color: '#C9B8FF', a: 1, life: 1.5 });
      this.add({ type: 'circle', x, y, R: s * 2.2, n: 5, spin: 1.6, color: '#FFE58A', a: 0.9, life: 1.4 });
      this.ring(x, y, s, '#FFFFFF', { r0: 0.2, r1: 7, w: 0.12, life: 1.1 });
      this.later(180, () => this.ring(x, y, s, '#B18CFF', { r0: 0.2, r1: 6, w: 0.06, life: 1 }));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; this.add({ type: 'ray', x, y, ang: a, len: s * 3.2, w: s * (i % 3 ? 0.03 : 0.07), r0: s * 2.4, color: '#E9DDFF', a: 0.8, life: 1.2 }); }
    });
  }

  /** Hypnosis: spirals pulling the piece over. */
  hypno(sq) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.6, 1.4);
      this.add({ type: 'circle', x, y, R: s * 1.2, n: 5, spin: 5, color: PAL.violet[1], a: 1, life: 1.2 });
      for (let i = 0; i < 5; i++) this.add({ type: 'orbit', cx: x, cy: y, r: s * 1.6, ang: (i * TAU) / 5, color: pick([PAL.violet[1], '#FF7AE0', '#FFFFFF']), w: Math.max(1.6, s * 0.05), a: 0.95, life: 1.1, tail: 18,
        emit: (p, dt) => { p.ang += dt * 7; p.r = Math.max(s * 0.2, p.r - dt * s * 1.3); } });
      this.later(800, () => this.pop(sq, PAL.violet, { scale: 1.2 }));
    });
  }

  /** "That pawn was a queen!" / an imposter popping: a cartoon smoke burst. */
  poof(sq, { pal = PAL.violet, big = true } = {}) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(big ? 0.5 : 0.3, 0.9);
      this.puffs(x, y, s, big ? 16 : 10, { color: '#8B86A8', shade: '#5D5878', light: '#D6D2EA', spread: 0.5, size: [0.25, 0.45], rise: 0.5, life: [0.6, 1] });
      this.add({ type: 'flare', x, y, len: s * 3.4, color: pal[1], a: 1, life: 0.45 });
      this.sparks(x, y, s, 14, [pal[0], pal[1]], { speed: [3, 8] });
    });
  }

  /** Captures: a sharp star flare, sparks, a ring and short cracks. */
  capture(sq, { pal = PAL.gold, delay = 0, power = false, style = 'fire' } = {}) {
    if (power) return this.explosion(sq, { scale: 0.85, pal, delay, dim: 0.45, style });
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.3, 0.6);
      this.add({ type: 'flare', x, y, len: s * 3.4, color: pal[1], a: 1, life: 0.38, rot: rand(-0.3, 0.3) });
      this.orb(x, y, s * 1.9, pal[1], 0.32, 0.9);
      this.sparks(x, y, s, 20, [pal[0], pal[1]], { speed: [4, 10] });
      this.ring(x, y, s, pal[1], { r1: 1.5, w: 0.09, life: 0.45 });
      this.cracks(x, y, s, 4, pal[2], { len: [0.45, 0.85], life: 0.9 });
    }, delay);
  }

  /** Light rays + red flare on a king in check. */
  check(sq) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.add({ type: 'flare', x, y, len: s * 3, color: PAL.red[2], a: 0.9, life: 0.5 });
      this.ring(x, y, s, PAL.red[1], { r0: 0.4, r1: 1.4, w: 0.07, life: 0.6 });
      this.ring(x, y, s, PAL.red[2], { r0: 0.3, r1: 1.1, w: 0.05, life: 0.7 });
    }, 0);
  }

  /** Checkmate: the screen goes dark, two shockwaves, a sea of light rays. */
  mate(sq) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.72, 2.2);
      this.explosion(sq, { scale: 1.7, pal: PAL.gold, dim: 0.72 });
      this.rays(x, y, s, 22, '#FFF1B8', { len: [4, 8], w: [0.05, 0.12], life: [0.8, 1.3] });
      this.later(240, () => this.ring(x, y, s, PAL.gold[1], { r1: 6, w: 0.08, life: 1.1 }));
      this.later(480, () => this.embers(x, y, s * 1.4, 30, PAL.gold));
    }, 0);
  }

  /** A swirling black hole that sucks in light and pieces, then collapses with a flash. */
  blackhole(sq, eaten = [], { dur = 2.1, scale = 1 } = {}) {
    this.go(() => {
      const [x, y, s0] = this.at(sq), s = s0 * scale;
      const pal = ['#B18CFF', '#7B5CFF', '#6FB6FF', '#FFFFFF', '#FF7AE0'];
      this.dim(0.78, dur + 0.5);
      this.add({ type: 'disk', x, y, R: s * 0.5, color: '#C9A8FF', life: dur });
      this.add({ type: 'circle', x, y, R: s * 1.25, n: 5, spin: 1.4, color: '#7B5CFF', a: 0.6, life: dur, sy: 0.92 });
      this.add({ type: 'glow', x, y, s0: s * 4.2, s1: s * 2.6, color: '#6A3CFF', a: 0.9, life: dur, fadeIn: 0.12, fade: 0.5 });
      // spinning accretion arcs right around the event horizon
      for (let i = 0; i < 3; i++) {
        this.add({ type: 'orbit', cx: x, cy: y, r: s * (0.62 + i * 0.12), ang: (i * TAU) / 3, color: i === 1 ? '#FFFFFF' : '#C9A8FF', w: Math.max(2, s * 0.07), a: 0.95, life: dur - 0.15, tail: 22,
          emit: (p, dt) => { p.ang += dt * (7 - i * 1.5); } });
      }
      const spawn = (cx, cy, r, a, color, w) => this.add({
        type: 'orbit', cx, cy, r, ang: a, color, w, a: 0.95, life: 4,
        emit: (p, dt) => {
          const pull = Math.max(0.35, (p.r0 || (p.r0 = p.r)) / Math.max(p.r, 1));
          p.ang += dt * 2.4 * pull ** 0.9;
          p.r -= dt * s * 1.25 * pull ** 0.6;
          if (p.r < s * 0.48) p.life = 0;
        },
      });
      let acc = 0;
      this.add({
        type: 'none', life: dur - 0.3, emit: (p, dt) => {
          acc += 150 * dt;
          for (; acc >= 1; acc--) spawn(x, y, s * rand(1.1, 3.4), rand(0, TAU), pick(pal), Math.max(1.2, s * rand(0.02, 0.05)));
        },
      });
      eaten.forEach(e => {
        const [ex, ey] = this.at(e), r = Math.hypot(ex - x, ey - y), a = Math.atan2(ey - y, ex - x);
        for (let i = 0; i < 26; i++) this.later(i * 18, () => spawn(x, y, r * rand(0.9, 1.1), a + rand(-0.25, 0.25), pick(['#FFFFFF', '#FFE58A', '#B18CFF']), Math.max(1.6, s * 0.05)));
      });
      this.later(dur * 1000 - 220, () => {
        this.orb(x, y, s * 6, '#E9DDFF', 0.3);
        this.ring(x, y, s, '#B18CFF', { r0: 0.4, r1: 4, w: 0.12, life: 0.7 });
        this.ring(x, y, s, '#FFFFFF', { r0: 0.3, r1: 2.6, w: 0.05, life: 0.55 });
        this.rays(x, y, s, 14, '#D9C2FF', { len: [2.5, 5] });
        this.sparks(x, y, s, 26, pal);
      });
    }, 0);
  }

  /** A burning meteor streaks in from the corner and detonates at `impact` ms. */
  meteor(sq, impact = 520) {
    const travel = 0.42;
    this.go(() => {
      const [x, y, s] = this.at(sq), x0 = x + s * 4.5, y0 = y - s * 7.5;
      this.add({
        type: 'none', life: travel, emit: p => {
          const k = easeIn(Math.min(1, p.t / travel)), hx = x0 + (x - x0) * k, hy = y0 + (y - y0) * k;
          for (let i = 0; i < 4; i++) {
            const sz = s * rand(0.35, 0.75);
            this.add({ type: 'glow', x: hx + rand(-0.12, 0.12) * s, y: hy + rand(-0.12, 0.12) * s, vx: rand(-0.4, 0.4) * s, vy: rand(-0.4, 0.4) * s, drag: 2, s0: sz, s1: sz * 0.1, color: pick(PAL.fire), a: 0.9, life: rand(0.25, 0.5) });
          }
          this.add({ type: 'glow', x: hx, y: hy, s0: s * 1.3, s1: s * 1.3, color: '#FFF1B8', a: 1, life: 0.035 });
        },
      });
    }, Math.max(0, impact - travel * 1000));
    this.explosion(sq, { scale: 1.2, delay: impact, dim: 0.6 });
  }

  /** Laser: charge orb, then a fat beam with sparks along it. */
  beam(from, to, pal = PAL.blue, delay = 0) {
    this.go(() => {
      const [x0, y0, s] = this.at(from), [x1, y1] = this.at(to);
      this.dim(0.5, 0.9);
      this.add({ type: 'beam', x0, y0, x1, y1, w: s * 0.22, color: pal[2], life: 0.55 });
      this.add({ type: 'flare', x: x0, y: y0, len: s * 2.6, color: pal[1], a: 1, life: 0.4 });
      const ang = Math.atan2(y1 - y0, x1 - x0);
      for (let i = 0; i < 18; i++) {
        const t = Math.random(), px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        this.sparks(px, py, s, 1, pal.slice(0, 2), { dir: ang + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2, spread: 1.2, speed: [2, 6], life: [0.2, 0.45] });
      }
    }, delay);
  }

  /** Energy gathering into a square (before a laser or a big power). */
  charge(sq, pal = PAL.blue, dur = 0.38) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      for (let i = 0; i < 28; i++) {
        const a = rand(0, TAU), r = s * rand(1, 2.4), life = rand(0.25, dur);
        this.add({ type: 'streak', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: (-Math.cos(a) * r) / life, vy: (-Math.sin(a) * r) / life, sp0: r / life, len: s * 0.35, w: Math.max(1.2, s * 0.025), color: pick(pal), core: '#FFFFFF', a: 1, life });
      }
      this.add({ type: 'glow', x, y, s0: s * 0.4, s1: s * 1.8, color: pal[1], a: 0.9, life: dur + 0.1, fadeIn: 0.8 });
    });
  }

  lightning(x0, y0, x1, y1, color, { w = 2, life = 0.4 } = {}) {
    this.add({ type: 'bolt', x0, y0, x1, y1, color, w, a: 1, life });
  }

  /** EMP: blue magic circle, shockwave, lightning arcing to every square in the blast. */
  emp(sq, sqs = []) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.6, 1.3);
      this.add({ type: 'circle', x, y, R: s * 1.55, n: 6, spin: 2.2, color: PAL.blue[1], a: 1, life: 1.1 });
      this.add({ type: 'flare', x, y, len: s * 4, color: PAL.blue[1], a: 1, life: 0.45 });
      this.ring(x, y, s, PAL.blue[1], { r1: 3.2, life: 0.7 });
      this.ring(x, y, s, '#FFFFFF', { r1: 2.2, w: 0.05, life: 0.5 });
      sqs.filter(t => t !== sq).forEach((t, i) => this.later(i * 45, () => {
        const [tx, ty] = this.at(t);
        this.lightning(x, y, tx, ty, PAL.blue[2], { w: Math.max(1.6, s * 0.035), life: 0.45 });
        this.orb(tx, ty, s * 1.2, PAL.blue[1], 0.4, 0.8);
      }));
      this.sparks(x, y, s, 24, PAL.blue.slice(0, 2));
    });
  }

  magic(sq, pal, { R = 0.95, n = 6, life = 1.2, spin = 1.6, delay = 0 } = {}) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.add({ type: 'circle', x, y, R: s * R, n, spin, color: pal[1], a: 1, life });
      this.orb(x, y, s * 2, pal[2], life * 0.5, 0.55);
    }, delay);
  }

  /** Column of light with rising motes (teleport arrival, holy powers). */
  pillar(sq, pal = PAL.gold, delay = 0) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.4, 0.9);
      this.add({ type: 'column', x, y: y + s * 0.35, W: s * 1.15, H: s * 7, color: pal[1], a: 1, life: 0.95 });
      this.add({ type: 'flare', x, y, len: s * 3, color: pal[1], a: 1, life: 0.45 });
      this.ring(x, y, s, pal[1], { r0: 0.3, r1: 1.4, w: 0.08, life: 0.6 });
      for (let i = 0; i < 22; i++) {
        const sz = s * rand(0.08, 0.18);
        this.add({ type: 'glow', x: x + rand(-0.4, 0.4) * s, y: y + rand(-0.2, 0.4) * s, vx: 0, vy: -s * rand(2, 5), drag: 0.8, s0: sz, s1: sz * 0.3, color: pick(pal), a: 1, life: rand(0.5, 1) });
      }
    }, delay);
  }

  /** Shadow army rising: dark purple smoke, violet flames, a summoning circle. */
  shadowRise(sq, delay = 0) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.66, 1.7);
      this.add({ type: 'circle', x, y, R: s * 1.05, n: 5, spin: -1.3, color: PAL.shadow[1], a: 1, life: 1.5 });
      this.add({ type: 'glow', x, y, s0: s * 1, s1: s * 3.2, color: PAL.shadow[2], a: 0.8, life: 1.3 });
      for (let i = 0; i < 18; i++) {
        const sz = s * rand(0.5, 0.9);
        this.add({ type: 'smoke', x: x + rand(-0.55, 0.55) * s, y: y + rand(-0.1, 0.4) * s, vx: rand(-0.5, 0.5) * s, vy: -s * rand(0.7, 1.8), drag: 1, s0: sz, s1: sz * 2.2, color: '#12051F', a: 0.6, life: rand(0.8, 1.4), fadeIn: 0.15 });
      }
      this.flames(x, y, s, PAL.shadow, { dur: 1.1, rate: 140, width: 0.5, rise: [2, 4.4], size: [0.35, 0.7] });
      // wisps of shadow spiralling up around the piece
      for (let i = 0; i < 4; i++) {
        this.add({ type: 'orbit', cx: x, cy: y, r: s * 0.55, ang: (i * TAU) / 4, color: PAL.shadow[1], w: Math.max(1.6, s * 0.045), a: 0.9, life: 1.1, tail: 16,
          emit: (p, dt) => { p.ang += dt * 6; p.cy -= dt * s * 2.2; p.r *= 1 - dt * 0.6; } });
      }
      this.sparks(x, y, s, 16, PAL.shadow.slice(0, 2), { dir: -Math.PI / 2, spread: 1.4, speed: [4, 9], g: -1 });
      this.add({ type: 'column', x, y: y + s * 0.35, W: s * 0.9, H: s * 4.5, color: PAL.shadow[2], a: 0.8, life: 1.1 });
      this.later(700, () => this.add({ type: 'flare', x, y: y - s * 0.1, len: s * 2.6, color: PAL.shadow[1], a: 1, life: 0.5 }));
    }, delay);
  }

  /** Rising flames around a piece (evolution, power-ups). */
  aura(sq, pal = PAL.gold, delay = 0) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.45, 1.1);
      this.flames(x, y, s, pal, { dur: 0.9 });
      this.ring(x, y + s * 0.25, s, pal[1], { r0: 0.3, r1: 1.2, w: 0.07, life: 0.7 });
      this.embers(x, y, s, 12, pal);
    }, delay);
  }

  /** Ice: crystal shards blasting out, frost ring, cold flare. */
  ice(sq, delay = 0) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.45, 1);
      this.add({ type: 'flare', x, y, len: s * 3.4, color: PAL.ice[2], a: 1, life: 0.5 });
      this.orb(x, y, s * 2.2, PAL.ice[1], 0.5, 0.8);
      for (let i = 0; i < 16; i++) {
        const a = rand(0, TAU), sp = s * rand(2.5, 6);
        this.add({ type: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 5, s: s * rand(0.15, 0.32), rot: a + Math.PI / 2, spin: rand(-3, 3), color: pick(PAL.ice), a: 1, life: rand(0.6, 1) });
      }
      this.ring(x, y, s, PAL.ice[1], { r1: 1.8, w: 0.1, life: 0.6 });
      this.embers(x, y, s, 10, PAL.ice);
    }, delay);
  }

  /** Portal: a ring that swirls outward. */
  portal(sq, pal = PAL.violet, delay = 0) {
    this.go(() => {
      const [x, y, s] = this.at(sq);
      this.dim(0.45, 1.3);
      this.add({ type: 'circle', x, y, R: s * 0.8, n: 6, spin: 3, color: pal[1], a: 1, life: 1.2 });
      for (let i = 0; i < 60; i++) {
        this.add({ type: 'orbit', cx: x, cy: y, r: s * rand(0.1, 0.4), ang: rand(0, TAU), color: pick(pal), w: Math.max(1.2, s * 0.035), a: 0.9, life: rand(0.6, 1.1),
          emit: (p, dt) => { p.ang += dt * 4; p.r += dt * s * 0.9; } });
      }
    }, delay);
  }

  /**
   * Teleport, in three beats:
   *  1. a warp circle opens under the piece, energy rushes in and the piece breaks into light,
   *  2. a comet of light arcs across the board,
   *  3. a beam slams down on the landing square: shockwave, rays, the piece reassembles.
   */
  teleport(from, to, { pal = PAL.fire, arrive = 470 } = {}) {
    this.go(() => {
      const [x0, y0, s] = this.at(from), [x1, y1] = this.at(to);
      const gold = PAL.gold;
      this.dim(0.62, (arrive + 900) / 1000);

      // 1. departure
      this.add({ type: 'circle', x: x0, y: y0, R: s * 0.95, n: 6, spin: 4, color: pal[1], a: 1, life: 0.75 });
      this.add({ type: 'circle', x: x0, y: y0, R: s * 0.6, n: 5, spin: -6, color: gold[1], a: 0.9, life: 0.6 });
      for (let i = 0; i < 26; i++) { // energy rushing in
        const a = rand(0, TAU), r = s * rand(1.1, 2.2), life = rand(0.18, 0.3);
        this.add({ type: 'streak', x: x0 + Math.cos(a) * r, y: y0 + Math.sin(a) * r, vx: (-Math.cos(a) * r) / life, vy: (-Math.sin(a) * r) / life, sp0: r / life, len: s * 0.4, w: Math.max(1.2, s * 0.03), color: pick(gold), core: '#FFFFFF', a: 1, life });
      }
      this.later(200, () => { // the piece breaks into motes that fly up
        this.add({ type: 'flare', x: x0, y: y0, len: s * 3.6, color: gold[1], a: 1, life: 0.45 });
        this.add({ type: 'column', x: x0, y: y0 + s * 0.35, W: s * 0.9, H: s * 6, color: pal[1], a: 1, life: 0.6 });
        for (let i = 0; i < 30; i++) {
          const sz = s * rand(0.08, 0.2);
          this.add({ type: 'glow', x: x0 + rand(-0.35, 0.35) * s, y: y0 + rand(-0.35, 0.35) * s, vx: rand(-0.6, 0.6) * s, vy: -s * rand(2.5, 6), drag: 1.5, s0: sz, s1: sz * 0.3, color: pick([...gold, '#FFFFFF']), a: 1, life: rand(0.35, 0.7) });
        }
        this.ring(x0, y0, s, pal[1], { r0: 0.2, r1: 1.4, w: 0.1, life: 0.45 });
      });

      // 2. the comet: a bright head on a curved path, shedding sparkles
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - Math.max(s * 1.5, Math.hypot(x1 - x0, y1 - y0) * 0.35);
      const travel = (arrive - 240) / 1000;
      this.later(240, () => this.add({
        type: 'none', life: travel, emit: p => {
          const k = Math.min(1, p.t / travel), e = k * k * (3 - 2 * k), u = 1 - e;
          const hx = u * u * x0 + 2 * u * e * mx + e * e * x1, hy = u * u * y0 + 2 * u * e * my + e * e * y1;
          this.add({ type: 'glow', x: hx, y: hy, s0: s * 1.1, s1: s * 1.1, color: gold[1], a: 1, life: 0.03 });
          for (let i = 0; i < 3; i++) {
            const sz = s * rand(0.15, 0.4);
            this.add({ type: 'glow', x: hx + rand(-0.1, 0.1) * s, y: hy + rand(-0.1, 0.1) * s, vx: rand(-0.5, 0.5) * s, vy: rand(-0.5, 0.5) * s, drag: 3, s0: sz, s1: sz * 0.1, color: pick([pal[1], gold[1], gold[0]]), a: 0.85, life: rand(0.25, 0.45) });
          }
          if (Math.random() < 0.5) this.add({ type: 'flare', x: hx + rand(-0.3, 0.3) * s, y: hy + rand(-0.3, 0.3) * s, len: s * rand(0.5, 0.9), color: gold[0], a: 1, life: 0.35, rot: rand(0, 1) });
        },
      }));

      // 3. arrival: beam from the sky, shockwave, rays, sparkles converging
      this.later(arrive, () => {
        this.add({ type: 'column', x: x1, y: y1 + s * 0.35, W: s * 1.5, H: s * 9, color: gold[1], a: 1, life: 0.75 });
        this.orb(x1, y1, s * 4.5, '#FFFFFF', 0.22);
        this.add({ type: 'flare', x: x1, y: y1, len: s * 5, color: gold[1], a: 1, life: 0.55 });
        this.add({ type: 'circle', x: x1, y: y1, R: s * 1.1, n: 6, spin: -3, color: gold[1], a: 1, life: 1 });
        this.ring(x1, y1, s, gold[1], { r0: 0.3, r1: 2.8, w: 0.13, life: 0.6 });
        this.ring(x1, y1, s, '#FFFFFF', { r0: 0.2, r1: 1.9, w: 0.05, life: 0.45 });
        this.rays(x1, y1, s, 14, gold[0], { len: [1.8, 3.6] });
        this.sparks(x1, y1, s, 22, [gold[0], gold[1], pal[1]], { speed: [4, 10], g: 1 });
        for (let i = 0; i < 20; i++) { // motes rushing back in: the piece reassembles
          const a = rand(0, TAU), r = s * rand(0.9, 1.6), life = rand(0.3, 0.5), sz = s * rand(0.1, 0.18);
          this.add({ type: 'glow', x: x1 + Math.cos(a) * r, y: y1 + Math.sin(a) * r, vx: (-Math.cos(a) * r) / life, vy: (-Math.sin(a) * r) / life, s0: sz, s1: sz * 0.4, color: pick(gold), a: 1, life });
        }
        this.embers(x1, y1, s, 14, gold);
      });
    });
  }

  /** Small burst in any palette (clone, swap, steal…). */
  pop(sq, pal, { delay = 0, scale = 1 } = {}) {
    this.go(() => {
      const [x, y, s0] = this.at(sq), s = s0 * scale;
      this.add({ type: 'flare', x, y, len: s * 2.6, color: pal[1], a: 1, life: 0.4 });
      this.orb(x, y, s * 1.8, pal[2], 0.35, 0.8);
      this.sparks(x, y, s, 14, pal.slice(0, 2), { speed: [3, 8] });
      this.ring(x, y, s, pal[1], { r1: 1.4, w: 0.08, life: 0.5 });
    }, delay);
  }
}
