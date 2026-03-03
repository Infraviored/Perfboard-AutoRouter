// app.js — UI orchestration, rendering, drag/drop
import { anneal } from './placer.js';
import { route, getAllNets } from './router.js';

// ── NET COLORS ──
const NET_PAL = {
  VCC: '#ff5252', GND: '#40c4ff', GATE: '#00e676',
  DRAIN: '#e040fb', SOURCE: '#ff9800', CLK: '#ffea00',
  DATA: '#9c27b0', ADDR: '#00bcd4', CTRL: '#4caf50',
  RESET: '#f44336', CLKEN: '#ff5722', EN: '#795548'
};

const netColorCache = new Map();

function netColor(n) {
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

// ── STATE ──
let COLS = 22, ROWS = 16, SP = 28;
let zoom = 1, panX = 0, panY = 0;
let panning = false, panStart = null;
let tool = 'sel';
let components = [];
let compDefs = [];
let wires = [];
let selComp = null;
let dragging = null, dragOff = null;
let hovNet = null;
let toastTid = null;

// Cache DOM elements
const domElements = {
  cCol: document.getElementById('cCol'),
  cRow: document.getElementById('cRow'),
  cNet: document.getElementById('cNet')
};

let editingComp = null;
let editingCompIndex = -1;
let pinGridSize = 30;
let draggedPin = null;
let pinDragOffset = null;
let selectedPinIndex = null;
let isAddingNewComponent = false;

// CHANGED: Grab SVG instead of Canvas
const pcb = document.getElementById('pcb');

// ── TEMPLATE ──
const TEMPLATE = {
  board: { cols: 22, rows: 16 },
  components: [
    {
      id: 'J1', name: 'Power', value: '2-pin', color: '#2a2808',
      pins: [{ offset: [0, 0], net: 'VCC', label: '+' }, { offset: [0, 1], net: 'GND', label: '-' }]
    },
    {
      id: 'R1', name: 'Resistor', value: '10k', color: '#2e1a08',
      pins: [{ offset: [0, 0], net: 'VCC', label: '1' }, { offset: [2, 0], net: 'GATE', label: '2' }]
    },
    {
      id: 'Q1', name: 'N-MOSFET', value: 'IRLZ44N', color: '#1a3320',
      pins: [{ offset: [0, 0], net: 'GATE', label: 'G' },
      { offset: [1, 0], net: 'DRAIN', label: 'D' },
      { offset: [2, 0], net: 'SOURCE', label: 'S' }]
    },
    {
      id: 'RL1', name: 'Relay', value: '5V coil', color: '#1a1a2e',
      pins: [{ offset: [0, 0], net: 'VCC', label: 'A' }, { offset: [0, 1], net: 'DRAIN', label: 'B' }]
    },
    {
      id: 'C1', name: 'Cap', value: '100uF', color: '#0e2222',
      pins: [{ offset: [0, 0], net: 'VCC', label: '+' }, { offset: [1, 0], net: 'GND', label: '-' }]
    },
    {
      id: 'D1', name: 'Diode', value: '1N4007', color: '#2a0a18',
      pins: [{ offset: [0, 0], net: 'SOURCE', label: 'K' }, { offset: [1, 0], net: 'GND', label: 'A' }]
    }
  ],
  connections: [
    { net: 'VCC', comment: 'J1+ → R1[1], RL1[A], C1+' },
    { net: 'GND', comment: 'J1- → C1-, D1[A]' },
    { net: 'GATE', comment: 'R1[2] → Q1[G]' },
    { net: 'DRAIN', comment: 'Q1[D] → RL1[B]' },
    { net: 'SOURCE', comment: 'Q1[S] → D1[K]' }
  ]
};

// ── BOARD ──
function applyBoard() {
  COLS = Math.max(5, parseInt(document.getElementById('bCols').value) || 22);
  ROWS = Math.max(5, parseInt(document.getElementById('bRows').value) || 16);

  const W = COLS * SP;
  const H = ROWS * SP;

  // Update SVG container dimensions directly
  pcb.setAttribute('width', W);
  pcb.setAttribute('height', H);
  pcb.style.width = W + 'px';
  pcb.style.height = H + 'px';

  fitView(); render(); updateStats();
  badge(2);
  toast(`Board: ${COLS}×${ROWS}`, 'ok');
  setStatus(`${COLS}×${ROWS} board ready`);
}

function badge(n) {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById('s' + i + 'b');
    el.className = 'sbadge' + (i === n ? ' act' : i < n ? ' done' : '');
  }
}

// ── TEMPLATE / JSON ──
function loadTemplate() {
  document.getElementById('jsonInput').value = JSON.stringify(TEMPLATE, null, 2);
  document.getElementById('jsonErr').textContent = '';
}

function loadComponents() {
  const raw = document.getElementById('jsonInput').value.trim();
  document.getElementById('jsonErr').textContent = '';
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { document.getElementById('jsonErr').textContent = 'Parse error: ' + e.message; return; }

  if (data.board) {
    if (data.board.cols) document.getElementById('bCols').value = data.board.cols;
    if (data.board.rows) document.getElementById('bRows').value = data.board.rows;
    applyBoard();
  }
  if (!data.components?.length) {
    document.getElementById('jsonErr').textContent = 'Missing "components" array'; return;
  }

  compDefs = data.components.map((cd, idx) => {
    if (!cd.pins?.length) return null;
    const offsets = cd.pins.map(p =>
      Array.isArray(p.offset) ? [...p.offset] : [p.offset?.col || 0, p.offset?.row || 0]);
    const colValues = offsets.map(o => o[0]);
    const rowValues = offsets.map(o => o[1]);
    const minCol = Math.min(...colValues);
    const minRow = Math.min(...rowValues);
    const maxCol = Math.max(...colValues);
    const maxRow = Math.max(...rowValues);

    const normalizedOffsets = offsets.map(off => [off[0] - minCol, off[1] - minRow]);

    return {
      id: cd.id || ('C' + (idx + 1)), name: cd.name || '?', value: cd.value || '',
      color: cd.color || '#222a22',
      routeUnder: !!cd.routeUnder,
      offsets: normalizedOffsets,
      pinNets: cd.pins.map(p => p.net || null),
      pinLbls: cd.pins.map(p => p.label || p.lbl || String(idx + 1)),
      w: maxCol - minCol + 1,
      h: maxRow - minRow + 1,
      boardOffset: [minCol, minRow],
    };
  }).filter(Boolean);

  placeInitial();
  wires = [];
  renderCompList(); render(); updateStats(); renderNetPanel();
  badge(3);
  toast(`Loaded ${components.length} components`, 'ok');
  setStatus('Components loaded — click Place & Route');

  saveState(); // <-- ADDED
}

// ── PLACEMENT ──
function placeInitial() {
  components = [];
  compDefs.forEach(cd => {
    const ox = cd.boardOffset ? cd.boardOffset[0] : 1;
    const oy = cd.boardOffset ? cd.boardOffset[1] : 1;
    components.push(makeComp(cd, ox, oy));
  });
}

function makeComp(cd, ox, oy) {
  return {
    id: cd.id, name: cd.name, value: cd.value, color: cd.color,
    routeUnder: !!cd.routeUnder,
    w: cd.w, h: cd.h, ox, oy,
    pins: cd.offsets.map((off, i) => ({
      col: ox + off[0], row: oy + off[1],
      net: cd.pinNets[i], lbl: cd.pinLbls[i],
      dCol: off[0], dRow: off[1]
    }))
  };
}

function moveComp(c, ox, oy) {
  c.ox = ox; c.oy = oy;
  c.pins.forEach(p => { p.col = ox + p.dCol; p.row = oy + p.dRow; });
}

// ── STATE MANAGEMENT ──
let stateHistory = [];
let currentStateIndex = -1;

function initializeState() {
  const savedState = localStorage.getItem('autorouterState');
  if (savedState) {
    try {
      const state = JSON.parse(savedState);
      stateHistory = state.history || [];
      currentStateIndex = state.index || -1;

      if (currentStateIndex >= 0 && stateHistory[currentStateIndex]) {
        restoreState(stateHistory[currentStateIndex]);
      }
    } catch (e) {
      console.error('Failed to load saved state:', e);
      resetState();
    }
  } else {
    resetState();
  }
}

function resetState() {
  stateHistory = [];
  currentStateIndex = -1;
  COLS = 40;
  ROWS = 30;
  document.getElementById('bCols').value = COLS;
  document.getElementById('bRows').value = ROWS;
  components = []; wires = []; compDefs = [];
  saveState();
}

function saveState() {
  const state = {
    boardSize: { cols: COLS, rows: ROWS },
    components: components.map(c => ({
      id: c.id,
      name: c.name,
      value: c.value,
      color: c.color,
      ox: c.ox, oy: c.oy, w: c.w, h: c.h, routeUnder: !!c.routeUnder,
      pins: c.pins.map(p => ({
        dCol: p.dCol, dRow: p.dRow, col: p.col, row: p.row, net: p.net, lbl: p.lbl
      }))
    })),
    wires: wires.map(w => ({
      net: w.net, failed: w.failed, path: w.path || []
    })),
    compDefs: structuredClone(compDefs),
    timestamp: Date.now()
  };

  stateHistory = stateHistory.slice(0, currentStateIndex + 1);
  stateHistory.push(state);
  currentStateIndex++;

  if (stateHistory.length > 50) {
    stateHistory.shift();
    currentStateIndex--;
  }

  localStorage.setItem('autorouterState', JSON.stringify({
    history: stateHistory, index: currentStateIndex
  }));
}

function restoreState(state) {
  COLS = state.boardSize.cols;
  ROWS = state.boardSize.rows;
  document.getElementById('bCols').value = COLS;
  document.getElementById('bRows').value = ROWS;

  const defsById = new Map((state.compDefs || compDefs || []).map(cd => [cd.id, cd]));
  components = state.components.map(c => {
    const def = defsById.get(c.id);
    const out = {
      ...c,
      name: c.name ?? def?.name ?? '?',
      value: c.value ?? def?.value ?? '',
      color: c.color ?? def?.color ?? '#222a22',
      routeUnder: !!(c.routeUnder ?? def?.routeUnder),
      pins: (c.pins || []).map(p => {
        const pp = { ...p };
        if (pp.lbl === undefined) pp.lbl = pp.label;
        if (pp.lbl === undefined) pp.lbl = '';
        if (pp.net === undefined) pp.net = null;
        return pp;
      })
    };
    return out;
  });

  wires = state.wires.map(w => ({
    ...w, path: w.path || []
  }));

  compDefs = state.compDefs ? structuredClone(state.compDefs) : [];

  applyBoard(); // CHANGED: Must call this so SVG actually resizes!
  render();
  updateStats();
  renderNetPanel();
  renderCompList();
}

function goBackState() {
  if (currentStateIndex > 0) {
    currentStateIndex--;
    restoreState(stateHistory[currentStateIndex]);
    localStorage.setItem('autorouterState', JSON.stringify({ history: stateHistory, index: currentStateIndex }));
    toast('Reverted to previous state', 'ok');
  } else toast('No previous state', 'warn');
}

function goForwardState() {
  if (currentStateIndex < stateHistory.length - 1) {
    currentStateIndex++;
    restoreState(stateHistory[currentStateIndex]);
    localStorage.setItem('autorouterState', JSON.stringify({ history: stateHistory, index: currentStateIndex }));
    toast('Advanced to next state', 'ok');
  } else toast('No next state', 'warn');
}

