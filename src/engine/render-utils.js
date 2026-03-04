import { getAllNets } from './router.js';

export const SP = 28; // Standard pitch - 28px
const NET_PAL = {
  VCC: '#ff5252', GND: '#40c4ff', GATE: '#00e676',
  DRAIN: '#e040fb', SOURCE: '#ff9800', CLK: '#ffea00',
  DATA: '#9c27b0', ADDR: '#00bcd4', CTRL: '#4caf50',
  RESET: '#f44336', CLKEN: '#ff5722', EN: '#795548'
};
const netColorCache = new Map();

export function netColor(n) {
  if (!n) return '#666';
  if (NET_PAL[n]) return NET_PAL[n];
  if (netColorCache.has(n)) return netColorCache.get(n);

  let h = 5381;
  for (const c of n) h = ((h << 5) + h) + c.charCodeAt(0);

  const goldenRatio = 0.618033988749895;
  const hue = (Math.abs(h) / 10000 + goldenRatio) % 1;
  const hueDegrees = Math.floor(hue * 360);
  const color = `hsl(${hueDegrees}, 75%, 55%)`;

  netColorCache.set(n, color);
  return color;
}

export function generateBackgroundSVG(cols, rows) {
  const W = cols * SP;
  const H = rows * SP;
  return `
    <defs>
      <pattern id="perfPattern" patternUnits="userSpaceOnUse" width="${SP}" height="${SP}">
        <rect width="${SP}" height="${SP}" fill="#1a1208"/>
        <circle cx="${SP / 2}" cy="${SP / 2}" r="${SP * .22}" fill="#b87333"/>
        <circle cx="${SP / 2}" cy="${SP / 2}" r="${SP * .09}" fill="#0d0a06"/>
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#perfPattern)"/>
    <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#c8a800" stroke-width="2"/>
  `;
}

export function generateWiresSVG(wires, hoveredNet = null) {
  let out = '';
  wires.forEach(w => {
    if (w.failed) {
      const a = w.path[0], b = w.path[w.path.length - 1];
      out += `<line x1="${a.col * SP + SP / 2}" y1="${a.row * SP + SP / 2}" x2="${b.col * SP + SP / 2}" y2="${b.row * SP + SP / 2}" stroke="#ff2222" stroke-width="1" stroke-dasharray="2 5"/>`;
      return;
    }

    const strokeW = hoveredNet === w.net ? 4.5 : 2.8;
    const pts = w.path.map(pt => `${pt.col * SP + SP / 2},${pt.row * SP + SP / 2}`).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="${netColor(w.net)}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return out;
}

export function generateRatsnestSVG(components) {
  const nets = getAllNets(components);
  let out = '';
  for (const netObj of nets) {
    const { net, pins } = netObj;
    if (pins.length < 2) continue;

    const conn = new Set([0]);
    while (conn.size < pins.length) {
      let bD = Infinity, bI = -1, bJ = -1;
      conn.forEach(i => pins.forEach((p, j) => {
        if (conn.has(j)) return;
        const d = Math.abs(pins[i].col - p.col) + Math.abs(pins[i].row - p.row);
        if (d < bD) { bD = d; bI = i; bJ = j; }
      }));
      if (bJ === -1) break;
      out += `<line x1="${pins[bI].col * SP + SP / 2}" y1="${pins[bI].row * SP + SP / 2}" x2="${pins[bJ].col * SP + SP / 2}" y2="${pins[bJ].row * SP + SP / 2}" stroke="${netColor(net)}" opacity="0.35" stroke-width="0.8" stroke-dasharray="2 5"/>`;
      conn.add(bJ);
    }
  }
  return out;
}

export function renderCompSVG(c, isSelected = false) {
  const bx = c.ox * SP + SP * .08, by = c.oy * SP + SP * .08;
  const bw = c.w * SP - SP * .16, bh = c.h * SP - SP * .16;

  let out = `<g class="pcb-comp" data-id="${c.id}">`;

  // 1. Draw Component Base
  out += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="#111" stroke="${c.color}" stroke-width="2.5"/>`;
  out += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${c.color}" opacity="0.3"/>`;

  // 2. Draw Pins
  c.pins.forEach(p => {
    const px = p.col * SP + SP / 2, py = p.row * SP + SP / 2;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .28}" fill="#b87333"/>`;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .2}" fill="${netColor(p.net)}"/>`;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .09}" fill="#0d0a06"/>`;
    out += `<text x="${px}" y="${py + SP * .42}" fill="rgba(230,230,230,.9)" font-family="monospace" font-size="${Math.min(SP * .25, 7)}" text-anchor="middle">${p.lbl}</text>`;
  });

  // 3. Draw Component Labels
  out += `<text x="${bx + 3}" y="${by + SP * 0.35}" fill="#fff" font-family="'Consolas',monospace" font-size="${Math.min(SP * .3, 9)}" font-weight="bold" paint-order="stroke" stroke="#0b0c0e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${c.id}: ${c.value}</text>`;

  if (isSelected) {
    out += `<rect x="${c.ox * SP - 4}" y="${c.oy * SP - 4}" width="${c.w * SP + 8}" height="${c.h * SP + 8}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 2"/>`;
  }

  out += `</g>`;
  return out;
}

export function hitComp(col, row, components) {
  return components.find(c =>
    col >= c.ox && col < c.ox + c.w &&
    row >= c.oy && row < c.oy + c.h
  ) || null;
}
