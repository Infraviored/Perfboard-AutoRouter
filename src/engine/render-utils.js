import { getAllNets } from './router.js';

import { NET_PAL, compColor } from './colors.js';

export const SP = 28; // Standard pitch - 28px

const hashString = (n) => {
  const str = String(n || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};

const getGoldenHue = (hash) => {
  const phi = 0.618033988749895;
  const h = (hash * phi + 0.25) % 1;
  return Math.floor(h * 360);
};

export function netColor(n) {
  if (!n) return '#666';
  const uname = n.toUpperCase();
  if (NET_PAL[uname]) return NET_PAL[uname];

  const h = getGoldenHue(hashString(n));
  return `hsl(${h}, 95%, 60%)`; // Vibrant for wires
}

export { compColor };

/**
 * boostColor - For components manually assigned color, make them pop.
 * For auto-colored ones, we already have our HSL targets.
 */
export function boostColor(hexOrHsl) {
  if (!hexOrHsl) return '#555';
  if (hexOrHsl.startsWith('hsl')) return hexOrHsl; // Already processed

  const hex = hexOrHsl;
  if (hex.length < 6) return hex;

  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);

  const lift = (v) => Math.min(255, Math.max(v * 1.8, v + 40));
  r = lift(r); g = lift(g); b = lift(b);

  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

export function generateBackgroundSVG(cols, rows, bounds = null) {
  // Use massive dimensions for infinite panning
  const W = 100000;
  const H = 100000;
  const OX = -50000;
  const OY = -50000;

  let maskContent = '';
  if (bounds) {
    const cx = ((bounds.minCol + bounds.maxCol + 1) / 2) * SP;
    const cy = ((bounds.minRow + bounds.maxRow + 1) / 2) * SP;
    const rw = (bounds.maxCol - bounds.minCol + 10) * SP / 2;
    const rh = (bounds.maxRow - bounds.minRow + 10) * SP / 2;
    // 3x radius for massive visible glow area
    const r = Math.max(rw, rh, 300) * 3;

    maskContent = `
      <radialGradient id="fadeGrad" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="white" stop-opacity="1"/>
        <stop offset="40%" stop-color="white" stop-opacity="1"/>     <!-- 2x larger inner bright circle -->
        <stop offset="60%" stop-color="white" stop-opacity="0.8"/>
        <stop offset="80%" stop-color="white" stop-opacity="0.3"/>   <!-- Smoother, softer falloff -->
        <stop offset="100%" stop-color="white" stop-opacity="0"/>
      </radialGradient>
      <mask id="fadeMask">
        <rect x="${OX}" y="${OY}" width="${W}" height="${H}" fill="url(#fadeGrad)"/>
      </mask>
    `;
  }

  return `
    <defs>
      <pattern id="perfPattern" patternUnits="userSpaceOnUse" width="${SP}" height="${SP}" x="0" y="0">
        <rect width="${SP}" height="${SP}" fill="#1a1208"/>
        <circle cx="${SP / 2}" cy="${SP / 2}" r="${SP * .22}" fill="#b87333"/>
        <circle cx="${SP / 2}" cy="${SP / 2}" r="${SP * .09}" fill="#0d0a06"/>
      </pattern>
      ${maskContent}
    </defs>
    <rect x="${OX}" y="${OY}" width="${W}" height="${H}" fill="url(#perfPattern)" ${bounds ? 'mask="url(#fadeMask)"' : ''}/>
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

let cachedRatsnest = '';
let lastComponents = null;

export function generateRatsnestSVG(components, wires = [], isDragging = false) {
  const nets = getAllNets(components);
  let out = '';
  for (const netObj of nets) {
    const { net, pins } = netObj;
    if (pins.length < 2) continue;

    // If this net has a successful (non-failed) wire, hide the ratsnest
    const isRouted = wires.some(w => w.net === net && !w.failed);
    if (isRouted) continue;

    const conn = new Set([0]);
    while (conn.size < pins.length) {
      let bD = Infinity, bI = -1, bJ = -1;
      conn.forEach(i => pins.forEach((p, j) => {
        if (conn.has(j)) return;
        const d = Math.abs(pins[i].col - p.col) + Math.abs(pins[i].row - p.row);
        if (d < bD) { bD = d; bI = i; bJ = j; }
      }));
      if (bJ === -1) break;
      out += `<line x1="${pins[bI].col * SP + SP / 2}" y1="${pins[bI].row * SP + SP / 2}" x2="${pins[bJ].col * SP + SP / 2}" y2="${pins[bJ].row * SP + SP / 2}" stroke="${netColor(net)}" opacity="0.75" stroke-width="2" stroke-dasharray="6 4"/>`;
      conn.add(bJ);
    }
  }
  cachedRatsnest = out;
  return out;
}

export function renderCompSVG(c, isSelected = false) {
  const bx = c.ox * SP + SP * .08, by = c.oy * SP + SP * .08;
  const bw = c.w * SP - SP * .16, bh = c.h * SP - SP * .16;
  const mainColor = boostColor(compColor(c));

  let out = `<g class="pcb-comp" data-id="${c.id}">`;

  // 1. Draw Component Base (balanced shine-through, solid rim)
  const sw = 2.2; // stroke width
  const half = sw / 2;
  // Body: Inset by half the stroke width so it doesn't overlap the inner stroke half
  out += `<rect x="${bx + half}" y="${by + half}" width="${bw - sw}" height="${bh - sw}" rx="3" fill="#080808" fill-opacity="0.8"/>`;
  // Rim: Drawn with fill="none" to ensure uniform wire visibility through the stroke
  out += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="none" stroke="${mainColor}" stroke-width="${sw}" stroke-opacity="0.8"/>`;
  // subtle tint overlay (entire area)
  out += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${mainColor}" opacity="0.08" style="pointer-events:none"/>`;

  // 2. Draw Pins
  c.pins.forEach(p => {
    const px = p.col * SP + SP / 2, py = p.row * SP + SP / 2;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .28}" fill="#b87333"/>`;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .2}" fill="${netColor(p.net)}"/>`;
    out += `<circle cx="${px}" cy="${py}" r="${SP * .09}" fill="#0d0a06"/>`;
    out += `<text x="${px}" y="${py + SP * .42}" fill="rgba(230,230,230,.9)" font-family="monospace" font-size="${Math.min(SP * .25, 7)}" text-anchor="middle" style="pointer-events:none;user-select:none">${p.lbl}</text>`;
  });

  // 3. Draw Component Labels
  out += `<text x="${bx + 3}" y="${by + SP * 0.35}" fill="#fff" font-family="'Consolas',monospace" font-size="${Math.min(SP * .3, 9)}" font-weight="bold" paint-order="stroke" stroke="#0b0c0e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;user-select:none">${c.id}: ${c.value}</text>`;

  if (isSelected) {
    out += `<rect x="${c.ox * SP - 4}" y="${c.oy * SP - 4}" width="${c.w * SP + 8}" height="${c.h * SP + 8}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 2"/>`;
  }

  out += `</g>`;
  return out;
}