function exportCompleteState() {
  const state = {
    boardSize: { cols: COLS, rows: ROWS },
    components: components.map(c => ({
      id: c.id,
      name: c.name,
      value: c.value,
      color: c.color,
      ox: c.ox, oy: c.oy, w: c.w, h: c.h, routeUnder: !!c.routeUnder,
      pins: c.pins.map(p => ({
        dCol: p.dCol, dRow: p.dRow, col: p.col, row: p.row, net: p.net, lbl: p.lbl
      }))
    })),
    wires: wires.map(w => ({ net: w.net, failed: w.failed, path: w.path || [] })),
    compDefs: structuredClone(compDefs),
    timestamp: Date.now(),
    version: '1.0'
  };

  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `autorouter-complete-state-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Complete state exported', 'ok');
}

function saveComps() {
  return components.map(c => ({
    id: c.id, ox: c.ox, oy: c.oy, w: c.w, h: c.h,
    pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }))
  }));
}

function restoreComps(saved) {
  saved.forEach(s => {
    const comp = components.find(c => c.id === s.id);
    if (comp) {
      comp.ox = s.ox; comp.oy = s.oy;
      comp.w = s.w; comp.h = s.h;

      comp.pins.forEach((p, idx) => {
        p.dCol = s.pins[idx].dCol;
        p.dRow = s.pins[idx].dRow;
        p.col = comp.ox + p.dCol;
        p.row = comp.oy + p.dRow;
      });
    }
  });
}

function snapshotBoardState() {
  return {
    boardSize: { cols: COLS, rows: ROWS },
    components: structuredClone(components),
    wires: structuredClone(wires),
    compDefs: structuredClone(compDefs)
  };
}

function restoreBoardState(s) {
  COLS = s.boardSize.cols;
  ROWS = s.boardSize.rows;
  document.getElementById('bCols').value = COLS;
  document.getElementById('bRows').value = ROWS;
  components = structuredClone(s.components);
  wires = structuredClone(s.wires);
  compDefs = structuredClone(s.compDefs);
  applyBoard();
  render();
  updateStats();
  renderNetPanel();
  renderCompList();
}

function completion(wires) {
  if (!wires.length) return 0;
  const successful = wires.filter(w => !w.failed).length;
  return successful / wires.length;
}

function anyOverlap(comp, allComps) {
  return allComps.some(other =>
    other !== comp &&
    comp.ox < other.ox + other.w && comp.ox + comp.w > other.ox &&
    comp.oy < other.oy + other.h && comp.oy + comp.h > other.oy
  );
}

// ── MAIN ACTIONS ──
async function doPlaceAndRoute() {
  if (!components.length) { toast('No components loaded', 'warn'); return; }
  const maxAttempts = 100;
  let perfectWires = null; let perfectComps = null;
  let bestWires = null; let bestComps = null; let bestCompletion = 0;

  // Clear old wires immediately so rerunning Place & Route doesn't show stale routes during placement.
  wires = [];
  render();
  updateStats();
  renderNetPanel();

  showOverlay(true);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    ostep(1);
    document.getElementById('ot').textContent = `Attempt ${attempt} / ${maxAttempts}`;
    setProg(0, 'Placing…');

    placeInitial();
    await anneal(components, COLS, ROWS, (p, s) => {
      setProg(p * 100, `[${attempt}/${maxAttempts}] SA — ${s}`); render();
    }, () => cancelRequested);

    ostep(2);
    setProg(0, 'Routing…');
    const candidateWires = await route(
      components, COLS, ROWS,
      (p, s) => { setProg(p * 100, `[${attempt}/${maxAttempts}] Route — ${s}`); render(); },
      false
    );

    const c = completion(candidateWires);

    if (c > bestCompletion) {
      bestCompletion = c;
      bestWires = candidateWires;
      bestComps = saveComps();
    }

    if (c === 1.0) {
      perfectWires = candidateWires; perfectComps = saveComps();
      break;
    }
  }

  if (perfectWires) {
    restoreComps(perfectComps); wires = perfectWires;
    const autoOptimize = document.getElementById('autoOptimize').checked;
    if (autoOptimize) {
      ostep(3); setProg(0, 'Optimizing footprint…');
      await doRecursivePushPacking();
    }
    toast(`Perfect routing achieved!`, 'ok');
    // REMOVED saveState() from here so it saves regardless of success
  } else {
    toast(`No perfect routing found. Best completion: ${Math.round(bestCompletion * 100)}%`, 'warn');
    if (bestComps) { restoreComps(bestComps); wires = bestWires; }
  }

  showOverlay(false);
  render(); updateStats(); renderNetPanel();
  finishMsg();

  saveState(); // <-- ADDED (Now saves best attempt even if it wasn't 100% perfect)
}

async function doRouteOnly() {
  if (!components.length) { toast('No components loaded', 'warn'); return; }
  showOverlay(true); ostep(2); setProg(0, 'Routing…');
  wires = await route(components, COLS, ROWS, (p, s) => { setProg(p * 100, s); render(); }, false);
  showOverlay(false);
  render(); updateStats(); renderNetPanel();
  finishMsg();

  saveState(); // <-- ADDED
}

function clearWires() {
  wires = []; render(); updateStats(); toast('Wires cleared', 'inf');
  saveState(); // <-- ADDED 
}

function finishMsg() {
  const fail = wires.filter(w => w.failed).length;
  const ok = wires.filter(w => !w.failed).length;
  if (!fail) toast(`✓ Complete — ${ok} segments`, 'ok');
  else toast(`⚠ ${fail} unrouted — try Place & Route to reposition`, 'warn');
  setStatus('Done. Drag components then Route Only, or Place & Route again.');
}

// ── SVG RENDER ENGINE ──
function render() {
  const W = COLS * SP, H = ROWS * SP;

  // 1. Defs + Background Pattern (Only update if board size actually changes)
  if (lastRenderedW !== W || lastRenderedH !== H) {
    lastRenderedW = W;
    lastRenderedH = H;

    // Safety check: ensure the SVG container matches the new grid size
    pcb.setAttribute('width', W);
    pcb.setAttribute('height', H);
    pcb.style.width = W + 'px';
    pcb.style.height = H + 'px';

    const bgSvg = `
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
    document.getElementById('layer-bg').innerHTML = bgSvg;
  }

  // 2. Wires & Ratsnest
  document.getElementById('layer-ratsnest').innerHTML = wires.length ? '' : generateRatsnestSVG();
  document.getElementById('layer-wires').innerHTML = generateWiresSVG();

  // 3. Components
  let compSvg = '';
  components.forEach(c => { compSvg += renderCompSVG(c); });
  document.getElementById('layer-comps').innerHTML = compSvg;

  // 4. UI Elements (Bounding Box & Selection)
  let uiSvg = '';
  if (components.length > 0) {
    const bbox = calculateFootprintArea();
    const { minCol, maxCol, minRow, maxRow } = bbox.bounds;
    const bbW = (maxCol - minCol + 1) * SP;
    const bbH = (maxRow - minRow + 1) * SP;
    uiSvg += `<rect x="${minCol * SP}" y="${minRow * SP}" width="${bbW}" height="${bbH}" fill="none" stroke="rgba(0, 255, 128, 0.4)" stroke-width="2" stroke-dasharray="8 4"/>`;
  }

  if (selComp) {
    const s = selComp;
    uiSvg += `<rect x="${s.ox * SP - 6}" y="${s.oy * SP - 6}" width="${s.w * SP + 8}" height="${s.h * SP + 8}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  }

  document.getElementById('layer-ui').innerHTML = uiSvg;
}

function generateWiresSVG() {
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

let cachedRatsnest = '';
function generateRatsnestSVG() {
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

// --- Fix 2: SVG Z-Index, Label Placement, and Colored Rim ---
function renderCompSVG(c) {
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

// ── STATS ──
function updateStats() {
  const nets = getAllNets(components);
  const nk = Object.keys(nets);
  const ok = wires.filter(w => !w.failed).length;
  const fail = wires.filter(w => w.failed).length;
  const tc = nk.filter(n => nets[n].length >= 2).reduce((s, n) => s + nets[n].length - 1, 0);
  const wl = wires.filter(w => !w.failed).reduce((s, w) => s + w.path.length - 1, 0);
  const pct = tc > 0 ? Math.round(ok / tc * 100) : null;

  const fb = components.length > 0 ? footprintBoxMetrics(wires) : null;

  document.getElementById('stC').textContent = components.length;
  document.getElementById('stN').textContent = nk.length;
  document.getElementById('stW').textContent = ok;
  document.getElementById('stF').textContent = fail;
  document.getElementById('stL').textContent = wl || '—';
  const elB = document.getElementById('stB');
  const elA = document.getElementById('stA');
  const elR = document.getElementById('stR');
  if (fb) {
    if (elB) elB.textContent = `${fb.width}×${fb.height}`;
    if (elA) elA.textContent = fb.area;
    if (elR) elR.textContent = fb.perim;
  } else {
    if (elB) elB.textContent = '—';
    if (elA) elA.textContent = '—';
    if (elR) elR.textContent = '—';
  }
  const pe = document.getElementById('stP');
  if (pct === null) { pe.textContent = '—'; pe.style.color = 'var(--txt2)'; }
  else if (pct === 100) { pe.textContent = '100% ✓'; pe.style.color = 'var(--grn)'; }
  else { pe.textContent = pct + '%'; pe.style.color = 'var(--org)'; }
}

// --- COMPONENT LIBRARY SYSTEM ---
let componentDatabase = [];

// Fetch DB on startup
fetch('./component_database.json')
  .then(r => r.json())
  .then(data => { componentDatabase = data; })
  .catch(err => console.warn('Could not load component_database.json', err));

function openLibrary() {
  document.getElementById('libraryOverlay').style.display = 'flex';
  document.getElementById('libSearch').value = '';
  filterLibrary(); // Render all initially
}

function closeLibrary() {
  document.getElementById('libraryOverlay').style.display = 'none';
}

function filterLibrary() {
  const q = document.getElementById('libSearch').value.toLowerCase();
  const list = document.getElementById('libList');

  if (!componentDatabase.length) {
    list.innerHTML = '<div style="color:var(--org);font-size:.8em;">Database not loaded. Ensure component_database.json is in the directory.</div>';
    return;
  }

  const filtered = componentDatabase.filter(c =>
    c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)
  );

  list.innerHTML = filtered.map((c, idx) => `
    <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:5px;padding:10px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:bold;color:${c.color || 'var(--txt0)'}">${c.name}</div>
        <div style="font-size:.8em;color:var(--txt2)">${c.value} • ${c.pins.length} pins</div>
      </div>
      <button onclick="app.addFromLibrary(${componentDatabase.indexOf(c)})" style="background:var(--grn);border:none;color:#000;padding:5px 10px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:.8em">
        Add to Board
      </button>
    </div>
  `).join('');
}

function addFromLibrary(dbIndex) {
  const tpl = componentDatabase[dbIndex];
  if (!tpl) return;

  // Generate a unique ID (e.g., U1, U2 if it's an IC, or just auto-increment)
  let prefix = tpl.name.toLowerCase().includes('esp') || tpl.name.toLowerCase().includes('ic') ? 'U' : 'Cmp';
  let counter = 1;
  while (compDefs.some(c => c.id === `${prefix}${counter}`)) { counter++; }
  const newId = `${prefix}${counter}`;

  // Deep clone pins and assign blank nets
  const newPins = tpl.pins.map(p => ({
    offset: [...p.offset],
    net: '', // Must be hooked up by the user later
    label: p.label
  }));

  const newCompDef = {
    id: newId,
    name: tpl.name,
    value: tpl.value,
    color: tpl.color || '#333333',
    routeUnder: false,
    offsets: newPins.map(p => p.offset),
    pinNets: newPins.map(p => p.net),
    pinLbls: newPins.map(p => p.label),
    w: Math.max(...newPins.map(p => p.offset[0])) + 1,
    h: Math.max(...newPins.map(p => p.offset[1])) + 1,
    boardOffset: [1, 1] // Drop it near the top left
  };

  compDefs.push(newCompDef);
  updateJSONFromComponents(); // Sync the text area
  loadComponents(); // Re-render everything

  toast(`${tpl.name} added as ${newId}`, 'ok');
  closeLibrary();
  saveState();
}

// --- Fix 1: Component List Colors ---
function renderCompList() {
  const el = document.getElementById('compList');
  if (!components.length) {
    el.innerHTML = '<div style="font-size:.7em;color:var(--txt2)">No components.</div>'; return;
  }
  el.innerHTML = components.map(c => `
    <div class="comp-card${selComp === c ? ' sel' : ''}" onclick="app.selectComp('${c.id}')" style="border-left: 4px solid ${c.color}">
      <span style="font-weight:600">${c.id}</span>
      <span style="color:var(--txt2);font-size:.88em">${c.value}</span>
      <span style="color:var(--txt2);font-size:.78em">${c.pins.length}p</span>
      <button onclick="event.stopPropagation(); app.openCompEditor('${c.id}')" 
              style="margin-left:auto;background:var(--blu);border:1px solid var(--blu);color:#fff;padding:2px 6px;border-radius:3px;font-size:.7em;cursor:pointer">
        Edit
      </button>
    </div>`).join('');
}

function selectComp(id) {
  selComp = id ? (components.find(c => c.id === id) || null) : null;
  render(); renderCompList();
  const el = document.getElementById('selInfo');
  if (!selComp) {
    el.innerHTML = '<div class="prop-row"><span class="pk">—</span><span class="pv">nothing</span></div>';
    return;
  }
  const c = selComp;
  el.innerHTML = `
    <div class="prop-row"><span class="pk">ID</span><span class="pv">${c.id}</span></div>
    <div class="prop-row"><span class="pk">Name</span><span class="pv">${c.name}</span></div>
    <div class="prop-row"><span class="pk">Value</span><span class="pv">${c.value}</span></div>
    <div class="prop-row"><span class="pk">Pins</span><span class="pv">${c.pins.length}</span></div>
    <div class="prop-row"><span class="pk">Origin</span><span class="pv">(${c.ox}, ${c.oy})</span></div>
    ${c.pins.map(p => `
    <div class="prop-row">
      <span class="pk" style="color:${netColor(p.net)}">${p.lbl}</span>
      <span class="pv">${p.net}</span>
    </div>`).join('')}`;
}

function renderNetPanel() {
  const nets = getAllNets(components);
  document.getElementById('netPanel').innerHTML = Object.keys(nets).map(n => `
    <div class="prop-row" style="cursor:pointer"
      onmouseenter="app.setHovNet('${n}')"
      onmouseleave="app.setHovNet(null)">
      <span class="pk"><span style="display:inline-block;width:9px;height:9px;
        border-radius:50%;background:${netColor(n)};vertical-align:middle"></span></span>
      <span class="pv" style="font-size:.75em">${n}</span>
      <span style="font-size:.65em;color:var(--txt2)">${nets[n].length}p</span>
    </div>`).join('');
}

function setHovNet(n) { hovNet = n; render(); }

// ── DRAG ──
function hitComp(col, row) {
  return components.find(c =>
    col >= c.ox && col < c.ox + c.w &&
    row >= c.oy && row < c.oy + c.h
  ) || null;
}

// --- STATE FOR NEW INPUTS ---
let isSpaceDown = false;
let isRightClick = false;
let lastRenderedW = 0;
let lastRenderedH = 0;

let cancelRequested = false;
let cancelOp = null;

// Prevent context menu on right-click so we can use it to pan
ca.addEventListener('contextmenu', e => e.preventDefault());

// Track Spacebar for Panning
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    isSpaceDown = true;
    ca.style.cursor = 'grab';
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    isSpaceDown = false;
    ca.style.cursor = panning ? 'grabbing' : 'crosshair';
  }
});

// --- MODERN POINTER EVENTS (Mouse + Touch + Pen) ---
ca.addEventListener('pointerdown', e => {
  if (e.target.closest('#overlay') || e.target.closest('.zbtn')) return; // Ignore clicks on UI overlays

  ca.setPointerCapture(e.pointerId); // Keep tracking even if cursor leaves element

  isRightClick = e.button === 2;

  // Middle click, Right click, Spacebar, or Alt-click initiates panning
  if (e.button === 1 || isRightClick || isSpaceDown || e.altKey) {
    panning = true;
    panStart = { x: e.clientX - panX, y: e.clientY - panY };
    ca.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  const { gc, gr } = gridPos(e);
  if (tool === 'sel') {
    const hit = hitComp(gc, gr);
    selComp = hit || null;
    if (hit) {
      dragging = hit;
      // Calculate exact sub-grid offset to prevent visual "jump"
      dragOff = { dc: gc - hit.ox, dr: gr - hit.oy };
    }
    selectComp(hit ? hit.id : null);
    render();
  }
});
let renderQueued = false;
function queueRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      render();
      renderQueued = false;
    });
  }
}

ca.addEventListener('pointermove', e => {
  const { gc, gr } = gridPos(e);

  // Update UI indicators
  domElements.cCol.textContent = gc;
  domElements.cRow.textContent = gr;

  const pin = components.flatMap(c => c.pins).find(p => p.col === gc && p.row === gr);
  const netEl = domElements.cNet;
  if (pin) { netEl.textContent = pin.net; netEl.style.color = netColor(pin.net); }
  else { netEl.textContent = '—'; netEl.style.color = 'var(--txt1)'; }

  // Handle Panning
  if (panning && panStart) {
    panX = e.clientX - panStart.x;
    panY = e.clientY - panStart.y;
    applyT();
    return;
  }

  // Handle Dragging
  if (dragging) {
    const nox = Math.max(0, Math.min(COLS - dragging.w, gc - dragOff.dc));
    const noy = Math.max(0, Math.min(ROWS - dragging.h, gr - dragOff.dr));

    if (nox !== dragging.ox || noy !== dragging.oy) {
      moveComp(dragging, nox, noy);
      // Wait to re-route until pointerup for better performance, 
      // just clear wires and render the move for now.
      wires = [];
      queueRender();
    }
  }
});

ca.addEventListener('pointerup', e => {
  ca.releasePointerCapture(e.pointerId);
  if (panning) {
    panning = false;
    isRightClick = false;
    ca.style.cursor = isSpaceDown ? 'grab' : 'crosshair';
  }
  if (dragging) {
    dragging = null;
    dragOff = null;
    selectComp(selComp?.id || null);
    renderNetPanel();
    updateStats(); // Update stats here instead of every frame of movement
    saveState();
  }
});

// Dismiss modals when clicking dark backdrop
document.getElementById('compEditorOverlay').addEventListener('mousedown', e => {
  if (e.target === e.currentTarget) closeCompEditor();
});
document.getElementById('libraryOverlay').addEventListener('mousedown', e => {
  if (e.target === e.currentTarget) closeLibrary();
});

ca.addEventListener('wheel', e => {
  e.preventDefault(); adjZoom(e.deltaY < 0 ? 1.13 : .885, e.clientX, e.clientY);
}, { passive: false });

// ── ZOOM / PAN ──
function applyT() {
  pcb.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  document.getElementById('cZoom').textContent = Math.round(zoom * 100) + '%';
}
function adjZoom(f, cx, cy) {
  const r = ca.getBoundingClientRect();
  const ox = (cx !== undefined ? cx : r.left + r.width / 2) - r.left;
  const oy = (cy !== undefined ? cy : r.top + r.height / 2) - r.top;
  const nz = Math.max(.15, Math.min(6, zoom * f));
  panX = ox - (ox - panX) * (nz / zoom);
  panY = oy - (oy - panY) * (nz / zoom);
  zoom = nz; applyT(); render();
}
// --- Fix 3: Prevent Board Cutoff ---
function fitView() {
  const r = ca.getBoundingClientRect();
  const padding = 60; // generous padding so nothing hits the extreme edges
  zoom = Math.min((r.width - padding) / (COLS * SP), (r.height - padding) / (ROWS * SP));
  panX = (r.width - COLS * SP * zoom) / 2;
  panY = (r.height - ROWS * SP * zoom) / 2;
  applyT(); render();
}

// ── HELPERS ──
function gridPos(e) {
  const r = ca.getBoundingClientRect();
  return {
    gc: Math.floor((e.clientX - r.left - panX) / zoom / SP),
    gr: Math.floor((e.clientY - r.top - panY) / zoom / SP)
  };
}
function setTool(t) {
  tool = t;
  document.getElementById('btnSel').classList.toggle('act', t === 'sel');
}
function showOverlay(v) { document.getElementById('overlay').classList.toggle('on', v); }
function ostep(n) {
  [1, 2].forEach(i => {
    document.getElementById('os' + i).className =
      'ostep' + (i === n ? ' act' : i < n ? ' done' : '');
  });
}
function setProg(p, s) {
  document.getElementById('ofill').style.width = p + '%';
  document.getElementById('osub').textContent = s;
}

function setBestLine(s) {
  const el = document.getElementById('obest');
  if (!el) return;
  if (!s) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = s;
}
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'on ' + (type || 'inf');
  clearTimeout(toastTid); toastTid = setTimeout(() => el.className = '', 3000);
}
function setStatus(m) { document.getElementById('smsg').textContent = m; }

// CHANGED: Exports actual vector SVG instead of PNG!
function doExport() {
  const a = document.createElement('a');
  a.download = 'perfboard.svg';
  const svgData = new XMLSerializer().serializeToString(pcb);
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  a.href = URL.createObjectURL(blob);
  a.click();
  toast('Exported Vector SVG', 'ok');
}

function fullReset() {
  components = []; compDefs = []; wires = []; selComp = null;
  render(); updateStats();
  document.getElementById('compList').innerHTML =
    '<div style="font-size:.7em;color:var(--txt2)">No components.</div>';
  document.getElementById('selInfo').innerHTML =
    '<div class="prop-row"><span class="pk">—</span><span class="pv">nothing</span></div>';
  document.getElementById('netPanel').innerHTML = '';
  badge(1); toast('Reset', 'inf');
}

document.addEventListener('keydown', e => {
  // Ignore shortcuts if user is typing in an input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Standard Undo/Redo Shortcuts
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); goBackState(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); goForwardState(); return; }

  // Safe Tool & Routing Shortcuts
  if (e.key === 'v' || e.key === 'V') setTool('sel');
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); doPlaceAndRoute(); } // Was F5
  if (e.shiftKey && (e.key === 'R' || e.key === 'r')) { e.preventDefault(); doRouteOnly(); } // Was F6
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); debugBoard(); } // Was F7

  if (e.key === 'Escape') {
    if (cancelOp && document.getElementById('overlay').classList.contains('on')) {
      e.preventDefault();
      cancelRequested = true;
      setProg(parseFloat(document.getElementById('ofill').style.width) || 0, `${cancelOp}: cancelling…`);
      return;
    }

    selComp = null;
    selectComp(null);
    closeCompEditor();
    closeLibrary();
    render();
  }

  // --- SAFE DELETION LOGIC ---
  if ((e.key === 'Delete' || e.key === 'Backspace') && selComp) {
    e.preventDefault();

    // Instead of wiping ALL wires, only delete wires attached to this component
    const compNets = new Set(selComp.pins.map(p => p.net).filter(Boolean));
    wires = wires.filter(w => !compNets.has(w.net));

    components = components.filter(c => c !== selComp);
    selComp = null;
    selectComp(null);
    renderCompList();
    render();
    updateStats();

    toast('Component & attached nets removed', 'warn');
    saveState();
  }
});

// Debug function to print board congestion heatmap
function debugBoard() {
  console.log("=== DEBUG BOARD CONGESTION ===");
  const grid = new Grid(COLS, ROWS);
  components.forEach(c => grid.registerComp(c));
  wires.forEach(w => {
    if (!w.failed && w.path) {
      grid.markWire(w.path);
    }
  });
  grid.debugPrint();

  const bbox = calculateFootprintArea();
  console.log("Current Bounding Box:", bbox);
  toast("Debug info logged to console", "inf");
}

function copyLLMPrompt() {
  const promptText = `Act as an expert electronics engineer. I need you to translate a circuit design into a specific JSON format used by a custom Perfboard Autorouter application.

The JSON must contain two main sections:
1. "board": (Optional) specify {"cols": X, "rows": Y} for board size. 
2. "components": An array of component objects. Each needs:
   - "id": Reference designator (e.g., "R1", "U1").
   - "name": Component type (e.g., "Resistor", "ESP32").
   - "value": Component value/spec (e.g., "10k", "SuperMini").
   - "color": A hex color code for the UI (e.g., "#2e1a08"). Try to use distinct, appropriate colors per component type (e.g., dark green for PCBs, black for ICs, brown for resistors).
   - "pins": An array of pins. Each pin needs:
     - "offset": [col, row] grid coordinates relative to component's top-left (0,0).
     - "net": The net name this pin connects to (e.g., "GND", "VCC", "GATE"). Omit if unconnected.
     - "label": A short 1-4 character label for the pin (e.g., "+", "G", "1").

3. "connections": An array of objects to document nets.
   - "net": The net name.
   - "comment": A human-readable description of what this net connects.

CRITICAL RULES:
- The grid spacing is exactly 1 unit per hole (standard 0.1" perfboard).
- Keep pin offsets contiguous where possible, matching the physical layout of real component (e.g., a standard DIP-8 IC has two rows of 4 pins: [0,0] to [3,0] and [0,3] to [3,3]).
- Ensure net names match EXACTLY across components to ensure the autorouter wires them together.

Example JSON for a simple LED circuit:
{
  "board": { "cols": 15, "rows": 10 },
  "components": [
    {
      "id": "J1", "name": "Power", "value": "5V", "color": "#2a2808",
      "pins": [
        { "offset": [0, 0], "net": "5V", "label": "+" },
        { "offset": [0, 1], "net": "GND", "label": "-" }
      ]
    },
    {
      "id": "R1", "name": "Resistor", "value": "330Ω", "color": "#2e1a08",
      "pins": [
        { "offset": [0, 0], "net": "5V", "label": "1" },
        { "offset": [3, 0], "net": "NET_LED", "label": "2" }
      ]
    },
    {
      "id": "D1", "name": "LED", "value": "Red", "color": "#4a0a0a",
      "pins": [
        { "offset": [0, 0], "net": "NET_LED", "label": "A" },
        { "offset": [1, 0], "net": "GND", "label": "K" }
      ]
    }
  ],
  "connections": [
    { "net": "5V", "comment": "Power supply to Resistor" },
    { "net": "NET_LED", "comment": "Current limited signal to LED anode" },
    { "net": "GND", "comment": "Common ground" }
  ]
}

Now, please generate JSON for the following circuit description:
[INSERT YOUR CIRCUIT DESCRIPTION HERE]`;

  navigator.clipboard.writeText(promptText).then(() => {
    toast('LLM Prompt copied to clipboard! Paste it into ChatGPT/Claude.', 'ok');
  }).catch(err => {
    console.error('Failed to copy: ', err);
    toast('Failed to copy to clipboard', 'err');
  });
}

// ── INIT ──
applyBoard();

// Only auto-load default.json when there is no saved app state.
if (!localStorage.getItem('autorouterState')) {
  fetch('./default.json')
    .then(r => { if (!r.ok) throw new Error('no default.json'); return r.json(); })
    .then(data => {
      document.getElementById('jsonInput').value = JSON.stringify(data, null, 2);
      loadComponents();
      toast('Loaded default.json', 'inf');
    })
    .catch(() => { /* no default.json, silent */ });
}

// ── COMPONENT EDITOR ──
function openCompEditor(compId) {
  const compIndex = compDefs.findIndex(cd => cd.id === compId);
  if (compIndex === -1) return;

  editingComp = structuredClone(compDefs[compIndex]);
  editingCompIndex = compIndex;
  isAddingNewComponent = false;

  document.getElementById('editCompId').value = editingComp.id;
  document.getElementById('editCompName').value = editingComp.name;
  document.getElementById('editCompValue').value = editingComp.value;
  document.getElementById('editCompColor').value = editingComp.color;
  document.getElementById('editCompWidth').value = editingComp.w;
  document.getElementById('editCompHeight').value = editingComp.h;
  const ru = document.getElementById('editCompRouteUnder');
  if (ru) ru.checked = !!editingComp.routeUnder;
  document.getElementById('compEditorTitle').textContent = `Edit Component: ${editingComp.id}`;

  const widthInput = document.getElementById('editCompWidth');
  const heightInput = document.getElementById('editCompHeight');
  widthInput.onchange = () => generatePinGrid();
  heightInput.onchange = () => generatePinGrid();

  generatePinGrid();
  document.getElementById('compEditorOverlay').style.display = 'flex';
}

function closeCompEditor() {
  document.getElementById('compEditorOverlay').style.display = 'none';
  document.getElementById('pinProperties').style.display = 'none';
  editingComp = null; editingCompIndex = -1; selectedPinIndex = null;
  isAddingNewComponent = false; draggedPin = null; pinDragOffset = null;
}

function addNewComponent() {
  editingComp = {
    id: 'NEW' + Date.now(), name: 'New Component', value: '', color: '#2a2808',
    offsets: [[0, 0]], pinNets: ['NET1'], pinLbls: ['1'], w: 1, h: 1, routeUnder: false
  };
  editingCompIndex = -1; isAddingNewComponent = true;

  document.getElementById('editCompId').value = editingComp.id;
  document.getElementById('editCompName').value = editingComp.name;
  document.getElementById('editCompValue').value = editingComp.value;
  document.getElementById('editCompColor').value = editingComp.color;
  document.getElementById('editCompWidth').value = editingComp.w;
  document.getElementById('editCompHeight').value = editingComp.h;
  const ru = document.getElementById('editCompRouteUnder');
  if (ru) ru.checked = !!editingComp.routeUnder;
  document.getElementById('compEditorTitle').textContent = 'Create New Component';

  const widthInput = document.getElementById('editCompWidth');
  const heightInput = document.getElementById('editCompHeight');
  widthInput.onchange = () => generatePinGrid();
  heightInput.onchange = () => generatePinGrid();

  generatePinGrid();
  document.getElementById('compEditorOverlay').style.display = 'flex';
}

function createPinElement(pinIndex, inGrid) {
  const pin = document.createElement('div');
  pin.className = 'pin-element';
  pin.style.width = '20px';
  pin.style.height = '20px';
  pin.style.borderRadius = '50%';
  pin.style.background = netColor(editingComp.pinNets[pinIndex]);
  pin.style.border = selectedPinIndex === pinIndex ? '3px solid #fff' : '2px solid #b87333';
  pin.style.cursor = 'move';
  // Use relative positioning if it's sitting in the legend flexbox
  pin.style.position = inGrid ? 'absolute' : 'relative';
  pin.style.display = 'flex';
  pin.style.alignItems = 'center';
  pin.style.justifyContent = 'center';
  pin.style.fontSize = '10px';
  pin.style.fontWeight = 'bold';
  pin.style.color = '#fff';
  pin.style.zIndex = '10';
  pin.textContent = editingComp.pinLbls[pinIndex];
  pin.dataset.pinIndex = pinIndex;
  pin.draggable = true;

  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    selectPinForEditing(pinIndex);
  });
  pin.addEventListener('dragstart', handlePinDragStart);
  pin.addEventListener('dragend', handlePinDragEnd);

  return pin;
}

function generatePinGrid() {
  const grid = document.getElementById('pinGridEditor');
  const width = parseInt(document.getElementById('editCompWidth').value) || editingComp.w;
  const height = parseInt(document.getElementById('editCompHeight').value) || editingComp.h;

  grid.innerHTML = '';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${width}, ${pinGridSize}px)`;
  grid.style.gap = '2px';
  grid.style.justifyContent = 'center';
  grid.style.padding = '10px';

  // 1. Setup the Legend Container dynamically if it doesn't exist
  let legendContainer = document.getElementById('pinLegendContainer');
  if (!legendContainer) {
    legendContainer = document.createElement('div');
    legendContainer.id = 'pinLegendContainer';
    legendContainer.style.marginTop = '10px';
    legendContainer.style.padding = '10px';
    legendContainer.style.background = 'var(--bg3)';
    legendContainer.style.border = '1px dashed var(--border2)';
    legendContainer.style.borderRadius = '4px';

    const title = document.createElement('div');
    title.style.fontSize = '0.8em';
    title.style.color = 'var(--txt1)';
    title.style.marginBottom = '8px';
    title.textContent = 'Out-of-bounds Pins (Drag to grid or click to edit/delete)';
    legendContainer.appendChild(title);

    const legendGrid = document.createElement('div');
    legendGrid.id = 'pinLegend';
    legendGrid.style.display = 'flex';
    legendGrid.style.flexWrap = 'wrap';
    legendGrid.style.gap = '8px';
    legendGrid.style.minHeight = '24px';
    legendContainer.appendChild(legendGrid);

    // Insert it right after the grid
    grid.parentNode.insertBefore(legendContainer, grid.nextSibling);
  }

  const legend = document.getElementById('pinLegend');
  legend.innerHTML = ''; // Clear out the legend on re-render
  const placedPins = new Set(); // Keep track of what fit on the grid

  // 2. Render the Grid
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = document.createElement('div');
      cell.className = 'pin-grid-cell';
      cell.style.width = pinGridSize + 'px';
      cell.style.height = pinGridSize + 'px';
      cell.style.border = '1px dashed var(--border2)';
      cell.style.borderRadius = '4px';
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';
      cell.style.position = 'relative';
      cell.style.cursor = 'pointer';
      cell.dataset.col = col;
      cell.dataset.row = row;

      const pinIndex = editingComp.offsets.findIndex(off => off[0] === col && off[1] === row);

      if (pinIndex !== -1) {
        placedPins.add(pinIndex);
        cell.appendChild(createPinElement(pinIndex, true));
      } else {
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          const newPinIndex = editingComp.offsets.length;
          editingComp.offsets.push([col, row]);
          editingComp.pinNets.push('NET' + (newPinIndex + 1));
          editingComp.pinLbls.push(String(newPinIndex + 1));
          generatePinGrid();
        });
      }

      cell.addEventListener('dragover', handlePinDragOver);
      cell.addEventListener('drop', handlePinDrop);
      grid.appendChild(cell);
    }
  }

  // 3. Populate Legend with Orphaned Pins
  let hasOutPins = false;
  editingComp.offsets.forEach((off, pinIndex) => {
    if (!placedPins.has(pinIndex)) {
      hasOutPins = true;
      legend.appendChild(createPinElement(pinIndex, false));
    }
  });

  // Only show the legend if there are actually out-of-bounds pins
  legendContainer.style.display = hasOutPins ? 'block' : 'none';
}

