// grid.js — Board grid, hole blacklist, A* router
export const BLOCKED_COMP  = 1;   // component body cell (wire may NOT pass)
export const BLOCKED_PIN   = 2;   // component pin hole  (wire may START/END only)
export const BLOCKED_WIRE  = 4;   // wire occupying this hole

export class Grid {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    // Each cell: 0 = free, bitmask of BLOCKED_* flags
    this.cells = new Uint8Array(cols * rows);
  }

  idx(c, r) { return r * this.cols + c; }
  inBounds(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }

  set(c, r, flag)   { if (this.inBounds(c,r)) this.cells[this.idx(c,r)] |=  flag; }
  clear(c, r, flag) { if (this.inBounds(c,r)) this.cells[this.idx(c,r)] &= ~flag; }
  has(c, r, flag)   { return this.inBounds(c,r) && (this.cells[this.idx(c,r)] & flag) !== 0; }
  isFree(c, r)      { return this.inBounds(c,r) && this.cells[this.idx(c,r)] === 0; }

  // Can a wire PASS THROUGH this cell (not start/end)?
  canRoute(c, r) {
    if (!this.inBounds(c,r)) return false;
    const v = this.cells[this.idx(c,r)];
    // Block if component body OR existing wire OR pin (pins block pass-through)
    return v === 0;
  }

  // Can a wire TERMINATE at this cell (pin or free)?
  canTerminate(c, r) {
    if (!this.inBounds(c,r)) return false;
    const v = this.cells[this.idx(c,r)];
    // Allow: free or is a pin. Disallow: comp body (non-pin), wire
    if (v & BLOCKED_WIRE) return false;
    if ((v & BLOCKED_COMP) && !(v & BLOCKED_PIN)) return false;
    return true;
  }

  cloneEmpty() { return new Grid(this.cols, this.rows); }

  // Register a component onto the grid
  registerComp(comp) {
    for (let dc = 0; dc < comp.w; dc++) {
      for (let dr = 0; dr < comp.h; dr++) {
        this.set(comp.ox + dc, comp.oy + dr, BLOCKED_COMP);
      }
    }
    comp.pins.forEach(p => {
      this.set(p.col, p.row, BLOCKED_PIN);
    });
  }

  unregisterComp(comp) {
    for (let dc = 0; dc < comp.w; dc++) {
      for (let dr = 0; dr < comp.h; dr++) {
        this.clear(comp.ox + dc, comp.oy + dr, BLOCKED_COMP);
      }
    }
    comp.pins.forEach(p => {
      this.clear(p.col, p.row, BLOCKED_PIN);
      this.clear(p.col, p.row, BLOCKED_COMP);
    });
  }

  // A* from (sc,sr) to (ec,er). Returns path [{col,row}] or null.
  astar(sc, sr, ec, er) {
    if (sc === ec && sr === er) return [{col:sc, row:sr}];

    // Validate start and end are reachable
    if (!this.canTerminate(sc, sr) && !this.has(sc, sr, BLOCKED_PIN)) return null;
    if (!this.canTerminate(ec, er) && !this.has(ec, er, BLOCKED_PIN)) return null;

    const md = (c, r) => Math.abs(c - ec) + Math.abs(r - er);
    const key = (c, r) => r * this.cols + c;
    const open = [];
    const gScore = new Int16Array(this.cols * this.rows).fill(32767);
    const parent = new Int32Array(this.cols * this.rows).fill(-1);

    const sk = key(sc, sr);
    gScore[sk] = 0;
    open.push({ c: sc, r: sr, f: md(sc, sr) });

    let iters = 0;
    const maxIters = this.cols * this.rows * 3;

    while (open.length > 0 && iters++ < maxIters) {
      // pop lowest f
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      const { c, r } = cur;

      if (c === ec && r === er) {
        // reconstruct
        const path = [];
        let k = key(ec, er);
        while (k !== -1) {
          const pc = k % this.cols, pr = Math.floor(k / this.cols);
          path.unshift({ col: pc, row: pr });
          k = parent[k];
        }
        return path;
      }

      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nc = c + dc, nr = r + dr;
        if (!this.inBounds(nc, nr)) continue;
        const nk = key(nc, nr);
        const isEnd = (nc === ec && nr === er);

        // Passability check
        if (!isEnd && !this.canRoute(nc, nr)) continue;
        if (isEnd && !this.canTerminate(nc, nr) && !this.has(nc, nr, BLOCKED_PIN)) continue;

        const ng = gScore[key(c, r)] + 1;
        if (ng < gScore[nk]) {
          gScore[nk] = ng;
          parent[nk] = key(c, r);
          open.push({ c: nc, r: nr, f: ng + md(nc, nr) });
        }
      }
    }
    return null; // no path
  }

  // Mark wire intermediate cells as BLOCKED_WIRE (not start/end pins)
  markWire(path) {
    path.slice(1, -1).forEach(pt => {
      this.set(pt.col, pt.row, BLOCKED_WIRE);
    });
  }
}
