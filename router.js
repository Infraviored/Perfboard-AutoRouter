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

function getHPWLEstimate(pins) {
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  pins.forEach(p => {
    if (p.col < minC) minC = p.col;
    if (p.col > maxC) maxC = p.col;
    if (p.row < minR) minR = p.row;
    if (p.row > maxR) maxR = p.row;
  });
  return (maxC - minC) + (maxR - minR);
}

export async function route(components, cols, rows, onProgress, allowRouteUnder = false, shouldCancel = null) {
  const wires = [];
  const grid = new Grid(cols, rows);
  components.forEach(c => grid.registerComp(c));

  const nets = getAllNets(components);
  // Route shorter nets first (HPWL is faster to estimate than MST here too)
  const netKeys = Object.keys(nets)
    .filter(n => nets[n].length >= 2)
    .sort((a, b) => getHPWLEstimate(nets[a]) - getHPWLEstimate(nets[b]));

  let done = 0;
  const totalConns = netKeys.reduce((s, n) => s + nets[n].length - 1, 0);

  for (const netName of netKeys) {
    let pins = [...nets[netName]];
    const routedIndices = new Set();

    // Start with the first pin
    const first = pins.shift();
    routedIndices.add(grid.idx(first.col, first.row));

    while (pins.length > 0) {
      if (shouldCancel && shouldCancel()) return wires;

      // Create an array of target indices for the remaining unrouted pins
      const targetIndices = pins.map(p => grid.idx(p.col, p.row));

      // Single A* search finds the closest unrouted pin to the existing network
      const result = grid.astarMultiTarget(routedIndices, targetIndices);

      if (result && result.path) {
        wires.push({ path: result.path, net: netName, failed: false });
        grid.markWire(result.path);
        result.path.forEach(pt => routedIndices.add(grid.idx(pt.col, pt.row)));

        // Remove the pin we successfully hit from the unrouted pool
        pins = pins.filter(p => grid.idx(p.col, p.row) !== result.hitTargetIdx);
      } else {
        // Failed to route to any remaining pin
        const failPin = pins.shift();
        wires.push({ path: [first, failPin], net: netName, failed: true });
      }

      done++;
      onProgress(done / totalConns, `Routing ${netName}...`);
      if (done % 5 === 0) await new Promise(r => setTimeout(r, 0)); // Yield occasionally
    }
  }
  return wires;
}
