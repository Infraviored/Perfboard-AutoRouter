import { Grid } from './grid.js';

export function getAllNets(components) {
  const m = {};
  components.forEach(c => c.pins.forEach(p => {
    if (p.net) {
      if (!m[p.net]) m[p.net] = [];
      m[p.net].push({ col: p.col, row: p.row, net: p.net });
    }
  }));
  return m;
}

function getMSTEstimate(pins) {
  let len = 0;
  for (let i = 1; i < pins.length; i++) {
    len += Math.abs(pins[i].col - pins[0].col) + Math.abs(pins[i].row - pins[0].row);
  }
  return len;
}

export async function route(components, cols, rows, onProgress) {
  const wires = [];
  const grid = new Grid(cols, rows);
  components.forEach(c => grid.registerComp(c));

  const nets = getAllNets(components);
  // ROUTE SHORTER NETS FIRST to keep the board open
  const netKeys = Object.keys(nets)
    .filter(n => nets[n].length >= 2)
    .sort((a, b) => getMSTEstimate(nets[a]) - getMSTEstimate(nets[b]));

  let done = 0;
  const totalConns = netKeys.reduce((s, n) => s + nets[n].length - 1, 0);

  for (const netName of netKeys) {
    const pins = [...nets[netName]];
    const routedIndices = new Set();
    const first = pins.shift();
    routedIndices.add(grid.idx(first.col, first.row));

    while (pins.length > 0) {
      let bestPath = null, bestPinIdx = -1;

      for (let i = 0; i < pins.length; i++) {
        const path = grid.astarMultiSource(routedIndices, pins[i].col, pins[i].row);
        if (path && (!bestPath || path.length < bestPath.length)) {
          bestPath = path;
          bestPinIdx = i;
        }
      }

      if (bestPath) {
        wires.push({ path: bestPath, net: netName, failed: false });
        grid.markWire(bestPath);
        bestPath.forEach(pt => routedIndices.add(grid.idx(pt.col, pt.row)));
        pins.splice(bestPinIdx, 1);
      } else {
        const failPin = pins.shift();
        wires.push({ path: [first, failPin], net: netName, failed: true });
      }
      done++;
      onProgress(done / totalConns, `Routing ${netName}...`);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  return wires;
}
