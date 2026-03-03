// grid.js
export const BLOCKED_COMP = 1;
export const BLOCKED_PIN = 2;
export const BLOCKED_WIRE = 4;

// High-performance Binary Min-Heap for A*
class MinHeap {
  constructor(maxSize) {
    this.keys = new Int32Array(maxSize);
    this.fs = new Float32Array(maxSize);
    this.length = 0;
  }
  push(key, f) {
    const i = this.length++;
    this.keys[i] = key;
    this.fs[i] = f;
    this.up(i);
  }
  pop() {
    if (this.length === 0) return -1;
    const topKey = this.keys[0];
    this.length--;
    if (this.length > 0) {
      this.keys[0] = this.keys[this.length];
      this.fs[0] = this.fs[this.length];
      this.down(0);
    }
    return topKey;
  }
  up(i) {
    const k = this.keys[i];
    const f = this.fs[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f >= this.fs[p]) break;
      this.keys[i] = this.keys[p];
      this.fs[i] = this.fs[p];
      i = p;
    }
    this.keys[i] = k;
    this.fs[i] = f;
  }
  down(i) {
    const len = this.length;
    const k = this.keys[i];
    const f = this.fs[i];
    while ((i << 1) + 1 < len) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let min = (right < len && this.fs[right] < this.fs[left]) ? right : left;
      if (f <= this.fs[min]) break;
      this.keys[i] = this.keys[min];
      this.fs[i] = this.fs[min];
      i = min;
    }
    this.keys[i] = k;
    this.fs[i] = f;
  }
  clear() {
    this.length = 0;
  }
}

const DCS = new Int32Array([0, 0, 1, -1]);
const DRS = new Int32Array([1, -1, 0, 0]);

export class Grid {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const size = cols * rows;
    this.cells = new Uint8Array(size);
    this.gScore = new Float32Array(size);
    this.parent = new Int32Array(size);
    this.targetMap = new Uint8Array(size);
    // Heap maximum size 8*size to prevent Out-Of-Bounds
    this.open = new MinHeap(size * 4);
  }

  idx(c, r) { return r * this.cols + c; }
  inBounds(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }
  set(c, r, flag) { if (this.inBounds(c, r)) this.cells[this.idx(c, r)] |= flag; }
  clear(c, r, flag) { if (this.inBounds(c, r)) this.cells[this.idx(c, r)] &= ~flag; }
  has(c, r, flag) { return this.inBounds(c, r) && (this.cells[this.idx(c, r)] & flag) !== 0; }
  isFree(c, r) {
    if (!this.inBounds(c, r)) return false;
    return this.cells[this.idx(c, r)] === 0;
  }

  canTerminate(c, r) {
    if (!this.inBounds(c, r)) return false;
    const v = this.cells[this.idx(c, r)];
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
    const size = this.cols * this.rows;

    this.gScore.fill(1e6);
    this.parent.fill(-1);
    this.targetMap.fill(0);
    this.open.clear(); // reset heap

    const parent = this.parent;
    const gScore = this.gScore;
    const targetMap = this.targetMap;
    const open = this.open;

    // Convert targets to a fast lookup array
    for (let i = 0; i < targetIndices.length; i++) {
      targetMap[targetIndices[i]] = 1;
    }

    for (const idx of startIndices) {
      gScore[idx] = 0;
      open.push(idx, 0);
    }

    // Pre-calculate target coordinates for fast heuristic
    const targets = [];
    for (let i = 0; i < targetIndices.length; i++) {
      targets.push({
        c: targetIndices[i] % this.cols,
        r: Math.floor(targetIndices[i] / this.cols)
      });
    }

    let iters = 0;

    while (open.length > 0 && iters++ < size * 4) {
      const currKey = open.pop();
      const c = currKey % this.cols;
      const r = Math.floor(currKey / this.cols);

      // Early exit: First target hit wins!
      if (targetMap[currKey] === 1) {
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
        const nc = c + DCS[i];
        const nr = r + DRS[i];
        if (!this.inBounds(nc, nr)) continue;

        const nk = key(nc, nr);
        const isTarget = targetMap[nk] === 1;

        if (!isTarget && !this.isFree(nc, nr)) continue;
        if (isTarget && !this.canTerminate(nc, nr)) continue;

        let moveCost = 1.0;
        if (parent[currKey] !== -1) {
          const pk = parent[currKey];
          if ((c - (pk % this.cols)) !== DCS[i] || (r - Math.floor(pk / this.cols)) !== DRS[i]) {
            moveCost += 1.5; // Turn penalty
          }
        }

        const ng = gScore[currKey] + moveCost;
        if (ng < gScore[nk]) {
          gScore[nk] = ng;
          parent[nk] = currKey;

          let h = 10000;
          for (let ti = 0; ti < targets.length; ti++) {
            const dt = Math.abs(nc - targets[ti].c) + Math.abs(nr - targets[ti].r);
            if (dt < h) h = dt;
          }
          open.push(nk, ng + h * 1.0); // Exact Manhattan A*
        }
      }
    }
    return null;
  }

  markWire(path) {
    path.slice(1, -1).forEach(pt => this.set(pt.col, pt.row, BLOCKED_WIRE));
  }
}
