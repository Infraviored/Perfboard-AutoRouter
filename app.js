// app.js — UI orchestration, rendering, drag/drop
import { anneal }            from './placer.js';
import { route, getAllNets } from './router.js';

// ── NET COLORS ──
const NET_PAL = { 
  VCC:'#ff5252', GND:'#40c4ff', GATE:'#00e676',
  DRAIN:'#e040fb', SOURCE:'#ff9800', CLK:'#ffea00',
  DATA:'#9c27b0', ADDR:'#00bcd4', CTRL:'#4caf50',
  RESET:'#f44336', CLKEN:'#ff5722', EN:'#795548'
};

// Cache for generated colors to ensure consistency
const netColorCache = new Map();

function netColor(n) {
  // Return gray for null/undefined nets
  if (!n) return '#666';
  
  // Return predefined palette color if exists
  if (NET_PAL[n]) return NET_PAL[n];
  
  // Return cached color if already generated
  if (netColorCache.has(n)) return netColorCache.get(n);
  
  // Generate evenly spaced hue based on string hash
  let h = 5381;
  for (const c of n) h = ((h << 5) + h) + c.charCodeAt(0);
  
  // Use golden ratio for better distribution
  const goldenRatio = 0.618033988749895;
  const hue = (Math.abs(h) / 10000 + goldenRatio) % 1;
  const hueDegrees = Math.floor(hue * 360);
  
  // Use high saturation and medium lightness for vivid colors
  const color = `hsl(${hueDegrees}, 75%, 55%)`;
  
  // Cache the generated color
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

// Add these with your other globals
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');
// Cache DOM elements to prevent thrashing
const domElements = {
  cCol: document.getElementById('cCol'),
  cRow: document.getElementById('cRow'),
  cNet: document.getElementById('cNet')
};

// Component Editor State
let editingComp = null;
let editingCompIndex = -1;
let pinGridSize = 30;
let draggedPin = null;
let pinDragOffset = null;
let selectedPinIndex = null;
let isAddingNewComponent = false;

const cv  = document.getElementById('pcb');
const ctx = cv.getContext('2d');
const ca  = document.getElementById('ca');

// ── TEMPLATE ──
const TEMPLATE = {
  board: { cols: 22, rows: 16 },
  components: [
    { id:'J1', name:'Power', value:'2-pin', color:'#2a2808',
      pins:[{offset:[0,0],net:'VCC',label:'+'},{offset:[0,1],net:'GND',label:'-'}]},
    { id:'R1', name:'Resistor', value:'10k', color:'#2e1a08',
      pins:[{offset:[0,0],net:'VCC',label:'1'},{offset:[2,0],net:'GATE',label:'2'}]},
    { id:'Q1', name:'N-MOSFET', value:'IRLZ44N', color:'#1a3320',
      pins:[{offset:[0,0],net:'GATE',label:'G'},
            {offset:[1,0],net:'DRAIN',label:'D'},
            {offset:[2,0],net:'SOURCE',label:'S'}]},
    { id:'RL1', name:'Relay', value:'5V coil', color:'#1a1a2e',
      pins:[{offset:[0,0],net:'VCC',label:'A'},{offset:[0,1],net:'DRAIN',label:'B'}]},
    { id:'C1', name:'Cap', value:'100uF', color:'#0e2222',
      pins:[{offset:[0,0],net:'VCC',label:'+'},{offset:[1,0],net:'GND',label:'-'}]},
    { id:'D1', name:'Diode', value:'1N4007', color:'#2a0a18',
      pins:[{offset:[0,0],net:'SOURCE',label:'K'},{offset:[1,0],net:'GND',label:'A'}]}
  ],
  connections:[
    {net:'VCC',    comment:'J1+ → R1[1], RL1[A], C1+'},
    {net:'GND',    comment:'J1- → C1-, D1[A]'},
    {net:'GATE',   comment:'R1[2] → Q1[G]'},
    {net:'DRAIN',  comment:'Q1[D] → RL1[B]'},
    {net:'SOURCE', comment:'Q1[S] → D1[K]'}
  ]
};

// ── BOARD ──
function applyBoard() {
  COLS = Math.max(5, parseInt(document.getElementById('bCols').value) || 22);
  ROWS = Math.max(5, parseInt(document.getElementById('bRows').value) || 16);
  
  const dpr = window.devicePixelRatio || 1;
  const W = COLS * SP;
  const H = ROWS * SP;
  
  // Set up main canvas
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  // Set up and pre-render the Offscreen Background Canvas
  bgCanvas.width = W * dpr;
  bgCanvas.height = H * dpr;
  bgCtx.scale(dpr, dpr);
  
  // Draw the heavy background grid ONCE
  bgCtx.fillStyle = '#1a1208'; 
  bgCtx.fillRect(0, 0, W, H);
  bgCtx.strokeStyle = '#c8a800'; 
  bgCtx.lineWidth = 2;
  bgCtx.strokeRect(1, 1, W-2, H-2);

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const px = c*SP + SP/2, py = r*SP + SP/2;
      bgCtx.fillStyle = '#b87333';
      bgCtx.beginPath(); bgCtx.arc(px, py, SP*.22, 0, Math.PI*2); bgCtx.fill();
      bgCtx.fillStyle = '#0d0a06';
      bgCtx.beginPath(); bgCtx.arc(px, py, SP*.09, 0, Math.PI*2); bgCtx.fill();
    }
  }
  
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
      Array.isArray(p.offset) ? [...p.offset] : [p.offset?.col||0, p.offset?.row||0]);
    const colValues = offsets.map(o=>o[0]);
    const rowValues = offsets.map(o=>o[1]);
    const minCol = Math.min(...colValues);
    const minRow = Math.min(...rowValues);
    const maxCol = Math.max(...colValues);
    const maxRow = Math.max(...rowValues);
    
    // Normalize offsets to start from 0,0 for component box
    const normalizedOffsets = offsets.map(off => [off[0] - minCol, off[1] - minRow]);
    
    return {
      id: cd.id || ('C'+(idx+1)), name: cd.name||'?', value: cd.value||'',
      color: cd.color||'#222a22',
      offsets: normalizedOffsets,
      pinNets: cd.pins.map(p => p.net || null),
      pinLbls: cd.pins.map(p => p.label || p.lbl || String(idx+1)),
      w: maxCol - minCol + 1,
      h: maxRow - minRow + 1,
      boardOffset: [minCol, minRow], // Where this component should be placed on board
    };
  }).filter(Boolean);

  placeInitial();
  wires = [];
  renderCompList(); render(); updateStats(); renderNetPanel();
  badge(3);
  toast(`Loaded ${components.length} components`, 'ok');
  setStatus('Components loaded — click Place & Route');
}