function selectPinForEditing(pinIndex) {
  selectedPinIndex = pinIndex;
  generatePinGrid();
  document.getElementById('pinProperties').style.display = 'block';
  document.getElementById('editPinLabel').value = editingComp.pinLbls[pinIndex];
  document.getElementById('editPinNet').value = editingComp.pinNets[pinIndex];
}

function deselectPin() {
  selectedPinIndex = null;
  document.getElementById('pinProperties').style.display = 'none';
  generatePinGrid();
}

function updatePinProperties() {
  if (selectedPinIndex === null) return;
  editingComp.pinLbls[selectedPinIndex] = document.getElementById('editPinLabel').value;
  editingComp.pinNets[selectedPinIndex] = document.getElementById('editPinNet').value;
  generatePinGrid();
  toast('Pin properties updated', 'ok');
}

function deletePin() {
  if (selectedPinIndex === null) return;
  if (editingComp.offsets.length <= 1) { toast('Component must have at least one pin', 'warn'); return; }

  editingComp.offsets.splice(selectedPinIndex, 1);
  editingComp.pinNets.splice(selectedPinIndex, 1);
  editingComp.pinLbls.splice(selectedPinIndex, 1);

  deselectPin(); generatePinGrid();
  toast('Pin deleted', 'ok');
}

