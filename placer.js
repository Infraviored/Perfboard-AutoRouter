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
      let bD = Infinity, bJ = -1;
      conn.forEach(i => {
        pins.forEach((p, j) => {
          if (conn.has(j)) return;
          const d = Math.abs(pins[i].col - p.col) + Math.abs(pins[i].row - p.row);
          if (d < bD) { bD = d; bJ = j; }
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
      const mag = Math.ceil(Math.random() * 4);
      const [dox, doy] = [[0,mag],[0,-mag],[mag,0],[-mag,0]][Math.floor(Math.random()*4)];
      const nox = Math.max(1, Math.min(cols - c.w - 1, c.ox + dox));
      const noy = Math.max(1, Math.min(rows - c.h - 1, c.oy + doy));
      moveComp(c, nox, noy);
      if (anyOverlap(c, components)) { moveComp(c, oldOx, oldOy); continue; }
      const ns = mstWirelength(components);
      const dE = ns - cur;
      if (dE < 0 || Math.random() < Math.exp(-dE / T)) { cur = ns; }
      else { moveComp(c, oldOx, oldOy); }
    }
    T *= alpha; step++;
    onProgress(step / totalSteps, `SA T=${T.toFixed(1)} WL=${cur}`);
    if (step % 5 === 0) await yld();
  }
}
