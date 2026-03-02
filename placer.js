// placer.js — Simulated Annealing component placement
import { Grid } from './grid.js';

function mstWirelength(components) {
  const nets = {};
  components.forEach(c => c.pins.forEach(p => {
    if (!nets[p.net]) nets[p.net] = [];
    nets[p.net].push({ col: p.col, row: p.row });
  }));
  let total = 0;
  for (const n in nets) {
    const pins = nets[n];
    if (pins.length < 2) continue;
    const conn = new Set([0]);
    while (conn.size < pins.length) {
      let bD = Infinity, bI = -1, bJ = -1;
      conn.forEach(i => {
        pins.forEach((p, j) => {
          if (conn.has(j)) return;
          const d = Math.abs(pins[i].col - p.col) + Math.abs(pins[i].row - p.row);
          if (d < bD) { bD = d; bI = i; bJ = j; }
        });
      });
      if (bJ === -1) break;
      total += bD;
      conn.add(bJ);
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

// Calculate net connection score for placement optimization
function netConnectionScore(components) {
  const nets = {};
  components.forEach(c => c.pins.forEach(p => {
    if (p.net) {
      if (!nets[p.net]) nets[p.net] = [];
      nets[p.net].push({ comp: c.id, col: p.col, row: p.row });
    }
  }));
  
  let score = 0;
  for (const net in nets) {
    const pins = nets[net];
    if (pins.length < 2) continue;
    
    // Calculate Manhattan distances between connected pins
    let totalDist = 0;
    for (let i = 0; i < pins.length - 1; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const dist = Math.abs(pins[i].col - pins[j].col) + Math.abs(pins[i].row - pins[j].row);
        totalDist += dist;
      }
    }
    score += totalDist / (pins.length - 1); // Average distance
  }
  return score;
}

// Try different rotations for a component
function tryRotations(comp, allComps, cols, rows) {
  let bestRotation = 0;
  let bestScore = Infinity;
  
  for (let rot = 0; rot < 4; rot++) {
    // Rotate component 90 degrees
    const rotated = {
      ...comp,
      w: rot % 2 === 0 ? comp.w : comp.h,
      h: rot % 2 === 0 ? comp.h : comp.w,
      pins: comp.pins.map(p => ({
        ...p,
        dCol: rot % 2 === 0 ? p.dCol : p.dRow,
        dRow: rot % 2 === 0 ? p.dRow : comp.w - 1 - p.dCol
      }))
    };
    
    // Test placement at current position
    const testComps = allComps.map(c => c === comp ? rotated : c);
    const score = netConnectionScore(testComps);
    
    if (score < bestScore) {
      bestScore = score;
      bestRotation = rot;
    }
  }
  
  return bestRotation;
}

export async function anneal(components, cols, rows, onProgress) {
  if (components.length === 0) return;

  function yld() { return new Promise(r => setTimeout(r, 0)); }

  let T = 100, Tmin = 0.5, alpha = 0.94;
  let cur = mstWirelength(components);
  const totalSteps = Math.ceil(Math.log(Tmin / T) / Math.log(alpha));
  let step = 0;

  while (T > Tmin) {
    const MOVES_PER_STEP = 8;
    for (let m = 0; m < MOVES_PER_STEP; m++) {
      const c = components[Math.floor(Math.random() * components.length)];
      const oldOx = c.ox, oldOy = c.oy;
      
      // Try rotation optimization first
      if (Math.random() < 0.3) {
        const bestRot = tryRotations(c, components, cols, rows);
        if (bestRot !== 0) {
          // Apply rotation
          const tempW = c.w;
          c.w = bestRot % 2 === 0 ? c.h : c.w;
          c.h = bestRot % 2 === 0 ? c.w : tempW;
          
          c.pins.forEach(p => {
            const tempDCol = p.dCol;
            const tempDRow = p.dRow;
            p.dCol = bestRot % 2 === 0 ? tempDCol : tempDRow;
            p.dRow = bestRot % 2 === 0 ? tempDRow : c.w - 1 - tempDCol;
          });
        }
      }
      
      const mag = Math.ceil(Math.random() * 4);
      const [dox, doy] = [[0,mag],[0,-mag],[mag,0],[-mag,0]][Math.floor(Math.random()*4)];
      const nox = Math.max(1, Math.min(cols - c.w - 1, c.ox + dox));
      const noy = Math.max(1, Math.min(rows - c.h - 1, c.oy + doy));
      moveComp(c, nox, noy);
      if (anyOverlap(c, components)) { moveComp(c, oldOx, oldOy); continue; }
      
      const ns = mstWirelength(components);
      const dE = ns - cur;
      
      // Accept moves that improve net connections more
      const netScore = netConnectionScore(components);
      const netImprovement = netScore < dE ? -1 : 1;
      const acceptProb = Math.exp(-dE / T) * (netImprovement > 0 ? 1.2 : 1.0);
      
      if (dE < 0 || Math.random() < acceptProb) { cur = ns; }
      else { moveComp(c, oldOx, oldOy); }
    }
    T *= alpha; step++;
    onProgress(step / totalSteps, `SA T=${T.toFixed(1)} WL=${cur}`);
    if (step % 5 === 0) await yld();
  }
}