// ── PLACEMENT ──
function placeInitial() {
  components = [];
  compDefs.forEach(cd => {
    // Use the boardOffset from JSON, or default to automatic placement
    const ox = cd.boardOffset ? cd.boardOffset[0] : 1;
    const oy = cd.boardOffset ? cd.boardOffset[1] : 1;
    components.push(makeComp(cd, ox, oy));
  });
}

function makeComp(cd, ox, oy) {
  return {
    id: cd.id, name: cd.name, value: cd.value, color: cd.color,
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

// Initialize state from localStorage or create default
function initializeState() {
  const savedState = localStorage.getItem('autorouterState');
  if (savedState) {
    try {
      const state = JSON.parse(savedState);
      stateHistory = state.history || [];
      currentStateIndex = state.index || -1;
      
      // Restore current state if exists
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

// Reset to default state
function resetState() {
  stateHistory = [];
  currentStateIndex = -1;
  
  // Default board size
  COLS = 40;
  ROWS = 30;
  document.getElementById('bCols').value = COLS;
  document.getElementById('bRows').value = ROWS;
  
  components = [];
  wires = [];
  compDefs = [];
  
  saveState();
}

// Save current state to history
function saveState() {
  const state = {
    boardSize: { cols: COLS, rows: ROWS },
    components: components.map(c => ({
      id: c.id,
      ox: c.ox,
      oy: c.oy,
      w: c.w,
      h: c.h,
      pins: c.pins.map(p => ({
        dCol: p.dCol,
        dRow: p.dRow,
        col: p.col,
        row: p.row,
        net: p.net,
        label: p.label
      }))
    })),
    wires: wires.map(w => ({
      net: w.net,
      failed: w.failed,
      path: w.path || []
    })),
    compDefs: compDefs,
    timestamp: Date.now()
  };
  
  // Remove any states after current index (for undo/redo)
  stateHistory = stateHistory.slice(0, currentStateIndex + 1);
  
  // Add new state
  stateHistory.push(state);
  currentStateIndex++;
  
  // Limit history size (keep last 50 states)
  if (stateHistory.length > 50) {
    stateHistory.shift();
    currentStateIndex--;
  }
  
  // Save to localStorage
  localStorage.setItem('autorouterState', JSON.stringify({
    history: stateHistory,
    index: currentStateIndex
  }));
}

// Restore a specific state
function restoreState(state) {
  COLS = state.boardSize.cols;
  ROWS = state.boardSize.rows;
  document.getElementById('bCols').value = COLS;
  document.getElementById('bRows').value = ROWS;
  
  components = state.components.map(c => ({
    ...c,
    pins: c.pins.map(p => ({ ...p }))
  }));
  
  wires = state.wires.map(w => ({
    ...w,
    path: w.path || []
  }));
  
  compDefs = state.compDefs || [];
  
  render(); updateStats(); renderNetPanel();
}

// Go back in state history
function goBackState() {
  if (currentStateIndex > 0) {
    currentStateIndex--;
    restoreState(stateHistory[currentStateIndex]);
    localStorage.setItem('autorouterState', JSON.stringify({
      history: stateHistory,
      index: currentStateIndex
    }));
    toast('Reverted to previous state', 'ok');
  } else {
    toast('No previous state', 'warn');
  }
}

// Go forward in state history
function goForwardState() {
  if (currentStateIndex < stateHistory.length - 1) {
    currentStateIndex++;
    restoreState(stateHistory[currentStateIndex]);
    localStorage.setItem('autorouterState', JSON.stringify({
      history: stateHistory,
      index: currentStateIndex
    }));
    toast('Advanced to next state', 'ok');
  } else {
    toast('No next state', 'warn');
  }
}

// Export complete state (excluding initial JSON)
function exportCompleteState() {
  const state = {
    boardSize: { cols: COLS, rows: ROWS },
    components: components.map(c => ({
      id: c.id,
      ox: c.ox,
      oy: c.oy,
      w: c.w,
      h: c.h,
      pins: c.pins.map(p => ({
        dCol: p.dCol,
        dRow: p.dRow,
        col: p.col,
        row: p.row,
        net: p.net,
        label: p.label
      }))
    })),
    wires: wires.map(w => ({
      net: w.net,
      failed: w.failed,
      path: w.path || []
    })),
    compDefs: compDefs,
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

// ── HELPER FUNCTIONS ──
function saveComps() {
  return components.map(c => ({ 
    id: c.id, 
    ox: c.ox, 
    oy: c.oy, 
    w: c.w, 
    h: c.h,
    pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }))
  }));
}

function restoreComps(saved) {
  saved.forEach(s => {
    const comp = components.find(c => c.id === s.id);
    if (comp) {
      comp.ox = s.ox; 
      comp.oy = s.oy;
      comp.w = s.w;   // Restore width
      comp.h = s.h;   // Restore height
      
      comp.pins.forEach((p, idx) => { 
        p.dCol = s.pins[idx].dCol; // Restore pin offsets
        p.dRow = s.pins[idx].dRow;
        
        // Recalculate absolute grid positions
        p.col = comp.ox + p.dCol; 
        p.row = comp.oy + p.dRow; 
      });
    }
  });
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
  const maxAttempts = 100; // Try up to 100 configurations
  let perfectWires = null;
  let perfectComps = null;
  let bestWires = null;
  let bestComps = null;
  let bestCompletion = 0;

  showOverlay(true);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ① Placement
    ostep(1);
    document.getElementById('ot').textContent = `Attempt ${attempt} / ${maxAttempts}`;
    setProg(0, 'Placing…');

    // Reset to initial placement so SA starts fresh each attempt
    placeInitial();
    await anneal(components, COLS, ROWS, (p, s) => {
      setProg(p * 100, `[${attempt}/${maxAttempts}] SA — ${s}`);
      render();
    });

    // ② Routing
    ostep(2);
    setProg(0, 'Routing…');
    const candidateWires = await route(
      components, COLS, ROWS,
      (p, s) => { setProg(p * 100, `[${attempt}/${maxAttempts}] Route — ${s}`); render(); }
    );

    const c = completion(candidateWires);

    // Track best attempt even if not perfect
    if (c > bestCompletion) {
      bestCompletion = c;
      bestWires = candidateWires;
      bestComps = saveComps();
    }

    // Only accept if 100% successful (no failures)
    if (c === 1.0) {
      perfectWires = candidateWires;
      perfectComps = saveComps();
      console.log(`Perfect routing found on attempt ${attempt}!`);
      break; // Stop immediately when we find perfect routing
    }

    // Log progress for debugging
    if (attempt % 10 === 0) {
      console.log(`Attempt ${attempt}: ${Math.round(c * 100)}% completion, still searching for perfect routing...`);
    }
  }

  if (perfectWires) {
    // Restore perfect configuration
    restoreComps(perfectComps);
    wires = perfectWires;
    
    // ③ Post-placement optimization (optional)
    const autoOptimize = document.getElementById('autoOptimize').checked;
    if (autoOptimize) {
      ostep(3);
      setProg(0, 'Optimizing footprint…');
      await doRecursivePushPacking();
    }
    
    toast(`Perfect routing achieved!`, 'ok');
    saveState(); // Save state after successful routing
  } else {
    // No perfect routing found - restore best attempt for user to see
    toast(`No perfect routing found after ${maxAttempts} attempts. Best completion: ${Math.round(bestCompletion * 100)}%`, 'warn');
    if (bestComps) {
      restoreComps(bestComps);
      wires = bestWires;
    }
  }

  showOverlay(false);
  render(); updateStats(); renderNetPanel();
  finishMsg();
}

async function doRouteOnly() {
  if (!components.length) { toast('No components loaded', 'warn'); return; }
  showOverlay(true); ostep(2); setProg(0, 'Routing…');
  wires = await route(components, COLS, ROWS, (p, s) => { setProg(p * 100, s); render(); });
  showOverlay(false);
  render(); updateStats(); renderNetPanel();
  finishMsg();
}

function clearWires() { wires = []; render(); updateStats(); toast('Wires cleared', 'inf'); }

function finishMsg() {
  const fail = wires.filter(w => w.failed).length;
  const ok   = wires.filter(w => !w.failed).length;
  if (!fail) toast(`✓ Complete — ${ok} segments`, 'ok');
  else       toast(`⚠ ${fail} unrouted — try Place & Route to reposition`, 'warn');
  setStatus('Done. Drag components then Route Only, or Place & Route again.');
}

// ── RENDER ──
function render() {
  const W = COLS * SP, H = ROWS * SP;
  
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Clear and stamp the pre-rendered background in ONE operation
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  // Only draw wires, ratsnest, and components dynamically
  if (!wires.length) drawRatsnest(); // (Consider caching ratsnest next for even more FPS!)
  drawWires();
  components.forEach(c => renderComp(c));
  
  if (components.length > 0) {
    const bbox = calculateFootprintArea();
    const { minCol, maxCol, minRow, maxRow } = bbox.bounds;
    ctx.strokeStyle = 'rgba(0, 255, 128, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(minCol * SP, minRow * SP, (maxCol - minCol + 1) * SP, (maxRow - minRow + 1) * SP);
    ctx.setLineDash([]);
  }

  if (selComp) {
    const s = selComp;
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.setLineDash([3,3]);
    ctx.strokeRect(s.ox*SP - 6, s.oy*SP - 6, s.w*SP + 8, s.h*SP + 8);
    ctx.setLineDash([]);
  }
}

function drawWires() {
  wires.forEach(w => {
    if (w.failed) return; // draw nothing for failed routes
    ctx.beginPath();
    ctx.lineWidth   = hovNet === w.net ? 4.5 : 2.8;
    ctx.strokeStyle = netColor(w.net);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Enable anti-aliasing for smooth lines
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    w.path.forEach((pt, i) => {
      const px = pt.col*SP + SP/2, py = pt.row*SP + SP/2;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

  // Draw failed routes as dashed red lines ONLY as diagnostic overlay
  wires.filter(w => w.failed).forEach(w => {
    const a = w.path[0], b = w.path[w.path.length-1];
    ctx.beginPath();
    ctx.lineWidth = 1; ctx.strokeStyle = '#ff2222';
    ctx.setLineDash([2, 5]);
    ctx.moveTo(a.col*SP+SP/2, a.row*SP+SP/2);
    ctx.lineTo(b.col*SP+SP/2, b.row*SP+SP/2);
    ctx.stroke(); ctx.setLineDash([]);
  });
}

function drawRatsnest() {
  const nets = getAllNets(components);
  ctx.setLineDash([2,5]); ctx.lineWidth = .8;
  for (const net in nets) {
    if (nets[net].length < 2) continue;
    const pins = nets[net];
    ctx.strokeStyle = netColor(net) + '55';
    const conn = new Set([0]);
    while (conn.size < pins.length) {
      let bD = Infinity, bI = -1, bJ = -1;
      conn.forEach(i => pins.forEach((p,j) => {
        if (conn.has(j)) return;
        const d = Math.abs(pins[i].col-p.col)+Math.abs(pins[i].row-p.row);
        if (d < bD) { bD=d; bI=i; bJ=j; }
      }));
      if (bJ === -1) break;
      ctx.beginPath();
      ctx.moveTo(pins[bI].col*SP+SP/2, pins[bI].row*SP+SP/2);
      ctx.lineTo(pins[bJ].col*SP+SP/2, pins[bJ].row*SP+SP/2);
      ctx.stroke();
      conn.add(bJ);
    }
  }
  ctx.setLineDash([]);
}

function renderComp(c) {
  const bx = c.ox*SP + SP*.08, by = c.oy*SP + SP*.08;
  const bw = c.w*SP  - SP*.16, bh = c.h*SP  - SP*.16;
  roundRect(ctx, bx, by, bw, bh, 4);
  ctx.fillStyle = c.color; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = `bold ${Math.min(SP*.3,9)}px 'Consolas',monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(`${c.id}: ${c.value}`, bx+3, by-2);

  c.pins.forEach(p => {
    const px = p.col*SP + SP/2, py = p.row*SP + SP/2;
    ctx.fillStyle = '#b87333';
    ctx.beginPath(); ctx.arc(px, py, SP*.28, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = netColor(p.net);
    ctx.beginPath(); ctx.arc(px, py, SP*.2,  0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#0d0a06';
    ctx.beginPath(); ctx.arc(px, py, SP*.09, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(230,230,230,.9)';
    ctx.font = `${Math.min(SP*.25,7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(p.lbl, px, py - SP*.33);
  });
  ctx.textAlign = 'left';
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x+r,y); c.lineTo(x+w-r,y);
  c.arcTo(x+w,y,x+w,y+r,r); c.lineTo(x+w,y+h-r);
  c.arcTo(x+w,y+h,x+w-r,y+h,r); c.lineTo(x+r,y+h);
  c.arcTo(x,y+h,x,y+h-r,r); c.lineTo(x,y+r);
  c.arcTo(x,y,x+r,y,r); c.closePath();
}

// ── STATS ──
function updateStats() {
  const nets = getAllNets(components);
  const nk   = Object.keys(nets);
  const ok   = wires.filter(w => !w.failed).length;
  const fail = wires.filter(w =>  w.failed).length;
  const tc   = nk.filter(n => nets[n].length >= 2).reduce((s,n) => s + nets[n].length - 1, 0);
  const wl   = wires.filter(w => !w.failed).reduce((s,w) => s + w.path.length - 1, 0);
  const pct  = tc > 0 ? Math.round(ok / tc * 100) : null;
  
  // Calculate bounding box area
  const bboxArea = (components.length > 0 && (wires.length > 0 || components.length > 0)) 
    ? calculateFootprintArea().area 
    : 0;

  document.getElementById('stC').textContent = components.length;
  document.getElementById('stN').textContent = nk.length;
  document.getElementById('stW').textContent = ok;
  document.getElementById('stF').textContent = fail;
  document.getElementById('stL').textContent = wl || '—';
  document.getElementById('stA').textContent = bboxArea || '—';
  const pe = document.getElementById('stP');
  if (pct === null)    { pe.textContent = '—';       pe.style.color = 'var(--txt2)'; }
  else if (pct === 100){ pe.textContent = '100% ✓';  pe.style.color = 'var(--grn)';  }
  else                 { pe.textContent = pct + '%'; pe.style.color = 'var(--org)';  }
}

function renderCompList() {
  const el = document.getElementById('compList');
  if (!components.length) {
    el.innerHTML = '<div style="font-size:.7em;color:var(--txt2)">No components.</div>'; return;
  }
  el.innerHTML = components.map(c => `
    <div class="comp-card${selComp===c?' sel':''}" onclick="app.selectComp('${c.id}')">
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
    ${c.pins.map(p=>`
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

ca.addEventListener('mousedown', e => {
  if (e.button === 1 || e.altKey) {
    panning = true; panStart = { x: e.clientX - panX, y: e.clientY - panY };
    ca.style.cursor = 'grabbing'; e.preventDefault(); return;
  }
  const { gc, gr } = gridPos(e);
  if (tool === 'sel') {
    const hit = hitComp(gc, gr);
    selComp = hit || null;
    if (hit) { dragging = hit; dragOff = { dc: gc - hit.ox, dr: gr - hit.oy }; }
    selectComp(hit ? hit.id : null);
    render();
  }
});

ca.addEventListener('mousemove', e => {
  const { gc, gr } = gridPos(e);
  domElements.cCol.textContent = gc;
  domElements.cRow.textContent = gr;
  const pin = components.flatMap(c => c.pins).find(p => p.col === gc && p.row === gr);
  const netEl = domElements.cNet;
  if (pin) { netEl.textContent = pin.net; netEl.style.color = netColor(pin.net); }
  else     { netEl.textContent = '—';     netEl.style.color = 'var(--txt1)'; }

  if (panning && panStart) {
    panX = e.clientX - panStart.x; panY = e.clientY - panStart.y; applyT(); return;
  }
  if (dragging) {
    const nox = Math.max(0, Math.min(COLS - dragging.w, gc - dragOff.dc));
    const noy = Math.max(0, Math.min(ROWS - dragging.h, gr - dragOff.dr));
    if (nox !== dragging.ox || noy !== dragging.oy) {
      moveComp(dragging, nox, noy);
      wires = []; render(); updateStats();
    }
  }
});

ca.addEventListener('mouseup', () => {
  if (panning) { panning = false; ca.style.cursor = 'crosshair'; }
  if (dragging) { dragging = null; dragOff = null; selectComp(selComp?.id||null); renderNetPanel(); }
});

ca.addEventListener('wheel', e => {
  e.preventDefault(); adjZoom(e.deltaY < 0 ? 1.13 : .885, e.clientX, e.clientY);
}, { passive: false });

// ── ZOOM / PAN ──
function applyT() {
  cv.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  document.getElementById('cZoom').textContent = Math.round(zoom*100) + '%';
}
function adjZoom(f, cx, cy) {
  const r  = ca.getBoundingClientRect();
  const ox = (cx !== undefined ? cx : r.left + r.width/2)  - r.left;
  const oy = (cy !== undefined ? cy : r.top  + r.height/2) - r.top;
  const nz = Math.max(.15, Math.min(6, zoom * f));
  panX = ox - (ox - panX) * (nz / zoom);
  panY = oy - (oy - panY) * (nz / zoom);
  zoom = nz; applyT(); render();
}
function fitView() {
  const r = ca.getBoundingClientRect();
  zoom = Math.min(r.width / (COLS*SP), r.height / (ROWS*SP)) * .9;
  panX = (r.width  - COLS*SP*zoom) / 2;
  panY = (r.height - ROWS*SP*zoom) / 2;
  applyT(); render();
}

// ── HELPERS ──
function gridPos(e) {
  const r = ca.getBoundingClientRect();
  return {
    gc: Math.floor((e.clientX - r.left - panX) / zoom / SP),
    gr: Math.floor((e.clientY - r.top  - panY) / zoom / SP)
  };
}
function setTool(t) {
  tool = t;
  document.getElementById('btnSel').classList.toggle('act', t === 'sel');
}
function showOverlay(v) { document.getElementById('overlay').classList.toggle('on', v); }
function ostep(n) {
  [1,2].forEach(i => {
    document.getElementById('os'+i).className =
      'ostep' + (i===n?' act':i<n?' done':'');
  });
}
function setProg(p, s) {
  document.getElementById('ofill').style.width = p + '%';
  document.getElementById('osub').textContent = s;
}
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'on ' + (type||'inf');
  clearTimeout(toastTid); toastTid = setTimeout(() => el.className = '', 3000);
}
function setStatus(m) { document.getElementById('smsg').textContent = m; }
function doExport() {
  const a = document.createElement('a'); a.download = 'perfboard.png';
  a.href = cv.toDataURL(); a.click(); toast('Exported PNG', 'ok');
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
  if (e.key==='v'||e.key==='V') setTool('sel');
  if (e.key==='F5') { e.preventDefault(); doPlaceAndRoute(); }
  if (e.key==='F6') { e.preventDefault(); doRouteOnly(); }
  if (e.key==='F7') { e.preventDefault(); debugBoard(); }
  if (e.key==='Escape') { selComp = null; selectComp(null); render(); }
  if ((e.key==='Delete'||e.key==='Backspace') && selComp) {
    components = components.filter(c => c !== selComp);
    wires = []; selComp = null;
    selectComp(null); renderCompList(); render(); updateStats();
    toast('Component removed', 'warn');
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
  
  // Also show current bounding box anchors
  const bbox = calculateFootprintArea();
  console.log("Current Bounding Box:", bbox);
  toast("Debug info logged to console", "inf");
}

// ── INIT ──
applyBoard();

// Auto-load default.json if present
fetch('./default.json')
  .then(r => { if (!r.ok) throw new Error('no default.json'); return r.json(); })
  .then(data => {
    document.getElementById('jsonInput').value = JSON.stringify(data, null, 2);
    loadComponents();
    toast('Loaded default.json', 'inf');
  })
  .catch(() => { /* no default.json, silent */ });

// ── COMPONENT EDITOR ──
function openCompEditor(compId) {
  const compIndex = compDefs.findIndex(cd => cd.id === compId);
  if (compIndex === -1) return;
  
  editingComp = JSON.parse(JSON.stringify(compDefs[compIndex])); // Deep copy
  editingCompIndex = compIndex;
  isAddingNewComponent = false;
  
  // Populate form fields
  document.getElementById('editCompId').value = editingComp.id;
  document.getElementById('editCompName').value = editingComp.name;
  document.getElementById('editCompValue').value = editingComp.value;
  document.getElementById('editCompColor').value = editingComp.color;
  document.getElementById('editCompWidth').value = editingComp.w;
  document.getElementById('editCompHeight').value = editingComp.h;
  document.getElementById('compEditorTitle').textContent = `Edit Component: ${editingComp.id}`;
  
  // Add event listeners for size inputs
  const widthInput = document.getElementById('editCompWidth');
  const heightInput = document.getElementById('editCompHeight');
  
  // Remove existing listeners
  widthInput.onchange = null;
  heightInput.onchange = null;
  
  // Add new listeners
  widthInput.onchange = () => generatePinGrid();
  heightInput.onchange = () => generatePinGrid();
  
  // Generate pin grid
  generatePinGrid();
  
  // Show overlay
  document.getElementById('compEditorOverlay').style.display = 'flex';
}

function closeCompEditor() {
  document.getElementById('compEditorOverlay').style.display = 'none';
  document.getElementById('pinProperties').style.display = 'none';
  editingComp = null;
  editingCompIndex = -1;
  selectedPinIndex = null;
  isAddingNewComponent = false;
  draggedPin = null;
  pinDragOffset = null;
}

function addNewComponent() {
  // Create a new component template
  editingComp = {
    id: 'NEW' + Date.now(),
    name: 'New Component',
    value: '',
    color: '#2a2808',
    offsets: [[0, 0]], // Single pin at origin
    pinNets: ['NET1'],
    pinLbls: ['1'],
    w: 1,
    h: 1
  };
  editingCompIndex = -1; // Will be appended
  isAddingNewComponent = true;
  
  // Populate form fields
  document.getElementById('editCompId').value = editingComp.id;
  document.getElementById('editCompName').value = editingComp.name;
  document.getElementById('editCompValue').value = editingComp.value;
  document.getElementById('editCompColor').value = editingComp.color;
  document.getElementById('editCompWidth').value = editingComp.w;
  document.getElementById('editCompHeight').value = editingComp.h;
  document.getElementById('compEditorTitle').textContent = 'Create New Component';
  
  // Add event listeners for size inputs
  const widthInput = document.getElementById('editCompWidth');
  const heightInput = document.getElementById('editCompHeight');
  widthInput.onchange = () => generatePinGrid();
  heightInput.onchange = () => generatePinGrid();
  
  // Generate pin grid
  generatePinGrid();
  
  // Show overlay
  document.getElementById('compEditorOverlay').style.display = 'flex';
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
  
  // Create grid cells
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
      
      // Check if there's a pin at this position
      const pinIndex = editingComp.offsets.findIndex(off => off[0] === col && off[1] === row);
      if (pinIndex !== -1) {
        const pin = document.createElement('div');
        pin.className = 'pin-element';
        pin.style.width = '20px';
        pin.style.height = '20px';
        pin.style.borderRadius = '50%';
        pin.style.background = netColor(editingComp.pinNets[pinIndex]);
        pin.style.border = selectedPinIndex === pinIndex ? '3px solid #fff' : '2px solid #b87333';
        pin.style.cursor = 'move';
        pin.style.position = 'absolute';
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
        
        // Add click event for selection
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          selectPinForEditing(pinIndex);
        });
        
        // Add drag events
        pin.addEventListener('dragstart', handlePinDragStart);
        pin.addEventListener('dragend', handlePinDragEnd);
        
        cell.appendChild(pin);
      } else {
        // Empty cell - click to add pin
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          // Find first empty position to add pin
          const newPinIndex = editingComp.offsets.length;
          editingComp.offsets.push([col, row]);
          editingComp.pinNets.push('NET' + (newPinIndex + 1));
          editingComp.pinLbls.push(String(newPinIndex + 1));
          generatePinGrid();
        });
      }
      
      // Add drop events to grid cells
      cell.addEventListener('dragover', handlePinDragOver);
      cell.addEventListener('drop', handlePinDrop);
      
      grid.appendChild(cell);
    }
  }
}

function selectPinForEditing(pinIndex) {
  selectedPinIndex = pinIndex;
  
  // Update pin display to show selection
  generatePinGrid();
  
  // Show pin properties panel
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
  
  if (editingComp.offsets.length <= 1) {
    toast('Component must have at least one pin', 'warn');
    return;
  }
  
  editingComp.offsets.splice(selectedPinIndex, 1);
  editingComp.pinNets.splice(selectedPinIndex, 1);
  editingComp.pinLbls.splice(selectedPinIndex, 1);
  
  deselectPin();
  generatePinGrid();
  toast('Pin deleted', 'ok');
}

function addNewPin() {
  // Find first empty position
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

function handlePinDragStart(e) {
  draggedPin = parseInt(e.target.dataset.pinIndex);
  e.dataTransfer.effectAllowed = 'move';
  e.target.style.opacity = '0.5';
}

function handlePinDragEnd(e) {
  e.target.style.opacity = '1';
  draggedPin = null;
}

function handlePinDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.background = 'var(--bg4)';
}

function handlePinDrop(e) {
  e.preventDefault();
  e.currentTarget.style.background = '';
  
  if (draggedPin === null) return;
  
  const newCol = parseInt(e.currentTarget.dataset.col);
  const newRow = parseInt(e.currentTarget.dataset.row);
  
  // Check if position is already occupied
  const existingPin = editingComp.offsets.findIndex(off => off[0] === newCol && off[1] === newRow);
  if (existingPin !== -1 && existingPin !== draggedPin) {
    toast('Position already occupied', 'warn');
    return;
  }
  
  // Update pin position
  editingComp.offsets[draggedPin] = [newCol, newRow];
  
  // Regenerate grid
  generatePinGrid();
}

function saveComponentEdit() {
  // Update component definition
  editingComp.id = document.getElementById('editCompId').value;
  editingComp.name = document.getElementById('editCompName').value;
  editingComp.value = document.getElementById('editCompValue').value;
  editingComp.color = document.getElementById('editCompColor').value;
  editingComp.w = parseInt(document.getElementById('editCompWidth').value);
  editingComp.h = parseInt(document.getElementById('editCompHeight').value);
  
  // Validate component ID
  if (!editingComp.id.trim()) {
    toast('Component ID cannot be empty', 'warn');
    return;
  }
  
  // Check for duplicate ID (except for new components)
  if (!isAddingNewComponent) {
    const duplicateIndex = compDefs.findIndex((cd, index) => 
      cd.id === editingComp.id && index !== editingCompIndex
    );
    if (duplicateIndex !== -1) {
      toast('Component ID already exists', 'warn');
      return;
    }
  }
  
  if (isAddingNewComponent) {
    // Add new component to the array
    compDefs.push(editingComp);
    toast(`Component ${editingComp.id} created`, 'ok');
  } else {
    // Update existing component
    compDefs[editingCompIndex] = editingComp;
    toast(`Component ${editingComp.id} updated`, 'ok');
  }
  
  // Update JSON input
  updateJSONFromComponents();
  
  // Reload components to apply changes
  loadComponents();
  
  // Close editor
  closeCompEditor();
}

function updateJSONFromComponents() {
  const data = {
    board: {
      cols: parseInt(document.getElementById('bCols').value) || 22,
      rows: parseInt(document.getElementById('bRows').value) || 16
    },
    components: compDefs.map(cd => ({
      id: cd.id,
      name: cd.name,
      value: cd.value,
      color: cd.color,
      pins: cd.offsets.map((off, i) => ({
        offset: [off[0] + (cd.boardOffset ? cd.boardOffset[0] : 0), 
                off[1] + (cd.boardOffset ? cd.boardOffset[1] : 0)],
        net: cd.pinNets[i],
        label: cd.pinLbls[i]
      }))
    }))
  };
  
  document.getElementById('jsonInput').value = JSON.stringify(data, null, 2);
}

// FIXED: Comprehensive Bounding Box calculation
function calculateFootprintArea() {
  if (components.length === 0) return { area: 0, bounds: { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 } };
  
  let minCol = Infinity, maxCol = -Infinity;
  let minRow = Infinity, maxRow = -Infinity;
  
  // Account for components
  components.forEach(c => {
    minCol = Math.min(minCol, c.ox);
    maxCol = Math.max(maxCol, c.ox + c.w - 1); // Inclusive grid units
    minRow = Math.min(minRow, c.oy);
    maxRow = Math.max(maxRow, c.oy + c.h - 1);
  });
  
  // Account for wires (even failed ones for safety)
  wires.forEach(w => {
    if (w.path) w.path.forEach(pt => {
      minCol = Math.min(minCol, pt.col);
      maxCol = Math.max(maxCol, pt.col);
      minRow = Math.min(minRow, pt.row);
      maxRow = Math.max(maxRow, pt.row);
    });
  });
  
  const width = (maxCol - minCol + 1);
  const height = (maxRow - minRow + 1);
  return { area: width * height, bounds: { minCol, maxCol, minRow, maxRow } };
}

// NEW: Component-by-component rotation check
async function tryRotateOptimize() {
  let bestWL = wires.reduce((s, w) => s + (w.failed ? 0 : w.path.length), 0);
  let bestArea = calculateFootprintArea().area;
  let improved = false;

  for (let c of components) {
    // Save original state before trying any rotations
    const originalW = c.w, originalH = c.h;
    const originalPins = c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }));
    let cImproved = false;

    // Try 90, 180, 270 degrees sequentially
    for (let rot = 1; rot <= 3; rot++) {
      // Rotate 90 degrees from the CURRENT state
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

      // If it overlaps, keep this rotation and try rotating 90 more degrees
      if (anyOverlap(c, components)) continue;

      const testWires = await route(components, COLS, ROWS, () => {});
      const newArea = calculateFootprintArea().area;
      const newWL = testWires.reduce((s, w) => s + (w.failed ? 0 : w.path.length), 0);

      // Tie-breaker: Accept if Area is smaller OR (Area same AND WL shorter)
      if (completion(testWires) === 1.0 && (newArea < bestArea || (newArea === bestArea && newWL < bestWL))) {
        bestArea = newArea;
        bestWL = newWL;
        wires = testWires;
        improved = true;
        cImproved = true;
        break; // Stop rotating this component, move to the next
      }
    }

    // If 90, 180, and 270 all failed or overlapped, revert to original
    if (!cImproved) {
      c.w = originalW; 
      c.h = originalH;
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

// NEW: Recursive Push Logic
async function doRecursivePushPacking() {
  const directions = [
    { name: 'Right', dx: 1, dy: 0, side: 'minCol' },
    { name: 'Left',  dx: -1, dy: 0, side: 'maxCol' },
    { name: 'Down',  dx: 0, dy: 1, side: 'minRow' },
    { name: 'Up',    dx: 0, dy: -1, side: 'maxRow' }
  ];

  let bestArea = calculateFootprintArea().area;
  let improved = true;
  let loops = 0;

  while (improved && loops < 20) {
    improved = false;
    loops++;

    for (const d of directions) {
      const bbox = calculateFootprintArea().bounds;
      // 1. Identify "Seed" components on current outermost edge
      let movingSet = new Set(components.filter(c => {
        if (d.side === 'minCol') return c.ox === bbox.minCol;
        if (d.side === 'maxCol') return (c.ox + c.w - 1) === bbox.maxCol;
        if (d.side === 'minRow') return c.oy === bbox.minRow;
        if (d.side === 'maxRow') return (c.oy + c.h - 1) === bbox.maxRow;
      }));

      if (movingSet.size === 0) continue;

      // 2. Recursive expansion: find everything these seeds would hit
      let changed = true;
      while (changed) {
        changed = false;
        for (const c of movingSet) {
          const nx = c.ox + d.dx, ny = c.oy + d.dy;
          // Find overlaps if THIS component moved
          components.forEach(other => {
            if (movingSet.has(other)) return;
            // Check if 'c' moved by (dx, dy) would hit 'other'
            const overlap = (nx < other.ox + other.w && nx + c.w > other.ox &&
                             ny < other.oy + other.h && ny + c.h > other.oy);
            if (overlap) {
              movingSet.add(other);
              changed = true;
            }
          });
        }
      }

      // 3. Try to move the entire cluster
      const oldStates = saveComps();
      let validMove = true;
      for (const c of movingSet) {
        const nx = c.ox + d.dx, ny = c.oy + d.dy;
        if (nx < 0 || nx + c.w > COLS || ny < 0 || ny + c.h > ROWS) {
          validMove = false; break;
        }
        moveComp(c, nx, ny);
      }

      if (validMove) {
        const testWires = await route(components, COLS, ROWS, () => {});
        const newArea = calculateFootprintArea().area;
        // Accept if routing holds AND we didn't grow the box
        if (completion(testWires) === 1.0 && newArea <= bestArea) {
          if (newArea < bestArea) {
            bestArea = newArea;
            improved = true;
          }
          wires = testWires;
        } else {
          restoreComps(oldStates);
        }
      } else {
        restoreComps(oldStates);
      }
    }
    render(); await new Promise(r => setTimeout(r, 10));
  }
}

// MAIN ACTION: Auto-Converging Footprint Optimization
async function doOptimizeFootprint() {
  const MAX_CONFIGS = 50; // Hard cap so your browser doesn't hang forever
  const PATIENCE = 6;     // Stop if we don't improve after this many configs
  
  let globalBestArea = Infinity;
  let globalBestWL = Infinity;
  let globalBestComps = null;
  let globalBestWires = null;
  
  let configsWithoutImprovement = 0;

  showOverlay(true);

  // Baseline capture (in case current layout is already great)
  const initialArea = calculateFootprintArea().area;
  if (initialArea > 0 && completion(wires) === 1.0) {
    globalBestArea = initialArea;
    globalBestWL = wires.reduce((s, w) => s + (w.failed ? 0 : w.path.length), 0);
    globalBestComps = saveComps();
    globalBestWires = [...wires];
  }

  for (let config = 1; config <= MAX_CONFIGS; config++) {
    ostep(1);
    
    // 1. JITTER (Evolutionary Mutation)
    if (config > 1 && globalBestComps) {
      setProg((config / MAX_CONFIGS) * 100, `Config ${config}: Shuffling from best...`);
      restoreComps(globalBestComps); 
      
      // Slightly kick components out of their local minima
      components.forEach(c => {
        // 50% chance to move a component by 1 or 2 grid units
        if (Math.random() > 0.5) {
          const dx = (Math.random() > 0.5 ? 1 : -1) * Math.ceil(Math.random() * 2);
          const dy = (Math.random() > 0.5 ? 1 : -1) * Math.ceil(Math.random() * 2);
          const nx = Math.max(0, Math.min(COLS - c.w, c.ox + dx));
          const ny = Math.max(0, Math.min(ROWS - c.h, c.oy + dy));
          
          if (!anyOverlap({ ox: nx, oy: ny, w: c.w, h: c.h }, components.filter(oc => oc !== c))) {
            moveComp(c, nx, ny);
          }
        }
      });
    }

    // 2. PACK (Push everything to the center/edges)
    setProg((config / MAX_CONFIGS) * 100, `Config ${config}: Initial Pack...`);
    await doRecursivePushPacking();

    // 3. ROTATE (Find better orientations)
    setProg((config / MAX_CONFIGS) * 100, `Config ${config}: Rotating...`);
    await tryRotateOptimize();

    // 4. RE-PACK (Rotation might have opened new gaps!)
    setProg((config / MAX_CONFIGS) * 100, `Config ${config}: Final Pack...`);
    await doRecursivePushPacking();

    // 5. EVALUATE
    const currentArea = calculateFootprintArea().area;
    const currentWL = wires.reduce((s, w) => s + (w.failed ? 0 : w.path.length), 0);
    const successRate = completion(wires);

    // Track the winner across all seeds (must be 100% routed)
    if (successRate === 1.0 && (currentArea < globalBestArea || (currentArea === globalBestArea && currentWL < globalBestWL))) {
      globalBestArea = currentArea;
      globalBestWL = currentWL;
      globalBestComps = saveComps();
      globalBestWires = [...wires];
      console.log(`[Optimizer ${config}] New Leader: Area ${currentArea}, WL ${currentWL}`);
      
      configsWithoutImprovement = 0; // Reset patience because we found a better one!
    } else {
      configsWithoutImprovement++;
      console.log(`[Optimizer ${config}] No improvement. Patience: ${configsWithoutImprovement}/${PATIENCE}`);
    }

    // 6. EARLY EXIT (Plateau Detection)
    if (configsWithoutImprovement >= PATIENCE && globalBestArea !== Infinity) {
      console.log(`[Optimizer] Converged after ${config} configs. Minimum footprint reached.`);
      break;
    }
  }

  // Restore the absolute best configuration found
  if (globalBestComps) {
    restoreComps(globalBestComps);
    wires = globalBestWires;
  }
  
  showOverlay(false);
  render(); updateStats(); saveState();
  toast(`Optimized to Area ${globalBestArea}`, "ok");
}

// Go back to previous configuration
function goBack() {
  if (!window.lastState) {
    toast('No previous state to go back to', 'warn');
    return;
  }
  
  restoreComps(window.lastState.comps);
  wires = window.lastState.wires;
  
  render(); updateStats(); renderNetPanel();
  toast('Reverted to previous configuration', 'ok');
  
  // Clear the stored state
  window.lastState = null;
}

// Cut board to bounding box of components and wires
function cutToBoundingBox() {
  if (!components.length) { 
    toast('No components loaded', 'warn'); 
    return; 
  }
  
  const { bounds } = calculateFootprintArea();
  const newCols = bounds.maxCol - bounds.minCol;
  const newRows = bounds.maxRow - bounds.minRow;
  
  if (newCols <= 0 || newRows <= 0) {
    toast('Invalid bounding box', 'warn');
    return;
  }
  
  // Update board dimensions
  COLS = newCols;
  ROWS = newRows;
  document.getElementById('bCols').value = newCols;
  document.getElementById('bRows').value = newRows;
  
  // Shift all components to origin (0,0)
  const offsetX = -bounds.minCol;
  const offsetY = -bounds.minRow;
  
  components.forEach(comp => {
    comp.ox += offsetX;
    comp.oy += offsetY;
    comp.pins.forEach(pin => {
      pin.col += offsetX;
      pin.row += offsetY;
    });
  });
  
  // Shift all wire paths
  wires.forEach(wire => {
    if (wire.path) {
      wire.path.forEach(point => {
        point.col += offsetX;
        point.row += offsetY;
      });
    }
  });
  
  applyBoard();
  render(); updateStats(); renderNetPanel();
  
  toast(`Board cut to ${newCols}×${newRows} (reduced from ${document.getElementById('bCols').value + offsetX}×${document.getElementById('bRows').value + offsetY})`, 'ok');
  
  saveState(); // Save state after cutting board
}

// Expose functions to global scope
window.app = {
  applyBoard, loadTemplate, loadComponents,
  doPlaceAndRoute, doRouteOnly, doOptimizeFootprint, goBackState, goForwardState, exportCompleteState, cutToBoundingBox, clearWires, doExport, fullReset,
  setTool, adjZoom, fitView, selectComp, setHovNet,
  openCompEditor, closeCompEditor, saveComponentEdit,
  addNewComponent, addNewPin, updatePinProperties, deletePin, deselectPin,
};

// Initialize state system on load
initializeState();
