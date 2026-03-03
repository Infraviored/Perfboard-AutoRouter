// placer.js
import { Grid } from './grid.js';

// Ultra-fast HPWL heuristic replaces MST
function hpwl(components) {
  const nets = {};
  components.forEach(c => c.pins.forEach(p => {
    if (!p.net) return;
    if (!nets[p.net]) nets[p.net] = { minC: Infinity, maxC: -Infinity, minR: Infinity, maxR: -Infinity };
    const n = nets[p.net];
    if (p.col < n.minC) n.minC = p.col;
    if (p.col > n.maxC) n.maxC = p.col;
    if (p.row < n.minR) n.minR = p.row;
    if (p.row > n.maxR) n.maxR = p.row;
  }));
  
  let total = 0;
  for (const k in nets) {
    const n = nets[k];
    if (n.minC !== Infinity) {
      total += (n.maxC - n.minC) + (n.maxR - n.minR);
    }
  }
  return total;
}

function hasOverlap(a, b) {
  return a.ox < b.ox + b.w && a.ox + a.w > b.ox &&
         a.oy < b.oy + b.h && a.oy + a.h > b.oy;
}

function moveComp(comp, ox, oy) {
  comp.ox = ox; comp.oy = oy;
  comp.pins.forEach(p => { p.col = ox + p.dCol; p.row = oy + p.dRow; });
}

function anyOverlap(comp, all) {
  return all.some(o => o !== comp && hasOverlap(comp, o));
}

// In-place rotation to prevent GC pauses
function rotateCompInPlace(c) {
  const oldW = c.w;
  const oldH = c.h;
  
  // Swap dimensions
  c.w = oldH;
  c.h = oldW;
  
  // Rotate pins 90 degrees clockwise
  c.pins.forEach(p => {
    const oldCol = p.dCol;
    const oldRow = p.dRow;
    
    p.dCol = oldH - 1 - oldRow; 
    p.dRow = oldCol;
    
    // Update absolute grid positions
    p.col = c.ox + p.dCol;
    p.row = c.oy + p.dRow;
  });
}

export async function anneal(components, cols, rows, onProgress, shouldCancel) {
  if (components.length === 0) return;

  function yld() { return new Promise(r => setTimeout(r, 0)); }

  let T = 100, Tmin = 0.5, alpha = 0.94;
  let cur = hpwl(components); // Using HPWL now
  const totalSteps = Math.ceil(Math.log(Tmin / T) / Math.log(alpha));
  let step = 0;

  while (T > Tmin) {
    const MOVES_PER_STEP = 8;
    for (let m = 0; m < MOVES_PER_STEP; m++) {
      if (shouldCancel && shouldCancel()) return;
      const c = components[Math.floor(Math.random() * components.length)];
      const oldOx = c.ox, oldOy = c.oy;
      const oldPins = c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow, col: p.col, row: p.row }));
      const oldW = c.w, oldH = c.h;
      
      // Try rotation in-place
      let rotated = false;
      if (Math.random() < 0.3) {
        rotateCompInPlace(c);
        rotated = true;
      }
      
      const mag = Math.ceil(Math.random() * 4);
      const dirs = [[0,mag],[0,-mag],[mag,0],[-mag,0]];
      const [dox, doy] = dirs[Math.floor(Math.random() * 4)];
      
      const nox = Math.max(1, Math.min(cols - c.w - 1, c.ox + dox));
      const noy = Math.max(1, Math.min(rows - c.h - 1, c.oy + doy));
      moveComp(c, nox, noy);
      
      if (anyOverlap(c, components)) { 
        // Revert 
        c.w = oldW; c.h = oldH;
        moveComp(c, oldOx, oldOy);
        c.pins.forEach((p, i) => Object.assign(p, oldPins[i]));
        continue; 
      }
      
      const ns = hpwl(components); // Fast HPWL evaluation
      const dE = ns - cur;
      
      if (dE < 0 || Math.random() < Math.exp(-dE / T)) { 
        cur = ns; 
      } else { 
        // Revert
        c.w = oldW; c.h = oldH;
        moveComp(c, oldOx, oldOy);
        c.pins.forEach((p, i) => Object.assign(p, oldPins[i]));
      }
    }
    T *= alpha; step++;
    if (shouldCancel && shouldCancel()) return;
    onProgress(step / totalSteps, `SA T=${T.toFixed(1)} WL=${cur}`);
    if (step % 5 === 0) await yld();
  }
}
