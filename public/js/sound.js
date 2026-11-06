// Synthesized anime-style sound kit (WebAudio only, no audio files).
// A master compressor + generated reverb give everything weight; each item has a signature sound.
let ctx = null, master = null, verb = null;
let muted = (() => { try { return localStorage.getItem('yc-muted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('yc-muted', m ? '1' : '0'); } catch { /* ignore */ }
}

function ac() {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
      master = ctx.createGain(); master.gain.value = 0.9;
      master.connect(comp).connect(ctx.destination);
      // Reverb: convolve with a decaying-noise impulse (stereo, ~1.8s).
      const len = Math.floor(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2; }
      const conv = ctx.createConvolver(); conv.buffer = ir;
      verb = ctx.createGain(); verb.gain.value = 0.32;
      verb.connect(conv).connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

/** Route a node to the master bus (and some of it to the reverb). */
function out(node, wet = 0) {
  node.connect(master);
  if (wet > 0) { const g = ctx.createGain(); g.gain.value = wet; node.connect(g).connect(verb); }
}

function env(g, t, { attack = 0.005, dur = 0.2, vol = 0.2, curve = 'exp' }) {
  g.gain.setValueAtTime(0.0001, t);
  if (curve === 'lin') g.gain.linearRampToValueAtTime(vol, t + attack);
  else g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));
}

/** Oscillator voice with optional pitch glide, vibrato and filter. */
function osc(f, { type = 'sine', to, dur = 0.2, vol = 0.15, attack = 0.005, delay = 0, vib = 0, vibRate = 6, wet = 0, lp, curve } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  if (vib) { const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = vibRate; lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
  env(g, t, { attack, dur, vol, curve });
  let node = o.connect(g);
  if (lp) { const fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; node = g.connect(fl); }
  out(node, wet);
  o.start(t); o.stop(t + dur + 0.05);
}

/** Filtered noise voice with a frequency sweep. */
function noise({ dur = 0.3, vol = 0.25, delay = 0, type = 'lowpass', f = 1200, to, q = 0.8, attack = 0.004, wet = 0, curve } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * (dur + 0.05)), a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (to) fl.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
  env(g, t, { attack, dur, vol, curve });
  out(src.connect(fl).connect(g), wet);
  src.start(t); src.stop(t + dur + 0.05);
}

/** FM bell / metallic "shing". */
function fm(fc, { ratio = 1.5, index = 6, dur = 0.6, vol = 0.12, delay = 0, wet = 0.5, to } = {}) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const car = a.createOscillator(), mod = a.createOscillator(), mg = a.createGain(), g = a.createGain();
  car.frequency.setValueAtTime(fc, t); mod.frequency.setValueAtTime(fc * ratio, t);
  if (to) { car.frequency.exponentialRampToValueAtTime(to, t + dur); mod.frequency.exponentialRampToValueAtTime(to * ratio, t + dur); }
  mg.gain.setValueAtTime(fc * index, t); mg.gain.exponentialRampToValueAtTime(fc * 0.2, t + dur);
  mod.connect(mg).connect(car.frequency);
  env(g, t, { attack: 0.002, dur, vol });
  out(car.connect(g), wet);
  car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
}

const rep = (n, gap, fn) => { for (let i = 0; i < n; i++) fn(i, i * gap); };

// ---------------------------------------------------------------- building blocks
const poof = (delay = 0, vol = 0.45) => {               // smoke puff (substitution / shadow clone)
  noise({ type: 'lowpass', f: 2600, to: 220, dur: 0.42, vol, attack: 0.008, delay, wet: 0.35 });
  noise({ type: 'bandpass', f: 900, to: 300, q: 1.2, dur: 0.25, vol: vol * 0.6, delay });
  osc(260, { to: 90, dur: 0.22, vol: 0.18, delay });
};
const knock = (delay = 0) => {                           // wooden log "tok"
  osc(720, { type: 'triangle', dur: 0.07, vol: 0.32, delay, to: 560 });
  osc(1180, { type: 'sine', dur: 0.045, vol: 0.12, delay });
  noise({ type: 'bandpass', f: 1800, q: 4, dur: 0.03, vol: 0.25, delay });
};
const whoosh = (delay = 0, up = true, dur = 0.35, vol = 0.22) =>
  noise({ type: 'bandpass', f: up ? 400 : 3000, to: up ? 3000 : 400, q: 1.6, dur, vol, attack: dur * 0.6, curve: 'lin', delay, wet: 0.2 });
const boomish = (delay = 0, big = 1) => {
  noise({ type: 'lowpass', f: 1600 * big, to: 60, dur: 0.7 * big, vol: 0.6, delay, wet: 0.4 });
  osc(110, { to: 32, dur: 0.6 * big, vol: 0.5, delay });
};
const sparkle = (delay = 0, n = 5) =>
  rep(n, 0.045, (i, d) => osc([2093, 2637, 3136, 3520, 4186, 4699][i % 6], { type: 'triangle', dur: 0.18, vol: 0.07, delay: delay + d, wet: 0.6 }));

// ---------------------------------------------------------------- item signatures
const ITEM = {
  teleport: () => { osc(380, { to: 2600, dur: 0.22, vol: 0.14, wet: 0.4 }); whoosh(0, true, 0.22, 0.18); sparkle(0.16, 6); fm(1760, { ratio: 2.01, index: 3, dur: 0.7, vol: 0.06, delay: 0.2 }); },
  shield: () => { fm(196, { ratio: 1.5, index: 4, dur: 1.1, vol: 0.16, wet: 0.6 }); osc(98, { dur: 0.9, vol: 0.25, attack: 0.05 }); fm(1568, { ratio: 3.01, index: 2, dur: 0.9, vol: 0.05, delay: 0.05 }); },
  rewind: () => { noise({ type: 'bandpass', f: 600, to: 2400, q: 2, dur: 0.6, vol: 0.3, attack: 0.55, curve: 'lin', wet: 0.4 }); osc(900, { type: 'sawtooth', to: 140, dur: 0.7, vol: 0.06, vib: 30, vibRate: 9, lp: 2200 }); rep(4, 0.12, (i, d) => osc(1400 - i * 200, { type: 'square', dur: 0.04, vol: 0.04, delay: d })); },
  clone: () => { poof(0, 0.4); poof(0.16, 0.35); fm(1318, { ratio: 2, index: 2, dur: 0.4, vol: 0.06, delay: 0.24 }); },
  mind: () => { osc(520, { to: 880, dur: 0.9, vol: 0.12, vib: 40, vibRate: 7, attack: 0.15, wet: 0.6 }); osc(130, { dur: 1, vol: 0.12, vib: 4, vibRate: 3, attack: 0.2 }); osc(1040, { to: 660, dur: 0.8, vol: 0.04, vib: 60, vibRate: 11, delay: 0.1, wet: 0.5 }); },
  swap: () => { poof(0, 0.5); knock(0.06); knock(0.15); poof(0.12, 0.4); whoosh(0, false, 0.18, 0.15); },
  ghost: () => { noise({ type: 'bandpass', f: 700, to: 300, q: 3, dur: 0.9, vol: 0.22, attack: 0.25, wet: 0.6 }); osc(420, { to: 260, dur: 0.9, vol: 0.09, vib: 14, vibRate: 5, attack: 0.25, wet: 0.7 }); },
  freeze: () => { rep(9, 0.045, (i, d) => fm(2400 + Math.random() * 2600, { ratio: 2.76, index: 3, dur: 0.25, vol: 0.05, delay: d, wet: 0.5 })); noise({ type: 'highpass', f: 5000, dur: 0.45, vol: 0.12, attack: 0.02 }); osc(1200, { to: 2400, dur: 0.3, vol: 0.05, type: 'triangle' }); },
  resurrect: () => { [261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => osc(f, { type: 'triangle', dur: 1.4, vol: 0.055, attack: 0.35, vib: 3, vibRate: 5 + i * 0.3, wet: 0.8 })); osc(60, { dur: 0.16, vol: 0.4, to: 40 }); osc(60, { dur: 0.16, vol: 0.32, to: 40, delay: 0.22 }); sparkle(0.5, 6); },
  evolve: () => { osc(90, { type: 'sawtooth', to: 900, dur: 0.6, vol: 0.08, attack: 0.3, lp: 3000 }); noise({ type: 'bandpass', f: 300, to: 4000, q: 1.5, dur: 0.6, vol: 0.2, attack: 0.5, curve: 'lin' }); [523, 659, 784, 1046].forEach((f, i) => osc(f, { type: 'square', dur: 0.12, vol: 0.05, delay: 0.55 + i * 0.05, wet: 0.4 })); fm(1046, { ratio: 2, index: 3, dur: 0.8, vol: 0.08, delay: 0.75 }); },
  laser: () => { osc(220, { to: 1800, dur: 0.32, vol: 0.08, type: 'sine', attack: 0.25, curve: 'lin' }); osc(2400, { type: 'sawtooth', to: 180, dur: 0.3, vol: 0.12, delay: 0.32, lp: 6000, wet: 0.3 }); osc(110, { type: 'square', dur: 0.35, vol: 0.06, vib: 30, vibRate: 40, delay: 0.32, lp: 1600 }); },
  rocket: () => { noise({ type: 'bandpass', f: 300, to: 1600, q: 0.8, dur: 0.45, vol: 0.35, attack: 0.05 }); osc(1800, { to: 500, dur: 0.42, vol: 0.06, type: 'sine' }); },
  mine: () => { noise({ type: 'highpass', f: 3000, dur: 0.02, vol: 0.3 }); osc(1046, { type: 'square', dur: 0.06, vol: 0.05, delay: 0.1 }); osc(1046, { type: 'square', dur: 0.06, vol: 0.05, delay: 0.26 }); },
  emp: () => { rep(12, 0.04, (i, d) => noise({ type: 'bandpass', f: 2000 + Math.random() * 3000, q: 6, dur: 0.03, vol: 0.3, delay: d })); osc(160, { to: 35, dur: 0.6, vol: 0.4 }); osc(3000, { type: 'sawtooth', to: 120, dur: 0.45, vol: 0.06, lp: 5000, wet: 0.4 }); },
  shotgun: () => { noise({ type: 'bandpass', f: 1500, q: 3, dur: 0.05, vol: 0.4 }); noise({ type: 'bandpass', f: 1100, q: 3, dur: 0.06, vol: 0.4, delay: 0.12 }); boomish(0.3, 0.7); noise({ type: 'highpass', f: 2500, dur: 0.15, vol: 0.3, delay: 0.3 }); },
  reverse: () => { noise({ type: 'bandpass', f: 500, to: 2600, q: 4, dur: 0.14, vol: 0.4 }); noise({ type: 'bandpass', f: 2600, to: 500, q: 4, dur: 0.16, vol: 0.4, delay: 0.15 }); osc(660, { to: 330, dur: 0.3, vol: 0.06, type: 'triangle', delay: 0.3, wet: 0.4 }); },
  skip: () => { whoosh(0, true, 0.18, 0.2); osc(880, { dur: 0.25, vol: 0.12, delay: 0.16, wet: 0.5 }); osc(1320, { dur: 0.3, vol: 0.08, delay: 0.22, wet: 0.5 }); },
  double: () => { whoosh(0, true, 0.15, 0.2); whoosh(0.16, true, 0.15, 0.2); fm(1568, { ratio: 2, index: 2, dur: 0.5, vol: 0.06, delay: 0.3 }); },
  shuffle: () => rep(16, 0.028, (i, d) => noise({ type: 'bandpass', f: 2500 + i * 60, q: 5, dur: 0.02, vol: 0.28, delay: d * (1 - i * 0.02) })),
  steal: () => { osc(300, { to: 1400, dur: 0.12, vol: 0.12, type: 'triangle' }); osc(988, { type: 'square', dur: 0.08, vol: 0.05, delay: 0.14 }); osc(1319, { type: 'square', dur: 0.25, vol: 0.05, delay: 0.21, wet: 0.4 }); },
  mimic: () => [523, 659, 784, 1046, 784, 659, 523].forEach((f, i) => osc(f, { type: 'triangle', dur: 0.12, vol: 0.06, delay: i * 0.05, wet: 0.5 })),
  wildcard: () => { rep(10, 0.05, (i, d) => noise({ type: 'bandpass', f: 3000, q: 8, dur: 0.02, vol: 0.25, delay: d * (1 + i * 0.08) })); osc(1046, { type: 'square', dur: 0.1, vol: 0.06, delay: 0.75 }); osc(1568, { type: 'square', dur: 0.3, vol: 0.06, delay: 0.84, wet: 0.5 }); },
};

const EVENT = {
  meteor: () => osc(2200, { to: 300, dur: 0.6, vol: 0.08, wet: 0.4 }),
  earthquake: () => { noise({ type: 'lowpass', f: 160, dur: 1.4, vol: 0.7, attack: 0.1 }); osc(45, { dur: 1.3, vol: 0.4, vib: 6, vibRate: 9 }); },
  blackhole: () => { osc(500, { to: 30, dur: 1.2, vol: 0.2, wet: 0.6 }); noise({ type: 'lowpass', f: 3000, to: 80, dur: 1.2, vol: 0.35 }); },
  gravity: () => { osc(220, { to: 55, dur: 0.5, vol: 0.35 }); whoosh(0, false, 0.4, 0.25); },
  rotate: () => { whoosh(0, true, 0.35, 0.25); whoosh(0.35, false, 0.35, 0.25); },
  portals: () => { fm(330, { ratio: 1.01, index: 8, dur: 1.2, vol: 0.12, wet: 0.7 }); osc(660, { dur: 1, vol: 0.06, vib: 80, vibRate: 6, wet: 0.6 }); },
  zombies: () => { osc(95, { type: 'sawtooth', dur: 1.2, vol: 0.14, vib: 8, vibRate: 5, attack: 0.2, lp: 700, wet: 0.4 }); osc(140, { type: 'sawtooth', dur: 1, vol: 0.08, vib: 10, vibRate: 4, attack: 0.3, delay: 0.2, lp: 600 }); },
  mutation: () => rep(9, 0.07, (i, d) => osc(300 + Math.random() * 700, { to: 200 + Math.random() * 900, dur: 0.09, vol: 0.08, delay: d, wet: 0.4 })),
};

// ---------------------------------------------------------------- public kit
export const sfx = {
  move: () => { osc(540, { type: 'triangle', dur: 0.06, vol: 0.14 }); noise({ type: 'highpass', f: 2200, dur: 0.04, vol: 0.12 }); },
  capture: () => { osc(170, { to: 55, dur: 0.18, vol: 0.45 }); noise({ type: 'bandpass', f: 1300, q: 1, dur: 0.14, vol: 0.4 }); fm(900, { ratio: 1.41, index: 4, dur: 0.2, vol: 0.05, wet: 0.3 }); },
  check: () => { osc(196, { type: 'sawtooth', dur: 0.32, vol: 0.12, lp: 1800 }); osc(233, { type: 'sawtooth', dur: 0.32, vol: 0.1, lp: 1800 }); fm(1480, { ratio: 1.41, index: 5, dur: 0.6, vol: 0.06, wet: 0.5 }); },
  boom: () => boomish(0, 1),
  zap: () => osc(1400, { type: 'sawtooth', to: 220, dur: 0.25, vol: 0.07, lp: 5000 }),
  power: () => [523, 659, 784].forEach((f, i) => osc(f, { type: 'triangle', dur: 0.14, vol: 0.1, delay: i * 0.06, wet: 0.3 })),
  card: () => { noise({ type: 'highpass', f: 3000, dur: 0.08, vol: 0.15 }); osc(740, { type: 'triangle', dur: 0.1, vol: 0.1, delay: 0.05 }); },
  event: () => [392, 523, 659, 1046].forEach((f, i) => osc(f, { type: 'square', dur: 0.16, vol: 0.05, delay: i * 0.08, wet: 0.4 })),
  gain: () => { osc(988, { dur: 0.1, vol: 0.12, wet: 0.4 }); osc(1318, { dur: 0.18, vol: 0.12, delay: 0.08, wet: 0.5 }); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => osc(f, { type: 'triangle', dur: 0.35, vol: 0.13, delay: i * 0.12, wet: 0.5 })),
  lose: () => [392, 330, 262].forEach((f, i) => osc(f, { type: 'triangle', dur: 0.35, vol: 0.11, delay: i * 0.16, wet: 0.5 })),
  notify: () => { osc(660, { dur: 0.1, vol: 0.1 }); osc(990, { dur: 0.14, vol: 0.1, delay: 0.1, wet: 0.3 }); },
  click: () => osc(1200, { type: 'triangle', dur: 0.04, vol: 0.06 }),
  lock: () => { osc(880, { type: 'square', dur: 0.05, vol: 0.04 }); osc(1320, { type: 'square', dur: 0.07, vol: 0.04, delay: 0.07 }); },
  whoosh: () => whoosh(0, true, 0.3, 0.18),
  announce: () => { osc(440, { type: 'triangle', dur: 0.12, vol: 0.1 }); osc(660, { type: 'triangle', dur: 0.18, vol: 0.1, delay: 0.1 }); },
  /** Anime power-up charge: rising wind + sub swell before the cut-in slams. */
  charge: () => { noise({ type: 'bandpass', f: 250, to: 3200, q: 1.4, dur: 0.42, vol: 0.32, attack: 0.38, curve: 'lin', wet: 0.3 }); osc(70, { to: 160, dur: 0.42, vol: 0.2, attack: 0.3, type: 'sawtooth', lp: 400 }); },
  /** The "DOOON — shing!" impact when the cut-in lands. */
  slam: () => { osc(120, { to: 34, dur: 0.55, vol: 0.55 }); noise({ type: 'lowpass', f: 2400, to: 90, dur: 0.4, vol: 0.45, wet: 0.3 }); fm(1850, { ratio: 1.41, index: 9, dur: 0.9, vol: 0.09, wet: 0.7 }); },
  /** Category flavour layered on the slam. */
  sting: cat => ({
    power: () => [784, 988, 1175, 1568].forEach((f, i) => osc(f, { type: 'triangle', dur: 0.25, vol: 0.06, delay: 0.05 + i * 0.04, wet: 0.6 })),
    weapon: () => { osc(98, { type: 'sawtooth', dur: 0.35, vol: 0.12, lp: 900 }); osc(147, { type: 'sawtooth', dur: 0.35, vol: 0.09, lp: 900 }); },
    card: () => { noise({ type: 'highpass', f: 4000, dur: 0.1, vol: 0.15 }); fm(1175, { ratio: 2, index: 3, dur: 0.6, vol: 0.07, delay: 0.04 }); },
    event: () => { osc(110, { type: 'sawtooth', dur: 0.6, vol: 0.12, lp: 800, vib: 4 }); osc(116.5, { type: 'sawtooth', dur: 0.6, vol: 0.1, lp: 800 }); },
  })[cat]?.(),
  item: kind => ITEM[kind]?.(),
  eventSfx: id => EVENT[id]?.(),
  poof: () => poof(0, 0.45),
  knock: () => knock(0),
};
