// grid.js — Board grid, hole blacklist, A* router
export const BLOCKED_COMP  = 1;
export const BLOCKED_PIN   = 2;
export const BLOCKED_WIRE  = 4;

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
  isFree(c, r)      { return this.inBounds(c,r) && this.cells[this.idx(c,r)] === 0; }

  canTerminate(c, r) {
    if (!this.inBounds(c,r)) return false;
    const v = this.cells[this.idx(c,r)];
    if (v & BLOCKED_WIRE) return false;
    if ((v & BLOCKED_COMP) && !(v & BLOCKED_PIN)) return false;
    return true;
  }

  registerComp(comp) {
    for (let dc = 0; dc < comp.w; dc++) {
      for (let dr = 0; dr < comp.h; dr++) {
        this.set(comp.ox + dc, comp.oy + dr, BLOCKED_COMP);
      }
    }
    comp.pins.forEach(p => this.set(p.col, p.row, BLOCKED_PIN));
  }

  // Multi-source A* for Branching (T-junctions)
  astarMultiSource(startIndices, ec, er) {
    const md = (c, r) => Math.abs(c - ec) + Math.abs(r - er);
    const key = (c, r) => r * this.cols + c;
    
    const open = [];
    const gScore = new Float32Array(this.cols * this.rows).fill(1e6);
    const parent = new Int32Array(this.cols * this.rows).fill(-1);

    for (const idx of startIndices) {
      gScore[idx] = 0;
      open.push({ c: idx % this.cols, r: Math.floor(idx / this.cols), f: md(idx % this.cols, Math.floor(idx / this.cols)) });
    }

    let iters = 0;
    while (open.length > 0 && iters++ < this.cols * this.rows * 4) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const { c, r } = open.splice(bi, 1)[0];

      if (c === ec && r === er) {
        const path = [];
        let k = key(ec, er);
        while (k !== -1 && !startIndices.has(k)) {
          path.unshift({ col: k % this.cols, row: Math.floor(k / this.cols) });
          k = parent[k];
        }
        if (k !== -1) path.unshift({ col: k % this.cols, row: Math.floor(k / this.cols) });
        return path;
      }

      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nc = c + dc, nr = r + dr;
        if (!this.inBounds(nc, nr)) continue;
        const nk = key(nc, nr);
        const isTarget = (nc === ec && nr === er);

        if (!isTarget && !this.isFree(nc, nr)) continue;
        if (isTarget && !this.canTerminate(nc, nr)) continue;

        // BENDING PENALTY: $1.5$ extra cost for turns
        let moveCost = 1.0;
        if (parent[key(c,r)] !== -1) {
          const pk = parent[key(c,r)];
          if ((c - (pk % this.cols)) !== dc || (r - Math.floor(pk / this.cols)) !== dr) {
            moveCost += 1.5;
          }
        }

        // ESCAPE BUFFER: $2.0$ extra cost to avoid "squeezing" other pins
        if (!isTarget && this.hasNearbyPin(nc, nr, ec, er)) moveCost += 2.0;

        const ng = gScore[key(c, r)] + moveCost;
        if (ng < gScore[nk]) {
          gScore[nk] = ng;
          parent[nk] = key(c, r);
          open.push({ c: nc, r: nr, f: ng + md(nc, nr) });
        }
      }
    }
    
    // Pathfinding timeout warning
    console.warn(`Path TIMEOUT: to (${ec},${er}) explored ${iters} nodes.`);
    return null;
  }

  hasNearbyPin(c, r, targetC, targetR) {
    for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nc = c+dc, nr = r+dr;
      if (nc === targetC && nr === targetR) continue;
      if (this.has(nc, nr, BLOCKED_PIN)) return true;
    }
    return false;
  }

  markWire(path) {
    path.slice(1, -1).forEach(pt => this.set(pt.col, pt.row, BLOCKED_WIRE));
  }

  // Clean Debug Print (Reduces spam)
  debugPrint() {
    const chars = { 1: 'C', 2: 'P', 4: 'W', 0: '.' };
    let map = "";
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const val = this.cells[this.idx(c, r)];
        map += chars[val] || '?';
      }
      map += "\n";
    }
    // Log as one block to prevent console throttle
    console.log("%c" + map, "font-family: monospace; color: #b87333;");
  }
}
