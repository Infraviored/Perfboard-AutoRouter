// router.js — Single-layer MST router with strict shared hole blacklist
import { Grid } from './grid.js';

function mstEdges(pins) {
  if (pins.length < 2) return [];
  const conn = new Set([0]);
  const edges = [];
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
    edges.push([pins[bI], pins[bJ]]);
    conn.add(bJ);
  }
  return edges;
}

export function getAllNets(components) {
  const m = {};
  components.forEach(c => c.pins.forEach(p => {
    if (!m[p.net]) m[p.net] = [];
    m[p.net].push({ col: p.col, row: p.row, net: p.net });
  }));
  return m;
}

function yld() { return new Promise(r => setTimeout(r, 0)); }

export async function route(components, cols, rows, onProgress) {
  const wires = [];

  // ONE shared grid — every component body and every routed wire
  // permanently blocks holes. This is the only layer.
  const grid = new Grid(cols, rows);
  components.forEach(c => grid.registerComp(c));

  const nets = getAllNets(components);
  const netKeys = Object.keys(nets).filter(n => nets[n].length >= 2);
  const totalConns = netKeys.reduce((s, n) => s + nets[n].length - 1, 0);
  if (!totalConns) return wires;

  let done = 0;

  for (const net of netKeys) {
    const edges = mstEdges(nets[net]);
    for (const [a, b] of edges) {
      const path = grid.astar(a.col, a.row, b.col, b.row);

      if (path && path.length > 0) {
        wires.push({ path, net, failed: false });
        // Permanently block intermediate holes — they are now occupied
        grid.markWire(path);
      } else {
        // Genuinely unroutable given current placement.
        // Do NOT draw any line — there is no physical path.
        wires.push({
          path: [a, b], net, failed: true,
          reason: `No path: net ${net} (${a.col},${a.row})→(${b.col},${b.row})`
        });
      }

      done++;
      onProgress(done / totalConns, `Net ${net} (${done}/${totalConns})`);
      if (done % 3 === 0) await yld();
    }
  }

  return wires;
}