function addNewPin() {
  const width = parseInt(document.getElementById('editCompWidth').value) || editingComp.w;
  const height = parseInt(document.getElementById('editCompHeight').value) || editingComp.h;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const exists = editingComp.offsets.some(off => off[0] === col && off[1] === row);
      if (!exists) {
        const newPinIndex = editingComp.offsets.length;
        editingComp.offsets.push([col, row]);
        editingComp.pinNets.push('NET' + (newPinIndex + 1));
        editingComp.pinLbls.push(String(newPinIndex + 1));
        generatePinGrid();
        toast('Pin added', 'ok');
        return;
      }
    }
  }
  toast('No empty positions available. Increase component size.', 'warn');
}

function handlePinDragStart(e) { draggedPin = parseInt(e.target.dataset.pinIndex); e.dataTransfer.effectAllowed = 'move'; e.target.style.opacity = '0.5'; }
function handlePinDragEnd(e) { e.target.style.opacity = '1'; draggedPin = null; }
function handlePinDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.style.background = 'var(--bg4)'; }

function handlePinDrop(e) {
  e.preventDefault(); e.currentTarget.style.background = '';
  if (draggedPin === null) return;

  const newCol = parseInt(e.currentTarget.dataset.col);
  const newRow = parseInt(e.currentTarget.dataset.row);

  const existingPin = editingComp.offsets.findIndex(off => off[0] === newCol && off[1] === newRow);
  if (existingPin !== -1 && existingPin !== draggedPin) { toast('Position already occupied', 'warn'); return; }

  editingComp.offsets[draggedPin] = [newCol, newRow];
  generatePinGrid();
}

