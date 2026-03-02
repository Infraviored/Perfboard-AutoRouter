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
    if (p.net) {  // Only process pins that have nets
      if (!m[p.net]) m[p.net] = [];
      m[p.net].push({ col: p.col, row: p.row, net: p.net });
    }
  }));
  return m;
}

function yld() { return new Promise(r => setTimeout(r, 0)); }

export async function route(components, cols, rows, onProgress) {
  const wires = [];
  const grid = new Grid(cols, rows);
  components.forEach(c => grid.registerComp(c));

  const nets = getAllNets(components);
  
  // SORTING LOGIC: Shortest MST length nets first
  const netKeys = Object.keys(nets)
    .filter(n => nets[n].length >= 2)
    .sort((a, b) => {
        const lenA = getMSTLength(nets[a]);
        const lenB = getMSTLength(nets[b]);
        return lenA - lenB;
    });

  let done = 0;
  const totalConns = netKeys.reduce((s, n) => s + nets[n].length - 1, 0);

  for (const netName of netKeys) {
    const pins = [...nets[netName]];
    const routedIndices = new Set();
    
    // Start the tree with the first pin
    const firstPin = pins.shift();
    routedIndices.add(grid.idx(firstPin.col, firstPin.row));

    while (pins.length > 0) {
      let bestPath = null;
      let bestPinIdx = -1;

      // Find the shortest path from ANY point currently in the net's tree 
      // to ANY of the remaining pins
      for (let i = 0; i < pins.length; i++) {
        const target = pins[i];
        // We use a multi-source A* search
        const path = grid.astarMultiSource(routedIndices, target.col, target.row);
        
        if (path && (!bestPath || path.length < bestPath.length)) {
          bestPath = path;
          bestPinIdx = i;
        }
      }

      if (bestPath) {
        wires.push({ path: bestPath, net: netName, failed: false });
        grid.markWire(bestPath);
        // Add new path to the tree of valid connection points for this net
        bestPath.forEach(pt => routedIndices.add(grid.idx(pt.col, pt.row)));
        pins.splice(bestPinIdx, 1);
      } else {
        // Fallback: draw a fail line for the remaining pins
        const failPin = pins.shift();
        wires.push({ path: [firstPin, failPin], net: netName, failed: true });
      }

      done++;
      onProgress(done / totalConns, `Routing ${netName}...`);
      await yld();
    }
  }
  return wires;
}

function getMSTLength(pins) {
    // Simple Manhattan distance sum for priority estimation
    let len = 0;
    for(let i=1; i<pins.length; i++) {
        len += Math.abs(pins[i].col - pins[0].col) + Math.abs(pins[i].row - pins[0].row);
    }
    return len;
}