export function generateBoundingBoxSVG(components, wires = []) {
  if (!components.length) return '';

  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  components.forEach(c => {
    minC = Math.min(minC, c.ox);
    maxC = Math.max(maxC, c.ox + c.w);
    minR = Math.min(minR, c.oy);
    maxR = Math.max(maxR, c.oy + c.h);
  });

  wires.forEach(w => {
    if (w.failed) return;
    w.path?.forEach(pt => {
      minC = Math.min(minC, pt.col);
      maxC = Math.max(maxC, pt.col + 1);
      minR = Math.min(minR, pt.row);
      maxR = Math.max(maxR, pt.row + 1);
    });
  });

  if (!isFinite(minC)) return '';

  const strokeWidth = 2;
  const padPx = 3; // Exactly one line width gap
  const x = (minC) * SP - padPx;
  const y = (minR) * SP - padPx;
  const w = (maxC - minC) * SP + padPx * 2;
  const h = (maxR - minR) * SP + padPx * 2;

  // rx=7 (4 comp radius + 3 padding) ensures parallel rounding
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="${strokeWidth}" stroke-dasharray="8 6" rx="7"/>`;
}

export function hitComp(col, row, components) {
  return components.find(c =>
    col >= c.ox && col < c.ox + c.w &&
    row >= c.oy && row < c.oy + c.h
  ) || null;
}
