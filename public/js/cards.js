// Trading-card artwork for every power-up, weapon, card and event — drawn as SVG, flat colours only.
// cardSVG(kind) gives a full card; cardSVG(kind, { thumb: true }) gives just the artwork window.
import { iconPaths } from './icons.js';
import { ITEMS } from '/shared/items.js';
import { EVENTS } from '/shared/events.js';
import { POOLS } from '/shared/state.js';

const INK = '#1D1B18';
const PALETTE = {
  power: { bg: '#FF5A36', dark: '#C9381A', light: '#FFD2C2', type: 'Power-up' },
  weapon: { bg: '#2E6BFF', dark: '#1B47C2', light: '#C9D8FF', type: 'Weapon' },
  card: { bg: '#7B5CFF', dark: '#5536CF', light: '#DDD3FF', type: 'Card' },
  event: { bg: '#2B2823', dark: '#121110', light: '#FFC93D', type: 'Event' },
};
// Black-piece glyphs in the Chess Merida font (used as big silhouettes).
const GLYPH = { p: 'o', n: 'm', b: 'v', r: 't', q: 'w', k: 'l' };

// Per-card recipe: background pattern + piece silhouette.
const RECIPE = {
  teleport: ['rays', 'n'], shield: ['rings', 'r'], rewind: ['spiral', 'k'], clone: ['dots', 'p'], mind: ['spiral', 'b'],
  swap: ['zigzag', 'n'], ghost: ['dots', 'q'], freeze: ['shards', 'r'], resurrect: ['rays', 'k'], evolve: ['chevrons', 'p'],
  laser: ['stripes', 'r'], rocket: ['burst', 'b'], mine: ['checker', 'p'], emp: ['rings', 'q'], shotgun: ['burst', 'n'],
  reverse: ['spiral', 'k'], skip: ['chevrons', 'p'], double: ['stripes', 'n'], shuffle: ['zigzag', 'p'], steal: ['dots', 'b'],
  mimic: ['rings', 'q'], wildcard: ['rays', 'k'],
  thunder: ['zigzag', 'r'], slash: ['stripes', 'n'], imposter: ['dots', 'q'], disguise: ['checker', 'p'],
  hyperbeam: ['rays', 'r'], orbital: ['rings', 'k'], zero: ['shards', 'q'], storm: ['zigzag', 'q'],
  aegis: ['rings', 'r'], ascension: ['rays', 'q'], shadowarmy: ['spiral', 'k'], timestop: ['spiral', 'k'], hypnosis: ['spiral', 'b'],
  meteor: ['burst', 'r'], earthquake: ['zigzag', 'k'], blackhole: ['spiral', 'q'], gravity: ['chevrons', 'p'],
  rotate: ['rings', 'n'], portals: ['rings', 'b'], zombies: ['checker', 'p'], mutation: ['dots', 'n'],
};

// Art window geometry inside a 240×336 card.
const AX = 16, AY = 40, AW = 208, AH = 184, CX = 120, CY = 132;

function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

