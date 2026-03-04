import { getAllNets } from './router.js';

const SP = 1.0; // Standard pitch
const NET_PAL = {};
const netColorCache = new Map();
let hovNet = null;
let dragging = false;
let cachedRatsnest = null;

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


export function generateWiresSVG(wires) {
  let out = '';
  wires.forEach(w => {
    if (w.failed) {
      const a = w.path[0], b = w.path[w.path.length - 1];
      out += `<line x1="${a.col * SP + SP / 2}" y1="${a.row * SP + SP / 2}" x2="${b.col * SP + SP / 2}" y2="${b.row * SP + SP / 2}" stroke="#ff2222" stroke-width="1" stroke-dasharray="2 5"/>`;
      return;
    }

    const strokeW = hovNet === w.net ? 4.5 : 2.8;
    const pts = w.path.map(pt => `${pt.col * SP + SP / 2},${pt.row * SP + SP / 2}`).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="${netColor(w.net)}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return out;
}


export function generateRatsnestSVG(components) {
  if (dragging && cachedRatsnest) return cachedRatsnest;

  const nets = getAllNets(components);
  let out = '';
  for (const net in nets) {
    if (nets[net].length < 2) continue;
    const pins = nets[net];
    const conn = new Set([0]);
    while (conn.size < pins.length) {
      let bD = Infinity, bI = -1, bJ = -1;
      conn.forEach(i => pins.forEach((p, j) => {
        if (conn.has(j)) return;
        const d = Math.abs(pins[i].col - p.col) + Math.abs(pins[i].row - p.row);
        if (d < bD) { bD = d; bI = i; bJ = j; }
      }));
      if (bJ === -1) break;
      // FIX: Use opacity attribute instead of concatenating '55' to the color string!
      out += `<line x1="${pins[bI].col * SP + SP / 2}" y1="${pins[bI].row * SP + SP / 2}" x2="${pins[bJ].col * SP + SP / 2}" y2="${pins[bJ].row * SP + SP / 2}" stroke="${netColor(net)}" opacity="0.35" stroke-width="0.8" stroke-dasharray="2 5"/>`;
      conn.add(bJ);
    }
  }
  cachedRatsnest = out;
  return out;
}


export function renderCompSVG(c, isSelected = false, isHovered = false) {
  const bx = c.ox * SP + SP * .08, by = c.oy * SP + SP * .08;
  const bw = c.w * SP - SP * .16, bh = c.h * SP - SP * .16;

  let out = `<g transform="translate(0,0)">`;

  // 1. Draw Component Base (Use the exact component color as thick rim, and a darker tinted fill)
  out += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="#111" stroke="${c.color}" stroke-width="2.5"/>`;
  // Add a slight colored tint to the background of the component
  out += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${c.color}" opacity="0.3"/>`;

  // 2. Draw Pins First (so component labels can render over them if needed)
  c.pins.forEach(p => {
    const px = p.col * SP + SP / 2, py = p.row * SP + SP / 2;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .28}" fill="#b87333"/>`;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .2}" fill="${netColor(p.net)}"/>`;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .09}" fill="#0d0a06"/>`;

    // Pin Labels moved down slightly to prevent overlapping the center hole
    out += `<text x="${px}" y="${py + SP * .42}" fill="rgba(230,230,230,.9)" font-family="monospace" font-size="${Math.min(SP * .25, 7)}" text-anchor="middle">${p.lbl}</text>`;
  });

  // 3. Draw Component Labels Last (On Top)
  // Shifted component name to the TOP of the component box instead of center/bottom
  out += `<text x="${bx + 3}" y="${by + SP * 0.35}" fill="#fff" font-family="'Consolas',monospace" font-size="${Math.min(SP * .3, 9)}" font-weight="bold" paint-order="stroke" stroke="#0b0c0e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${c.id}: ${c.value}</text>`;

  out += `</g>`;
  return out;
}


export function hitComp(col, row, components) {
  return components.find(c =>
    col >= c.ox && col < c.ox + c.w &&
    row >= c.oy && row < c.oy + c.h
  ) || null;
}