function saveComponentEdit() {
  editingComp.id = document.getElementById('editCompId').value;
  editingComp.name = document.getElementById('editCompName').value;
  editingComp.value = document.getElementById('editCompValue').value;
  editingComp.color = document.getElementById('editCompColor').value;
  editingComp.w = parseInt(document.getElementById('editCompWidth').value);
  editingComp.h = parseInt(document.getElementById('editCompHeight').value);
  const ru = document.getElementById('editCompRouteUnder');
  editingComp.routeUnder = ru ? !!ru.checked : false;

  if (!editingComp.id.trim()) { toast('Component ID cannot be empty', 'warn'); return; }

  // --- ADDED SAFEGUARD ---
  const outOfBounds = editingComp.offsets.some(off => off[0] < 0 || off[0] >= editingComp.w || off[1] < 0 || off[1] >= editingComp.h);
  if (outOfBounds) {
    toast('Cannot save: Some pins are outside the new component bounds. Place or delete them.', 'err');
    return;
  }
  // -----------------------

  if (!isAddingNewComponent) {
    const duplicateIndex = compDefs.findIndex((cd, index) => cd.id === editingComp.id && index !== editingCompIndex);
    if (duplicateIndex !== -1) { toast('Component ID already exists', 'warn'); return; }
  }

  if (isAddingNewComponent) { compDefs.push(editingComp); toast(`Component ${editingComp.id} created`, 'ok'); }
  else { compDefs[editingCompIndex] = editingComp; toast(`Component ${editingComp.id} updated`, 'ok'); }

  updateJSONFromComponents(); loadComponents(); closeCompEditor();
}

function updateJSONFromComponents() {
  const data = {
    board: { cols: parseInt(document.getElementById('bCols').value) || 22, rows: parseInt(document.getElementById('bRows').value) || 16 },
    components: compDefs.map(cd => ({
      id: cd.id, name: cd.name, value: cd.value, color: cd.color,
      pins: cd.offsets.map((off, i) => ({
        offset: [off[0] + (cd.boardOffset ? cd.boardOffset[0] : 0), off[1] + (cd.boardOffset ? cd.boardOffset[1] : 0)],
        net: cd.pinNets[i], label: cd.pinLbls[i]
      })),
      routeUnder: !!cd.routeUnder
    }))
  };
  document.getElementById('jsonInput').value = JSON.stringify(data, null, 2);
}

function calculateFootprintArea() {
  if (components.length === 0) return { area: 0, bounds: { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 } };

  let minCol = Infinity, maxCol = -Infinity;
  let minRow = Infinity, maxRow = -Infinity;

  components.forEach(c => {
    minCol = Math.min(minCol, c.ox);
    maxCol = Math.max(maxCol, c.ox + c.w - 1);
    minRow = Math.min(minRow, c.oy);
    maxRow = Math.max(maxRow, c.oy + c.h - 1);
  });

  wires.forEach(w => {
    if (w.path) w.path.forEach(pt => {
      minCol = Math.min(minCol, pt.col);
      maxCol = Math.max(maxCol, pt.col);
      minRow = Math.min(minRow, pt.row);
      maxRow = Math.max(maxRow, pt.row);
    });
  });

  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  const area = width * height;

  return { area, bounds: { minCol, maxCol, minRow, maxRow } };
}

function calculateComponentBounds() {
  if (components.length === 0) return { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 };
  let minCol = Infinity, maxCol = -Infinity;
  let minRow = Infinity, maxRow = -Infinity;
  components.forEach(c => {
    minCol = Math.min(minCol, c.ox);
    maxCol = Math.max(maxCol, c.ox + c.w - 1);
    minRow = Math.min(minRow, c.oy);
    maxRow = Math.max(maxRow, c.oy + c.h - 1);
  });
  return { minCol, maxCol, minRow, maxRow };
}

function footprintBoxMetrics(ws) {
  const b0 = calculateComponentBounds();
  let minCol = b0.minCol, maxCol = b0.maxCol, minRow = b0.minRow, maxRow = b0.maxRow;
  (ws || []).forEach(w => {
    if (w?.path) w.path.forEach(pt => {
      minCol = Math.min(minCol, pt.col);
      maxCol = Math.max(maxCol, pt.col);
      minRow = Math.min(minRow, pt.row);
      maxRow = Math.max(maxRow, pt.row);
    });
  });
  const width = (maxCol - minCol + 1);
  const height = (maxRow - minRow + 1);
  const area = width * height;
  const perim = (width + height) * 2;
  return { area, perim, width, height, bounds: { minCol, maxCol, minRow, maxRow } };
}

function wireLengthMetric(ws) {
  return (ws || []).reduce((s, w) => s + (w.failed ? 0 : Math.max(0, (w.path?.length || 0) - 1)), 0);
}

function scoreState(ws) {
  const comp = completion(ws || []);
  const { area, perim, width, height, bounds } = footprintBoxMetrics(ws || []);
  const wl = wireLengthMetric(ws || []);
  return { comp, area, perim, wl, width, height, bounds };
}

function formatScore(s) {
  if (!s) return '';
  return `Comp ${Math.round((s.comp || 0) * 100)}%, Board ${s.width}×${s.height}, area ${s.area} holes², perimeter ${s.perim} holes, WL ${s.wl}`;
}

function isScoreBetter(a, b) {
  if (a.comp !== b.comp) return a.comp > b.comp;
  if (a.area !== b.area) return a.area < b.area;
  if (a.perim !== b.perim) return a.perim < b.perim;
  if (a.wl !== b.wl) return a.wl < b.wl;
  return false;
}

function rotateComp90InPlace(c) {
  const oldW = c.w;
  c.w = c.h;
  c.h = oldW;
  c.pins.forEach(p => {
    const oldRow = p.dRow;
    p.dRow = p.dCol;
    p.dCol = c.w - 1 - oldRow;
    p.col = c.ox + p.dCol;
    p.row = c.oy + p.dRow;
  });
}

function restoreCompRotation(c, orig) {
  c.w = orig.w;
  c.h = orig.h;
  c.pins.forEach((p, idx) => {
    const op = orig.pins && orig.pins[idx];
    if (op) {
      p.dCol = op.dCol;
      p.dRow = op.dRow;
    }
    p.col = c.ox + p.dCol;
    p.row = c.oy + p.dRow;
  });
}

function findFirstOverlap(moved, comps) {
  const aMinX = moved.ox;
  const aMaxX = moved.ox + moved.w - 1;
  const aMinY = moved.oy;
  const aMaxY = moved.oy + moved.h - 1;
  for (const o of comps) {
    if (o === moved) continue;
    const bMinX = o.ox;
    const bMaxX = o.ox + o.w - 1;
    const bMinY = o.oy;
    const bMaxY = o.oy + o.h - 1;
    const overlap = !(aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY);
    if (overlap) return o;
  }
  return null;
}

function moveVectorTowardWires(c) {
  const nets = getAllNets(components);
  let sumX = 0, sumY = 0, count = 0;
  c.pins.forEach(p => {
    if (!p.net || !nets[p.net]) return;
    nets[p.net].forEach(op => {
      if (op.col >= c.ox && op.col < c.ox + c.w && op.row >= c.oy && op.row < c.oy + c.h) return;
      sumX += op.col;
      sumY += op.row;
      count++;
    });
  });
  if (count === 0) return { dx: 0, dy: 0 };
  const tx = sumX / count;
  const ty = sumY / count;
  const cx = c.ox + c.w / 2;
  const cy = c.oy + c.h / 2;
  const dx = (tx > cx + 0.1) ? 1 : (tx < cx - 0.1) ? -1 : 0;
  const dy = (ty > cy + 0.1) ? 1 : (ty < cy - 0.1) ? -1 : 0;
  return { dx, dy };
}

function pickShrinkDirsForComp(c) {
  const b = calculateComponentBounds();
  const dirs = [];
  if (c.ox === b.minCol) dirs.push({ dx: 1, dy: 0 });
  if (c.ox + c.w - 1 === b.maxCol) dirs.push({ dx: -1, dy: 0 });
  if (c.oy === b.minRow) dirs.push({ dx: 0, dy: 1 });
  if (c.oy + c.h - 1 === b.maxRow) dirs.push({ dx: 0, dy: -1 });

  // Bias toward moving along the "wire pull" direction when possible.
  const pull = moveVectorTowardWires(c);
  const scoreDir = (d) => d.dx * pull.dx + d.dy * pull.dy;
  dirs.sort((a, b) => scoreDir(b) - scoreDir(a));
  return dirs;
}

function stateKeyForPlateau() {
  const byId = [...components].slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(byId.map(c => ({
    id: c.id,
    ox: c.ox,
    oy: c.oy,
    w: c.w,
    h: c.h,
    pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }))
  })));
}