function pattern(kind, p, rnd) {
  const c = p.bg, out = [];
  switch (RECIPE[kind]?.[0] || 'rays') {
    case 'rays': {
      const n = 20;
      for (let i = 0; i < n; i += 2) {
        const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
        out.push(`<polygon points="${CX},${CY} ${CX + Math.cos(a) * 260},${CY + Math.sin(a) * 260} ${CX + Math.cos(b) * 260},${CY + Math.sin(b) * 260}" fill="${c}"/>`);
      }
      break;
    }
    case 'rings':
      for (let r = 16; r < 230; r += 26) out.push(`<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${c}" stroke-width="11"/>`);
      break;
    case 'dots':
      for (let y = AY + 4; y < AY + AH; y += 14) for (let x = AX + 4 + ((y / 14) % 2) * 7; x < AX + AW; x += 14) {
        const d = Math.hypot(x - CX, y - CY), r = 6.2 * (d / 150);
        if (r > 0.8) out.push(`<circle cx="${x}" cy="${y}" r="${Math.min(r, 6.5).toFixed(1)}" fill="${c}"/>`);
      }
      break;
    case 'spiral': {
      let d = `M${CX},${CY}`;
      for (let t = 0; t < 30; t += 0.25) d += ` L${(CX + Math.cos(t) * t * 5.2).toFixed(1)},${(CY + Math.sin(t) * t * 5.2).toFixed(1)}`;
      out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/>`);
      break;
    }
    case 'zigzag':
      for (let y = AY + 10; y < AY + AH + 20; y += 28) {
        let pts = '';
        for (let x = AX - 10, k = 0; x < AX + AW + 20; x += 16, k++) pts += `${x},${y + (k % 2 ? 9 : -9)} `;
        out.push(`<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="8" stroke-linejoin="round"/>`);
      }
      break;
    case 'stripes':
      for (let x = AX - AH; x < AX + AW + 20; x += 30) out.push(`<line x1="${x}" y1="${AY + AH + 10}" x2="${x + AH + 20}" y2="${AY - 10}" stroke="${c}" stroke-width="13"/>`);
      break;
    case 'chevrons':
      for (let y = AY + AH + 20; y > AY - 30; y -= 30) out.push(`<polyline points="${AX - 10},${y + 34} ${CX},${y - 16} ${AX + AW + 10},${y + 34}" fill="none" stroke="${c}" stroke-width="12" stroke-linejoin="round"/>`);
      break;
    case 'checker':
      for (let y = AY, j = 0; y < AY + AH; y += 26, j++) for (let x = AX, i = 0; x < AX + AW; x += 26, i++) if ((i + j) % 2) out.push(`<rect x="${x}" y="${y}" width="26" height="26" fill="${c}"/>`);
      break;
    case 'shards':
      for (let i = 0; i < 14; i++) {
        const x = AX + rnd() * AW, y = AY + rnd() * AH, s = 18 + rnd() * 34, a = rnd() * Math.PI;
        const pts = [0, 2.2, 4.2].map(k => `${(x + Math.cos(a + k) * s).toFixed(1)},${(y + Math.sin(a + k) * s * 0.6).toFixed(1)}`).join(' ');
        out.push(`<polygon points="${pts}" fill="${i % 3 ? c : p.light}" opacity="${i % 3 ? 1 : 0.55}"/>`);
      }
      break;
    case 'burst': {
      let pts = '';
      for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, r = i % 2 ? 62 : 118 + rnd() * 18; pts += `${(CX + Math.cos(a) * r).toFixed(1)},${(CY + Math.sin(a) * r).toFixed(1)} `; }
      out.push(`<polygon points="${pts}" fill="${c}"/>`);
      break;
    }
  }
  return out.join('');
}

const star4 = (x, y, s, fill) => `<path d="M${x},${y - s} L${x + s * 0.28},${y - s * 0.28} L${x + s},${y} L${x + s * 0.28},${y + s * 0.28} L${x},${y + s} L${x - s * 0.28},${y + s * 0.28} L${x - s},${y} L${x - s * 0.28},${y - s * 0.28} Z" fill="${fill}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
const star5 = (x, y, r, fill) => {
  let pts = '';
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; pts += `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)} `; }
  return `<polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
};

function wrap(text, max = 34, lines = 3) {
  const out = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).trim().length > max) { out.push(cur.trim()); cur = w; } else cur += ' ' + w;
  }
  if (cur.trim()) out.push(cur.trim());
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/\W*\w*$/, '') + '…'; }
  return out;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let uid = 0;

export function cardInfo(kind) {
  const it = ITEMS[kind], ev = EVENTS[kind];
  const cat = it ? it.cat : 'event';
  const weight = it ? POOLS[cat]?.[kind] : 0;
  const legendary = !!it?.legendary;
  return { name: (it || ev).name, desc: (it || ev).desc, icon: (it || ev).icon, cat, legendary, stars: legendary ? 3 : weight === 1 ? 3 : weight === 2 ? 2 : weight === 3 ? 1 : 0 };
}

export function cardSVG(kind, { thumb = false } = {}) {
  const info = cardInfo(kind), p = PALETTE[info.cat], rnd = seeded(kind);
  const id = `cw${++uid}`;
  const piece = RECIPE[kind]?.[1] || 'k';
  const sparkles = [0, 1, 2, 3].map(() => [AX + 22 + rnd() * (AW - 44), AY + 20 + rnd() * (AH - 40), 7 + rnd() * 7])
    .filter(([x, y]) => Math.hypot(x - CX, y - CY) > 70)
    .map(([x, y, s]) => star4(Math.round(x), Math.round(y), Math.round(s), '#fff')).join('');
  const art = `
    <clipPath id="${id}"><rect x="${AX}" y="${AY}" width="${AW}" height="${AH}" rx="10"/></clipPath>
    <g clip-path="url(#${id})">
      <rect x="${AX}" y="${AY}" width="${AW}" height="${AH}" fill="${p.dark}"/>
      ${pattern(kind, p, rnd)}
      <text x="${CX + 18}" y="${AY + AH + 34}" font-family="ChessMerida" font-size="210" fill="${INK}" opacity=".3">${GLYPH[piece]}</text>
    </g>
    <circle cx="${CX + 6}" cy="${CY + 6}" r="54" fill="${INK}"/>
    <circle cx="${CX}" cy="${CY}" r="54" fill="#fff" stroke="${INK}" stroke-width="5"/>
    <g transform="translate(${CX - 39} ${CY - 39}) scale(3.25)" fill="none" stroke="${info.cat === 'event' ? INK : p.bg}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${iconPaths(info.icon)}</g>
    ${sparkles}`;
  if (thumb) return `<svg class="card-art" viewBox="${AX} ${AY} ${AW} ${AH}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${art}</svg>`;
  const name = info.name.toUpperCase();
  // long descriptions get a smaller font and a 4th line instead of being cut off
  let lines = wrap(info.desc, 34, 9), fs = 11.2, lh = 14, y0 = 292;
  if (lines.length > 3) { lines = wrap(info.desc, 42, 4); fs = 9.6; lh = 11.6; y0 = 287; }
  const L = info.legendary;
  return `<svg class="card-svg${L ? ' legendary' : ''}" viewBox="0 0 240 336" role="img" aria-label="${esc(info.name)}">
    <rect width="240" height="336" rx="18" fill="${INK}"/>
    ${L ? '<rect x="4" y="4" width="232" height="328" rx="15" fill="#FFC93D"/><rect x="10" y="10" width="220" height="316" rx="11" fill="#1D1B18"/>' : ''}
    <rect x="${L ? 13 : 7}" y="${L ? 13 : 7}" width="${L ? 214 : 226}" height="${L ? 310 : 322}" rx="${L ? 9 : 13}" fill="${p.bg}"/>
    <text x="20" y="${L ? 31 : 29}" font-family="Bricolage Grotesque, sans-serif" font-size="12" font-weight="800" letter-spacing="2" fill="${L ? '#FFE58A' : '#fff'}">${L ? 'LEGENDARY' : p.type.toUpperCase()}</text>
    ${[0, 1, 2].slice(0, info.stars).map(i => star5(214 - i * 17, 23, 7.5, '#FFC93D')).join('')}
    ${art}
    <rect x="${AX + 4}" y="236" width="${AW}" height="38" rx="9" fill="${INK}"/>
    <rect x="${AX}" y="232" width="${AW}" height="38" rx="9" fill="#fff" stroke="${INK}" stroke-width="3"/>
    <text x="120" y="258" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-size="${name.length > 11 ? 16.5 : 20}" font-weight="800" fill="${INK}" letter-spacing="-.3">${esc(name)}</text>
    ${lines.map((l, i) => `<text x="120" y="${(y0 + i * lh).toFixed(1)}" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-size="${fs}" font-weight="650" fill="#fff">${esc(l)}</text>`).join('')}
  </svg>`;
}
