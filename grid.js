// grid.js
export const BLOCKED_COMP  = 1;
export const BLOCKED_PIN   = 2;
export const BLOCKED_WIRE  = 4;

// High-performance Binary Min-Heap for A*
class MinHeap {
  constructor() { this.data = []; }
  push(val) {
    this.data.push(val);
    this.up(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const bottom = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.down(0);
    }
    return top;
  }
  up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[i].f >= this.data[p].f) break;
      const tmp = this.data[i];
      this.data[i] = this.data[p];
      this.data[p] = tmp;
      i = p;
    }
  }
  down(i) {
    const len = this.data.length;
    while ((i << 1) + 1 < len) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let min = (right < len && this.data[right].f < this.data[left].f) ? right : left;
      if (this.data[i].f <= this.data[min].f) break;
      const tmp = this.data[i];
      this.data[i] = this.data[min];
      this.data[min] = tmp;
      i = min;
    }
  }
  get length() { return this.data.length; }
}

export class Grid {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Uint8Array(cols * rows);
  }

  idx(c, r) { return r * this.cols + c; }
  inBounds(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }
  set(c, r, flag)   { if (this.inBounds(c,r)) this.cells[this.idx(c,r)] |=  flag; }
  clear(c, r, flag) { if (this.inBounds(c,r)) this.cells[this.idx(c,r)] &= ~flag; }
  has(c, r, flag)   { return this.inBounds(c,r) && (this.cells[this.idx(c,r)] & flag) !== 0; }
  isFree(c, r) { 
    if (!this.inBounds(c,r)) return false; 
    return this.cells[this.idx(c,r)] === 0;
  }

  canTerminate(c, r) {
    if (!this.inBounds(c,r)) return false;
    const v = this.cells[this.idx(c,r)];
    if (v & BLOCKED_WIRE) return false;
    // We can terminate on pins, but not on plain component body.
    return !((v & BLOCKED_COMP) && !(v & BLOCKED_PIN));
  }

  registerComp(comp) {
    if (!comp.routeUnder) {
      for (let dc = 0; dc < comp.w; dc++) {
        for (let dr = 0; dr < comp.h; dr++) {
          this.set(comp.ox + dc, comp.oy + dr, BLOCKED_COMP);
        }
      }
    }
    comp.pins.forEach(p => this.set(p.col, p.row, BLOCKED_PIN));
  }

  // Optimized Multi-Target A*
  astarMultiTarget(startIndices, targetIndices) {
    const key = (c, r) => r * this.cols + c;
    const open = new MinHeap();
    const gScore = new Float32Array(this.cols * this.rows).fill(1e6);
    const parent = new Int32Array(this.cols * this.rows).fill(-1);
    
    // Convert targets to a fast lookup Set
    const targets = new Set(targetIndices);

    for (const idx of startIndices) {
      gScore[idx] = 0;
      open.push({ c: idx % this.cols, r: Math.floor(idx / this.cols), f: 0 });
    }

    // Unrolled directional arrays to prevent GC pauses
    const dcs = [0, 0, 1, -1];
    const drs = [1, -1, 0, 0];
    let iters = 0;

    while (open.length > 0 && iters++ < this.cols * this.rows * 4) {
      const { c, r } = open.pop();
      const currKey = key(c, r);

      // Early exit: First target hit wins!
      if (targets.has(currKey)) {
        const path = [];
        let k = currKey;
        while (k !== -1 && !startIndices.has(k)) {
          path.unshift({ col: k % this.cols, row: Math.floor(k / this.cols) });
          k = parent[k];
        }
        if (k !== -1) path.unshift({ col: k % this.cols, row: Math.floor(k / this.cols) });
        
        // Return path and which target we successfully hit
        return { path, hitTargetIdx: currKey };
      }

      for (let i = 0; i < 4; i++) {
        const nc = c + dcs[i];
        const nr = r + drs[i];
        if (!this.inBounds(nc, nr)) continue;
        
        const nk = key(nc, nr);
        const isTarget = targets.has(nk);

        if (!isTarget && !this.isFree(nc, nr)) continue;
        if (isTarget && !this.canTerminate(nc, nr)) continue;

        let moveCost = 1.0;
        if (parent[currKey] !== -1) {
          const pk = parent[currKey];
          if ((c - (pk % this.cols)) !== dcs[i] || (r - Math.floor(pk / this.cols)) !== drs[i]) {
            moveCost += 1.5; // Turn penalty
          }
        }

        const ng = gScore[currKey] + moveCost;
        if (ng < gScore[nk]) {
          gScore[nk] = ng;
          parent[nk] = currKey;
          open.push({ c: nc, r: nr, f: ng }); // Can add heuristic (Manhattan to nearest target) if needed
        }
      }
    }
    return null;
  }

  markWire(path) {
    path.slice(1, -1).forEach(pt => this.set(pt.col, pt.row, BLOCKED_WIRE));
  }
}