async function enumeratePlateauNeighbors(baseBox, baseScore, cols, rows, maxPerComp = 80, startCompOffset = 0, visited = null, onProgress = null, maxTotalEvals = 80) {
  const out = [];
  const bounds = baseBox.bounds;
  const minX = bounds.minCol;
  const maxX = bounds.maxCol;
  const minY = bounds.minRow;
  const maxY = bounds.maxRow;

  const makeKey = (ox, oy) => `${ox},${oy}`;
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const compsSorted = [...components].slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const ncs = compsSorted.length;
  let totalEvals = 0;
  for (let ci = 0; ci < ncs; ci++) {
    const c = compsSorted[(ci + (startCompOffset % Math.max(1, ncs))) % Math.max(1, ncs)];
    const cId = c.id;
    const orig = { ox: c.ox, oy: c.oy, w: c.w, h: c.h, pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
    let emitted = 0;
    for (let rot = 0; rot < 4; rot++) {
      restoreCompRotation(c, orig);
      moveComp(c, orig.ox, orig.oy);
      for (let r = 0; r < rot; r++) rotateComp90InPlace(c);

      const maxOx = maxX - c.w + 1;
      const maxOy = maxY - c.h + 1;
      if (minX > maxOx || minY > maxOy) continue;

      // Instead of scanning all ox/oy (very slow), sample a small set of promising candidates.
      const cand = [];
      const candSeen = new Set();
      const add = (ox, oy) => {
        if (ox < minX || ox > maxOx || oy < minY || oy > maxOy) return;
        const k = makeKey(ox, oy);
        if (candSeen.has(k)) return;
        candSeen.add(k);
        cand.push({ ox, oy });
      };

      // Boundary / shrink-friendly positions.
      add(minX, orig.oy);
      add(maxOx, orig.oy);
      add(orig.ox, minY);
      add(orig.ox, maxOy);
      add(minX, minY);
      add(minX, maxOy);
      add(maxOx, minY);
      add(maxOx, maxOy);

      // One-step and two-step pulls toward wires.
      const pull = moveVectorTowardWires(c);
      if (pull.dx || pull.dy) {
        add(orig.ox + pull.dx, orig.oy + pull.dy);
        add(orig.ox + 2 * pull.dx, orig.oy + 2 * pull.dy);
        add(orig.ox + 3 * pull.dx, orig.oy + 3 * pull.dy);
      }

      // Small local neighborhood (helps avoid missing near improvements).
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(orig.ox + dx, orig.oy + dy);

      // A few random samples within the current bbox.
      for (let i = 0; i < 10; i++) {
        const ox = minX + Math.floor(Math.random() * (maxOx - minX + 1));
        const oy = minY + Math.floor(Math.random() * (maxOy - minY + 1));
        add(ox, oy);
      }

      shuffle(cand);

      for (const pos of cand) {
        const ox = pos.ox;
        const oy = pos.oy;
        if (rot === 0 && ox === orig.ox && oy === orig.oy) continue;
        moveComp(c, ox, oy);
        if (anyOverlap(c, components)) continue;

        const preKey = stateKeyForPlateau();
        if (visited && visited.has(preKey)) continue;

        totalEvals++;
        if (onProgress) onProgress(totalEvals, maxTotalEvals, `${cId} rot${rot}`);
        if (totalEvals > maxTotalEvals || cancelRequested) break;

        // IMPORTANT FIX: DO NOT run a full `await route` A* for every single candidate. 
        // We defer full routing to `doPlateauExplore`.
        // Measure changes primarily via area bounds for now to quickly filter candidates.
        const cBounds = footprintBoxMetrics(wires);

        if (cBounds.area > baseBox.area) continue;
        if (cBounds.area === baseBox.area && cBounds.perim > baseBox.perim) continue;

        out.push({
          key: preKey,
          comps: saveComps(),
          score: { comp: baseScore.comp, area: cBounds.area, perim: cBounds.perim, wl: baseScore.wl }, // placeholder, full routing evaluated by caller
          compId: cId,
          desc: `${cId}@(${ox},${oy}) rot${rot}`
        });
        emitted++;
        if (emitted >= maxPerComp) break;
      }

      if (totalEvals > maxTotalEvals) break;
      if (emitted >= maxPerComp) break;
    }
    restoreCompRotation(c, orig);
    moveComp(c, orig.ox, orig.oy);
    if (totalEvals > maxTotalEvals) break;
  }
  return out;
}

async function postOptimizePlateauTree(startBestScore, cols, rows) {
  const startComps = saveComps();
  const startWires = wires;

  let bestScore = startBestScore;
  let bestComps = startComps;
  let bestWires = startWires;

  const startBox = footprintBoxMetrics(wires);
  const baseBox = { area: startBox.area, perim: startBox.perim, bounds: startBox.bounds };

  const visited = new Set();
  const q = [];

  const k0 = stateKeyForPlateau();
  visited.add(k0);
  q.push({ comps: startComps, wires: startWires, score: startBestScore, box: baseBox, depth: 0, tag: 'start' });

  const MAX_NODES = 220;
  let nodes = 0;

  while (q.length && nodes < MAX_NODES) {
    const cur = q.shift();
    nodes++;

    restoreComps(cur.comps);
    wires = cur.wires;

    const shrinkRes = await tryShrinkAlongWires(cur.score, cols, rows);
    if (shrinkRes.improved) {
      const msg = `NEW post-opt shrink @node ${nodes}: ${formatScore(shrinkRes.score)}`;
      console.log(msg);
      bestScore = shrinkRes.score;
      bestComps = saveComps();
      bestWires = wires;
      const nb = footprintBoxMetrics(wires);
      const newBox = { area: nb.area, perim: nb.perim, bounds: nb.bounds };
      visited.clear();
      q.length = 0;
      const k = stateKeyForPlateau();
      visited.add(k);
      q.push({ comps: bestComps, wires: bestWires, score: bestScore, box: newBox, depth: 0, tag: 'after-shrink' });
      continue;
    }

    const neighbors = await enumeratePlateauNeighbors(cur.box, cur.score, cols, rows);
    for (const n of neighbors) {
      if (visited.has(n.key)) continue;

      // Compute actual routing metrics before adopting
      restoreComps(n.comps);
      const testWires = await route(components, cols, rows, () => { }, false, () => cancelRequested);
      n.wires = testWires;
      n.score = scoreState(testWires);

      visited.add(n.key);
      const msg = `NEW plateau ${cur.depth + 1}: ${n.desc} | ${formatScore(n.score)}`;
      console.log(msg);
      q.push({ comps: n.comps, wires: n.wires, score: n.score, box: footprintBoxMetrics(n.wires), depth: cur.depth + 1, tag: n.desc });
      if (q.length + nodes >= MAX_NODES) break;
    }
  }

  restoreComps(bestComps);
  wires = bestWires;
  return { improved: isScoreBetter(bestScore, startBestScore), score: bestScore };
}

function tryTranslateWithPush(comp, dx, dy, cols, rows, visited, depth) {
  if (dx === 0 && dy === 0) return false;
  if (visited.has(comp)) return false;
  visited.add(comp);

  const prev = { ox: comp.ox, oy: comp.oy };
  const nx = comp.ox + dx;
  const ny = comp.oy + dy;
  if (nx < 0 || ny < 0 || nx + comp.w > cols || ny + comp.h > rows) return false;

  moveComp(comp, nx, ny);
  let blocker = findFirstOverlap(comp, components);
  if (!blocker) return true;

  // Revert this move, attempt to push blocker, then retry.
  moveComp(comp, prev.ox, prev.oy);

  if (depth >= 4) return false;

  if (tryTranslateWithPush(blocker, dx, dy, cols, rows, visited, depth + 1)) {
    moveComp(comp, nx, ny);
    blocker = findFirstOverlap(comp, components);
    if (!blocker) return true;
    moveComp(comp, prev.ox, prev.oy);
  }

  if (depth <= 2) {
    const orig = { w: blocker.w, h: blocker.h, pins: blocker.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
    rotateComp90InPlace(blocker);
    const rotOk = blocker.ox >= 0 && blocker.oy >= 0 && blocker.ox + blocker.w <= cols && blocker.oy + blocker.h <= rows && !anyOverlap(blocker, components);
    if (rotOk) {
      moveComp(comp, nx, ny);
      blocker = findFirstOverlap(comp, components);
      if (!blocker) return true;
      moveComp(comp, prev.ox, prev.oy);
    }
    restoreCompRotation(blocker, orig);
  }

  if (depth <= 2) {
    const orig = { w: blocker.w, h: blocker.h, pins: blocker.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
    rotateComp90InPlace(blocker);
    if (!anyOverlap(blocker, components)) {
      if (tryTranslateWithPush(blocker, dx, dy, cols, rows, visited, depth + 1)) {
        moveComp(comp, nx, ny);
        blocker = findFirstOverlap(comp, components);
        if (!blocker) return true;
        moveComp(comp, prev.ox, prev.oy);
      }
    }
    restoreCompRotation(blocker, orig);
  }

  return false;
}

async function tryShrinkAlongWires(bestScore, cols, rows) {
  const original = saveComps();
  const originalWires = wires;

  // Prefer components on the boundary.
  const bounds = calculateComponentBounds();
  const onEdge = (c) => c.ox === bounds.minCol || (c.ox + c.w - 1) === bounds.maxCol || c.oy === bounds.minRow || (c.oy + c.h - 1) === bounds.maxRow;
  const candidates = components.filter(onEdge);
  // Try the ones with strongest pull first.
  candidates.sort((a, b) => {
    const pa = moveVectorTowardWires(a);
    const pb = moveVectorTowardWires(b);
    return (Math.abs(pb.dx) + Math.abs(pb.dy)) - (Math.abs(pa.dx) + Math.abs(pa.dy));
  });

  for (const c of candidates) {
    const dirs = pickShrinkDirsForComp(c);
    for (const d of dirs) {
      restoreComps(original);
      wires = originalWires;

      const visited = new Set();
      const ok = tryTranslateWithPush(c, d.dx, d.dy, cols, rows, visited, 0);
      if (!ok) continue;
      if (anyOverlap(c, components)) continue;

      const testWires = await route(components, cols, rows, () => { }, false, () => cancelRequested);
      const testScore = scoreState(testWires);

      // Only allow moves that keep routing completion and improve score.
      if (testScore.comp < bestScore.comp) continue;
      if (!isScoreBetter(testScore, bestScore)) continue;

      wires = testWires;
      return { improved: true, score: testScore };
    }
  }

  restoreComps(original);
  wires = originalWires;
  return { improved: false, score: bestScore };
}

async function explorePlateauStates(bestScore, cols, rows) {
  const baseBounds = calculateComponentBounds();
  const baseW = (baseBounds.maxCol - baseBounds.minCol + 1);
  const baseH = (baseBounds.maxRow - baseBounds.minRow + 1);
  const baseArea = baseW * baseH;
  const basePerim = (baseW + baseH) * 2;

  if (baseArea > 700) return { improved: false, score: bestScore };

  const original = saveComps();
  const originalWires = wires;

  const bounds = baseBounds;
  const candidates = [...components];

  let bestLocalScore = bestScore;
  let bestLocalComps = null;
  let bestLocalWires = null;

  for (const c of candidates) {
    const cOrig = { w: c.w, h: c.h, pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })), ox: c.ox, oy: c.oy };

    for (let rot = 0; rot < 4; rot++) {
      restoreComps(original);
      wires = originalWires;

      const cc = components.find(x => x.id === c.id);
      const rotOrig = { w: cc.w, h: cc.h, pins: cc.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
      for (let r = 0; r < rot; r++) rotateComp90InPlace(cc);

      const minOx = bounds.minCol;
      const maxOx = bounds.maxCol - cc.w + 1;
      const minOy = bounds.minRow;
      const maxOy = bounds.maxRow - cc.h + 1;
      if (minOx > maxOx || minOy > maxOy) {
        restoreCompRotation(cc, rotOrig);
        continue;
      }

      for (let ox = minOx; ox <= maxOx; ox++) {
        for (let oy = minOy; oy <= maxOy; oy++) {
          if (cancelRequested) return { improved: false, score: bestLocalScore };
          if (rot === 0 && ox === cOrig.ox && oy === cOrig.oy) continue;

          moveComp(cc, ox, oy);
          if (anyOverlap(cc, components)) continue;

          const b2 = calculateComponentBounds();
          const w2 = (b2.maxCol - b2.minCol + 1);
          const h2 = (b2.maxRow - b2.minRow + 1);
          const area2 = w2 * h2;
          const per2 = (w2 + h2) * 2;
          if (area2 > baseArea) continue;
          if (area2 === baseArea && per2 > basePerim) continue;

          const testWires = await route(components, cols, rows, () => { }, false, () => cancelRequested);
          const testScore = scoreState(testWires);

          if (testScore.comp < bestScore.comp) continue;

          if (isScoreBetter(testScore, bestLocalScore) || (
            testScore.comp === bestLocalScore.comp &&
            testScore.area === bestLocalScore.area &&
            testScore.perim === bestLocalScore.perim &&
            testScore.wl < bestLocalScore.wl
          )) {
            bestLocalScore = testScore;
            bestLocalComps = saveComps();
            bestLocalWires = testWires;
          }
        }
      }

      restoreCompRotation(cc, rotOrig);
    }
  }

  if (bestLocalComps) {
    restoreComps(bestLocalComps);
    wires = bestLocalWires;
    return { improved: true, score: bestLocalScore };
  }

  restoreComps(original);
  wires = originalWires;
  return { improved: false, score: bestScore };
}

// --- OPTIMIZATION ALGORITHMS ---
// --- OPTIMIZATION ALGORITHMS ---

async function tryRotateOptimize() {
  let bestScore = scoreState(wires);
  let improved = false;

  for (let c of components) {
    const originalW = c.w, originalH = c.h;
    const originalPins = c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }));
    let cImproved = false;

    for (let rot = 1; rot <= 3; rot++) {
      const tempW = c.w;
      c.w = c.h;
      c.h = tempW;

      c.pins.forEach(p => {
        const oldRow = p.dRow;
        p.dRow = p.dCol;
        p.dCol = c.w - 1 - oldRow;
        p.col = c.ox + p.dCol;
        p.row = c.oy + p.dRow;
      });

      if (anyOverlap(c, components)) continue;

      const testWires = await route(components, COLS, ROWS, () => { }, false, () => cancelRequested);
      const testScore = scoreState(testWires);

      if (isScoreBetter(testScore, bestScore)) {
        bestScore = testScore;
        wires = testWires;
        improved = true; cImproved = true; break;
      }
    }

    if (!cImproved) {
      c.w = originalW; c.h = originalH;
      c.pins.forEach((p, idx) => {
        p.dCol = originalPins[idx].dCol;
        p.dRow = originalPins[idx].dRow;
        p.col = c.ox + p.dCol;
        p.row = c.oy + p.dRow;
      });
    }
  }
  return improved;
}

// Topological Gravity Packer: Pulls components toward their connected peers!
async function doRecursivePushPacking() {
  let changed = true;
  let loops = 0;
  let bestScore = scoreState(wires);

  while (changed && loops < 25) {
    if (cancelRequested) break;
    changed = false;
    loops++;

    const { bounds } = calculateFootprintArea();
    const globalCx = bounds.minCol + (bounds.maxCol - bounds.minCol) / 2;
    const globalCy = bounds.minRow + (bounds.maxRow - bounds.minRow) / 2;

    const nets = getAllNets(components);

    // Calculate a specific target "Center of Mass" for EACH component based on its wires
    const compTargets = new Map();
    components.forEach(c => {
      let sumX = 0, sumY = 0, count = 0;

      c.pins.forEach(p => {
        if (p.net && nets[p.net]) {
          nets[p.net].forEach(op => {
            // Don't count pins that are on THIS component
            if (op.col >= c.ox && op.col < c.ox + c.w && op.row >= c.oy && op.row < c.oy + c.h) return;
            sumX += op.col;
            sumY += op.row;
            count++;
          });
        }
      });

      // If connected to things, target their average location. If unconnected, drift to global center.
      if (count > 0) {
        compTargets.set(c, { x: sumX / count, y: sumY / count });
      } else {
        compTargets.set(c, { x: globalCx, y: globalCy });
      }
    });

    // Sort components: furthest from their personal target move first
    const sorted = [...components].sort((a, b) => {
      const tA = compTargets.get(a);
      const tB = compTargets.get(b);
      const distA = Math.max(Math.abs(a.ox + a.w / 2 - tA.x), Math.abs(a.oy + a.h / 2 - tA.y));
      const distB = Math.max(Math.abs(b.ox + b.w / 2 - tB.x), Math.abs(b.oy + b.h / 2 - tB.y));
      return distB - distA;
    });

    const oldStates = saveComps();
    let moveOccurred = false;

    for (let c of sorted) {
      const target = compTargets.get(c);
      let dx = 0, dy = 0;

      // Move toward personal target
      if (c.ox + c.w / 2 < target.x - 0.5) dx = 1;
      else if (c.ox + c.w / 2 > target.x + 0.5) dx = -1;

      if (c.oy + c.h / 2 < target.y - 0.5) dy = 1;
      else if (c.oy + c.h / 2 > target.y + 0.5) dy = -1;

      const tryMove = (mx, my) => {
        if (mx === 0 && my === 0) return false;
        moveComp(c, c.ox + mx, c.oy + my);
        if (anyOverlap(c, components)) {
          moveComp(c, c.ox - mx, c.oy - my); // Revert physical collision
          return false;
        }
        return true;
      };

      // Try moving diagonally first, then slide horizontally or vertically
      if (tryMove(dx, dy) || tryMove(dx, 0) || tryMove(0, dy)) {
        moveOccurred = true;
      }
    }

    if (moveOccurred) {
      const testWires = await route(components, COLS, ROWS, () => { }, false, () => cancelRequested);
      const testScore = scoreState(testWires);

      if (isScoreBetter(testScore, bestScore) || (
        testScore.comp === bestScore.comp && testScore.area === bestScore.area && testScore.perim === bestScore.perim
      )) {
        if (isScoreBetter(testScore, bestScore)) bestScore = testScore;
        wires = testWires;
        changed = true;
      } else {
        restoreComps(oldStates); // Revert if topological move broke a wire
      }
    }
  }
}

async function tryGlobalNudge(bestScore, cols, rows) {
  const dirs = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 }
  ];

  const original = saveComps();
  const originalWires = wires;

  for (const d of dirs) {
    restoreComps(original);

    // Validate bounds for the entire translation first.
    // (Checking overlaps while moving one-by-one can falsely fail because other comps
    // haven't moved yet; a pure translation preserves relative spacing.)
    let inBounds = true;
    for (const c of components) {
      const nx = c.ox + d.dx;
      const ny = c.oy + d.dy;
      if (nx < 0 || ny < 0 || nx + c.w > cols || ny + c.h > rows) { inBounds = false; break; }
    }
    if (!inBounds) continue;

    // Apply the translation atomically.
    for (const c of components) moveComp(c, c.ox + d.dx, c.oy + d.dy);

    const testWires = await route(components, cols, rows, () => { }, false, () => cancelRequested);
    const testScore = scoreState(testWires);
    if (isScoreBetter(testScore, bestScore)) {
      wires = testWires;
      return { improved: true, score: testScore };
    }
  }

  restoreComps(original);
  wires = originalWires;
  return { improved: false, score: bestScore };
}

async function doOptimizeFootprint() {
  if (!components.length) { toast('No components to optimize', 'warn'); return; }

  cancelRequested = false;
  cancelOp = 'Optimize';

  const MAX_ITERS = 100;
  showOverlay(true);
  ostep(1);
  setBestLine('');

  // Keep optimization transactional: if nothing improves, restore exactly.
  const startSnapshot = snapshotBoardState();
  const startWires = await route(components, COLS, ROWS, () => { }, false, () => cancelRequested);
  const startScore = scoreState(startWires);
  wires = startWires;

  // Keep showing pre-opt PCB until we actually beat startScore.
  const startPreviewSnapshot = snapshotBoardState();

  const uiCols = COLS;
  const uiRows = ROWS;
  document.getElementById('ot').textContent = `Optimize 0 / ${MAX_ITERS}`;

  // --- 1. EXPAND VIRTUAL BOARD ---
  const { bounds } = calculateFootprintArea();
  // Pad by 20 units so the Simulated Annealer has room to breathe
  const vCols = Math.max(uiCols, (bounds.maxCol - bounds.minCol) + 20);
  const vRows = Math.max(uiRows, (bounds.maxRow - bounds.minRow) + 20);

  // Center everything initially
  const offsetX = Math.floor(vCols / 2 - (bounds.minCol + (bounds.maxCol - bounds.minCol) / 2));
  const offsetY = Math.floor(vRows / 2 - (bounds.minRow + (bounds.maxRow - bounds.minRow) / 2));
  components.forEach(c => moveComp(c, c.ox + offsetX, c.oy + offsetY));

  setProg(0, `Preparing virtual workspace...`);
  // Route only for internal initialization; evaluation later is done on the original board.
  wires = await route(components, vCols, vRows, () => { }, false, () => cancelRequested);

  // Track Absolute Best
  let globalBestScore = scoreState(wires);
  let globalBestComps = saveComps();
  let globalBestWires = [...wires];

  let bestUiMsg = `Best: ${formatScore(globalBestScore)}`;
  setBestLine(bestUiMsg);

  // Track Progress of Current Search Branch
  let localBestScore = globalBestScore;
  let localBestComps = saveComps();

  let stagnation = 0;
  let macroCount = 0;

  // IMPORTANT: do not render here; keep showing the pre-opt PCB until we have an actual improvement.

  const translateToFitUI = () => {
    const b = calculateComponentBounds();
    const w = (b.maxCol - b.minCol + 1);
    const h = (b.maxRow - b.minRow + 1);
    const margin = 2;
    if (w + margin * 2 > uiCols || h + margin * 2 > uiRows) return false;

    const dx = Math.floor((uiCols - w) / 2) - b.minCol;
    const dy = Math.floor((uiRows - h) / 2) - b.minRow;
    for (const c of components) moveComp(c, c.ox + dx, c.oy + dy);
    return true;
  };

  const translateFootprintToTopLeftUI = () => {
    const fb = footprintBoxMetrics(wires);
    const dx = -fb.bounds.minCol;
    const dy = -fb.bounds.minRow;
    for (const c of components) moveComp(c, c.ox + dx, c.oy + dy);
    if (wires) {
      wires.forEach(w => {
        if (w?.path) w.path.forEach(pt => { pt.col += dx; pt.row += dy; });
      });
    }
  };

  // --- 2. SEARCH LOOP ---
  for (let iter = 1; iter <= MAX_ITERS; iter++) {
    if (cancelRequested) break;
    document.getElementById('ot').textContent = `Optimize ${iter} / ${MAX_ITERS}`;

    if (iter % 10 === 0 || stagnation >= 8) {
      if (stagnation >= 5 && stagnation < 8) {
        // Skip SA, let stagnation hit 8 to trigger plateau explore
      } else {
        // ==========================================
        // MACRO MUTATION (Simulated Annealing)
        // ==========================================
        macroCount++;
        if (stagnation >= 12) {
          const b = calculateComponentBounds();
          const spanX = Math.max(1, (b.maxCol - b.minCol + 1));
          const spanY = Math.max(1, (b.maxRow - b.minRow + 1));
          const cx = Math.floor(vCols / 2 - spanX / 2);
          const cy = Math.floor(vRows / 2 - spanY / 2);
          for (const c of components) {
            const nx = Math.max(0, Math.min(vCols - c.w, cx + Math.floor(Math.random() * 7) - 3));
            const ny = Math.max(0, Math.min(vRows - c.h, cy + Math.floor(Math.random() * 7) - 3));
            moveComp(c, nx, ny);
          }
          stagnation = 6;
        }

        await anneal(components, vCols, vRows, (p, s) => {
          setProg((iter / MAX_ITERS) * 100, `Iter ${iter}: SA Routing ${macroCount} — ${Math.round(p * 100)}%`);
        }, () => cancelRequested);

        if (stagnation >= 12) stagnation = 0; // Reset deep frustration, but let edge stay near plateau
      }
    }

    if (iter % 10 !== 0 && stagnation < 8) {
      // ==========================================
      // MICRO MUTATION (Jitter)
      // ==========================================
      setProg((iter / MAX_ITERS) * 100, `Iter ${iter}: Micro Search (Stagnation: ${stagnation}/8)...`);

      // Branch off the current local working set
      restoreComps(localBestComps);

      // Tweak 1 or 2 components slightly
      const numMutations = Math.max(1, Math.floor(components.length * 0.15));
      let compsToMutate = [...components].sort(() => 0.5 - Math.random()).slice(0, numMutations);

      for (let c of compsToMutate) {
        const oldW = c.w, oldH = c.h, oldOx = c.ox, oldOy = c.oy;
        const oldPins = c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }));

        if (Math.random() < 0.2) {
          c.w = oldH; c.h = oldW;
          c.pins.forEach(p => {
            const r = p.dRow; p.dRow = p.dCol; p.dCol = c.w - 1 - r;
            p.col = c.ox + p.dCol; p.row = c.oy + p.dRow;
          });
        }

        let dx = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);
        let dy = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);

        const nx = Math.max(0, Math.min(vCols - c.w, c.ox + dx));
        const ny = Math.max(0, Math.min(vRows - c.h, c.oy + dy));

        moveComp(c, nx, ny);
        if (anyOverlap(c, components)) {
          c.w = oldW; c.h = oldH;
          moveComp(c, oldOx, oldOy);
          c.pins.forEach((p, idx) => Object.assign(p, oldPins[idx]));
        }
      }
    }

    // --- APPLY PACKING (The Squeeze) ---
    if (cancelRequested) break;
    await doRecursivePushPacking();
    await tryRotateOptimize();
    await doRecursivePushPacking();

    if (cancelRequested) break;
    const nudgeRes = await tryGlobalNudge(localBestScore, vCols, vRows);
    if (nudgeRes.improved) {
      localBestScore = nudgeRes.score;
    }

    if (cancelRequested) break;
    const shrinkRes = await tryShrinkAlongWires(localBestScore, vCols, vRows);
    if (shrinkRes.improved) {
      localBestScore = shrinkRes.score;
      localBestComps = saveComps();
      stagnation = 0;
    }

    if (!cancelRequested && stagnation >= 8) {
      const plateauRes = await explorePlateauStates(localBestScore, vCols, vRows);
      if (plateauRes.improved) {
        localBestScore = plateauRes.score;
        localBestComps = saveComps();
        stagnation = 0;

        const shrink2 = await tryShrinkAlongWires(localBestScore, vCols, vRows);
        if (shrink2.improved) {
          localBestScore = shrink2.score;
          localBestComps = saveComps();
        }
      }
    }

    // --- EVALUATE METRICS ---
    // Translate the current virtual placement into the UI board window for evaluation.
    if (cancelRequested) break;
    const preEval = saveComps();
    const preEvalWires = wires;
    if (!translateToFitUI()) {
      restoreComps(preEval);
      stagnation++;
      await new Promise(r => setTimeout(r, 0));
      continue;
    }

    const testWires = await route(components, uiCols, uiRows, () => { }, false, () => cancelRequested);
    const testScore = scoreState(testWires);

    // 1. Is it a new GLOBAL Best?
    let isGlobalBest = false;
    if (isScoreBetter(testScore, globalBestScore)) isGlobalBest = true;

    // 2. Is it a new LOCAL Best?
    let isLocalBest = false;
    if (isScoreBetter(testScore, localBestScore)) isLocalBest = true;

    if (isGlobalBest) {
      // Save global records
      globalBestScore = testScore;
      globalBestComps = saveComps(); globalBestWires = [...testWires];

      // Sync local records to the new global high score
      localBestScore = testScore;
      localBestComps = saveComps();

      stagnation = 0;
      const msg = `Iter ${iter}: New global best — ${formatScore(testScore)}`;
      console.log(`[Iter ${iter}] NEW GLOBAL BEST! ${formatScore(testScore)}`);
      bestUiMsg = `Best: ${formatScore(testScore)}`;
      setBestLine(bestUiMsg);
      setProg((iter / MAX_ITERS) * 100, msg);

      // UPDATE UI: Only preview if we actually improved over the original pre-opt.
      if (isScoreBetter(testScore, startScore)) {
        wires = globalBestWires;
        render();
        updateStats();
        await new Promise(r => setTimeout(r, 0)); // Let browser paint
      } else {
        restoreBoardState(startPreviewSnapshot);
      }
    }
    else if (isLocalBest) {
      // Made progress, but didn't beat the absolute high score
      localBestScore = testScore;
      localBestComps = saveComps();
      stagnation = 0;
      const msg = `Iter ${iter}: Local improvement — ${formatScore(testScore)}`;
      console.log(`[Iter ${iter}] Local improvement. ${formatScore(testScore)}`);
      setProg((iter / MAX_ITERS) * 100, msg);
    }
    else {
      // Dead end. Increase frustration.
      stagnation++;
    }

    // Always yield event loop to keep the browser responsive
    await new Promise(r => setTimeout(r, 0));

    // Restore the virtual search state after UI-space evaluation/preview.
    restoreComps(preEval);
    wires = preEvalWires;
  }

  // --- 3. CLEANUP & RESTORE ---
  restoreComps(globalBestComps);
  wires = globalBestWires;

  // Always end in UI board dimensions.
  COLS = uiCols;
  ROWS = uiRows;
  document.getElementById('bCols').value = COLS;
  document.getElementById('bRows').value = ROWS;
  applyBoard();

  // Only translate to the UI corner after we're done searching.
  translateFootprintToTopLeftUI();

  // Commit only if strictly improved vs start.
  const finalScore = scoreState(wires);
  if (!isScoreBetter(finalScore, startScore)) {
    restoreBoardState(startSnapshot);
    showOverlay(false);
    cancelOp = null;
    toast('Optimization found no improvement', 'inf');
    return;
  }

  showOverlay(false);
  setBestLine('');
  render(); updateStats(); saveState();
  cancelOp = null;
  if (cancelRequested) toast('Optimization cancelled — kept best so far', 'inf');
  else toast(`Optimization complete!`, "ok");
}

async function doPlateauExplore() {
  if (!components.length) { toast('No components loaded', 'warn'); return; }

  cancelRequested = false;
  cancelOp = 'Plateau';

  const startSnapshot = snapshotBoardState();
  showOverlay(true);
  ostep(2);

  let bestWires = await route(components, COLS, ROWS, () => { }, false, () => cancelRequested);
  let bestScore = scoreState(bestWires);
  const startScore = bestScore;
  wires = bestWires;
  render();
  updateStats();

  let bestMsg = `Best: ${formatScore(bestScore)}`;
  setBestLine(bestMsg);

  const visited = new Set();
  visited.add(stateKeyForPlateau());
  let lastPickedCompId = null;

  const MAX_STEPS = 10;
  const MAX_NEIGHBORS_PER_COMP = 12;
  const MAX_ROUTINGS_PER_STEP = 35;

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (cancelRequested) break;
    setProg((step / MAX_STEPS) * 100, `Plateau explore: step ${step} / ${MAX_STEPS}`);

    const shrinkRes = await tryShrinkAlongWires(bestScore, COLS, ROWS);
    if (shrinkRes.improved) {
      bestScore = shrinkRes.score;
      bestWires = wires;
      bestMsg = `Best: ${formatScore(bestScore)}`;
      setBestLine(bestMsg);
      render();
      updateStats();
      await new Promise(r => setTimeout(r, 0));
      continue;
    }

    const box = footprintBoxMetrics(wires);
    const baseBox = { area: box.area, perim: box.perim, bounds: box.bounds };

    const neighborsAll = await enumeratePlateauNeighbors(
      baseBox,
      bestScore,
      COLS,
      ROWS,
      MAX_NEIGHBORS_PER_COMP,
      step,
      visited,
      (done, total, tag) => {
        if (cancelRequested) return;
        setProg((step / MAX_STEPS) * 100, `Plateau explore: step ${step}/${MAX_STEPS} — eval ${Math.min(done, total)}/${total} (${tag})`);
      },
      MAX_ROUTINGS_PER_STEP
    );
    const neighbors = neighborsAll.filter(n => !visited.has(n.key));
    let pick = null;
    for (const n of neighbors) {
      if (cancelRequested) break;

      restoreComps(n.comps);
      const testWires = await route(components, COLS, ROWS, () => { }, false, () => cancelRequested);
      n.wires = testWires;
      n.score = scoreState(testWires);

      if (n.score.comp < bestScore.comp) continue;
      if (n.score.area > baseBox.area) continue;
      if (n.score.area === baseBox.area && n.score.perim > baseBox.perim) continue;
      if (!pick) pick = n;
      else {
        const a = n.score;
        const b = pick.score;
        // Greedy: try potentially space-shrinking moves first.
        if (a.area !== b.area) { if (a.area < b.area) pick = n; continue; }
        if (a.perim !== b.perim) { if (a.perim < b.perim) pick = n; continue; }

        // Diversify: if tied on space, prefer changing a different component than last time.
        const aSame = lastPickedCompId !== null && String(n.compId) === String(lastPickedCompId);
        const bSame = lastPickedCompId !== null && String(pick.compId) === String(lastPickedCompId);
        if (aSame !== bSame) { if (!aSame) pick = n; continue; }

        if (a.wl < b.wl) pick = n;
      }
    }

    if (!pick) break;
    restoreComps(pick.comps);
    wires = pick.wires;
    visited.add(pick.key);
    lastPickedCompId = pick.compId;
    bestWires = wires;
    bestScore = pick.score;
    bestMsg = `Best: ${formatScore(bestScore)}`;
    setBestLine(bestMsg);
    render();
    updateStats();
    await new Promise(r => setTimeout(r, 0));
  }

  const finalScore = scoreState(wires);
  if (!isScoreBetter(finalScore, startScore)) {
    restoreBoardState(startSnapshot);
  } else {
    saveState();
  }

  showOverlay(false);
  setBestLine('');
  cancelOp = null;
  if (cancelRequested) toast('Plateau explore cancelled — kept best so far', 'inf');
}

function goBack() {
  if (!window.lastState) { toast('No previous state to go back to', 'warn'); return; }

  restoreComps(window.lastState.comps);
  wires = window.lastState.wires;

  render(); updateStats(); renderNetPanel();
  toast('Reverted to previous configuration', 'ok');
  window.lastState = null;
}

function cutToBoundingBox() {
  if (!components.length) {
    toast('No components loaded', 'warn');
    return;
  }

  const { bounds } = calculateFootprintArea();

  // CHANGED: pad from 1 to 0 to remove the empty rim
  const pad = 0;
  const newCols = (bounds.maxCol - bounds.minCol) + 1 + (pad * 2);
  const newRows = (bounds.maxRow - bounds.minRow) + 1 + (pad * 2);

  if (newCols <= 0 || newRows <= 0) { toast('Invalid bounding box', 'warn'); return; }

  COLS = newCols;
  ROWS = newRows;
  document.getElementById('bCols').value = newCols;
  document.getElementById('bRows').value = newRows;

  const offsetX = -bounds.minCol + pad;
  const offsetY = -bounds.minRow + pad;

  components.forEach(comp => {
    comp.ox += offsetX;
    comp.oy += offsetY;
    comp.pins.forEach(pin => {
      pin.col += offsetX;
      pin.row += offsetY;
    });
  });

  wires.forEach(wire => {
    if (wire.path) {
      wire.path.forEach(point => {
        point.col += offsetX;
        point.row += offsetY;
      });
    }
  });

  applyBoard();
  toast(`Board cut to ${newCols}×${newRows}`, 'ok');
  saveState();
}

window.app = {
  applyBoard, loadTemplate, loadComponents,
  doPlaceAndRoute, doRouteOnly, doOptimizeFootprint, goBackState, goForwardState, exportCompleteState, cutToBoundingBox, clearWires, doExport, fullReset,
  doPlateauExplore,
  setTool, adjZoom, fitView, selectComp, setHovNet,
  openCompEditor, closeCompEditor, saveComponentEdit,
  addNewComponent, addNewPin, updatePinProperties, deletePin, deselectPin,
  copyLLMPrompt, openLibrary, closeLibrary, filterLibrary, addFromLibrary
};

initializeState();