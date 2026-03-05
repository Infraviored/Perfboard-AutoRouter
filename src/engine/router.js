import { Grid } from './grid.js';

export const getAllNets = function (components) {
  const m = {};
  components.forEach(c => c.pins.forEach(p => {
    if (p.net) {
      if (!m[p.net]) m[p.net] = [];
      m[p.net].push({ col: p.col, row: p.row, net: p.net });
    }
  }));
  return Object.entries(m).map(([net, pins]) => ({ net, pins }));
}
export const route = async function (components, cols, rows, onProg, shouldCancel = null) {
  const nets = getAllNets(components);

  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  if (components.length > 0) {
    components.forEach(c => {
      minCol = Math.min(minCol, c.ox); maxCol = Math.max(maxCol, c.ox + c.w - 1);
      minRow = Math.min(minRow, c.oy); maxRow = Math.max(maxRow, c.oy + c.h - 1);
    });
  } else {
    minCol = 0; maxCol = cols || 50; minRow = 0; maxRow = rows || 50;
  }

  const pad = 15;
  const gridMinC = minCol - pad;
  const gridMinR = minRow - pad;
  const gridCols = (maxCol - minCol + 1) + pad * 2;
  const gridRows = (maxRow - minRow + 1) + pad * 2;

  const grid = new Grid(gridCols, gridRows, gridMinC, gridMinR);
  components.forEach(c => grid.registerComp(c));

  const wires = [];
  for (let netIdx = 0; netIdx < nets.length; netIdx++) {
    if (shouldCancel && shouldCancel()) break;
    const net = nets[netIdx];
    if (onProg) onProg((netIdx + 1) / nets.length, net.net);

    // We use the multi-target A* logic: 
    // 1. Start with first pin
    // 2. Target indices are the rest of the pins
    // 3. Repeat until all pins in net are connected

    const pins = [...net.pins];
    const routedIndices = new Set();
    const first = pins.shift();
    routedIndices.add(grid.idx(first.col, first.row));

    while (pins.length > 0) {
      if (shouldCancel && shouldCancel()) break;
      const targetIndices = pins.map(p => grid.idx(p.col, p.row));

      // Grid.astarMultiTarget(startIndices, targetIndices)
      const result = grid.astarMultiTarget(routedIndices, targetIndices);

      if (result && result.path) {
        wires.push({ net: net.net, path: result.path, failed: false });
        // Mark the path cells as blocked for other nets
        grid.markWire(result.path);
        // Add all path nodes to routed indices for this net
        result.path.forEach(pt => routedIndices.add(grid.idx(pt.col, pt.row)));
        // Remove the pin we hit from the unrouted list
        const hitIdx = pins.findIndex(p => grid.idx(p.col, p.row) === result.hitTargetIdx);
        if (hitIdx !== -1) pins.splice(hitIdx, 1);
      } else {
        // Failed to route to any of the remaining pins
        const failPin = pins.shift();
        wires.push({ net: net.net, path: [first, failPin], failed: true });
      }
    }

    if (netIdx % 2 === 1) await new Promise(r => setTimeout(r, 0));
  }
  return wires;
}

/**
 * Incremental re-route: only rips up and re-routes nets affected by moved components.
 * Everything else is kept intact, producing a massive speedup over full route().
 *
 * @param {Array} components  - All components (in their NEW positions)
 * @param {Array} wires       - Wires from BEFORE the move (corresponding to old positions)
 * @param {Array|Object} movedComps - Component(s) that changed position/rotation
 * @returns {{ success: boolean, wires: Array }}
 */
export function incrementalReroute(components, wires, movedComps) {
  const moved = Array.isArray(movedComps) ? movedComps : [movedComps];

  // 1. Collect nets directly connected to any moved component
  const affectedNets = new Set();
  for (const mc of moved) {
    for (const p of mc.pins) {
      if (p.net) affectedNets.add(p.net);
    }
  }

  // 2. Find nets whose existing wire paths now intersect a moved component's footprint
  const displacedNets = new Set();
  for (const w of wires) {
    if (w.failed || affectedNets.has(w.net)) continue;
    for (const mc of moved) {
      if (mc.routeUnder) continue;
      const ox = mc.ox, oy = mc.oy, ox2 = mc.ox + mc.w, oy2 = mc.oy + mc.h;
      if (w.path && w.path.some(pt =>
        pt.col >= ox && pt.col < ox2 &&
        pt.row >= oy && pt.row < oy2
      )) {
        displacedNets.add(w.net);
        break;
      }
    }
  }

  // Merge all nets that need rerouting
  const netsToReroute = new Set([...affectedNets, ...displacedNets]);

  if (netsToReroute.size === 0) {
    return { success: true, wires: [...wires] };
  }

  // 3. Keep unaffected wires
  const keptWires = wires.filter(w => !netsToReroute.has(w.net));

  // 4. Build grid
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const c of components) {
    minCol = Math.min(minCol, c.ox);
    maxCol = Math.max(maxCol, c.ox + c.w - 1);
    minRow = Math.min(minRow, c.oy);
    maxRow = Math.max(maxRow, c.oy + c.h - 1);
  }

  const pad = 15;
  const gridMinC = minCol - pad;
  const gridMinR = minRow - pad;
  const gridCols = (maxCol - minCol + 1) + pad * 2;
  const gridRows = (maxRow - minRow + 1) + pad * 2;

  const grid = new Grid(gridCols, gridRows, gridMinC, gridMinR);
  components.forEach(c => grid.registerComp(c));
  keptWires.forEach(w => { if (!w.failed && w.path) grid.markWire(w.path); });

  // 5. Route only the affected nets
  const allNets = getAllNets(components);
  const toRoute = allNets.filter(n => netsToReroute.has(n.net));

  const newWires = [...keptWires];
  let allRouted = true;

  for (const net of toRoute) {
    const pins = [...net.pins];
    if (pins.length < 2) continue;

    const routedIndices = new Set();
    const first = pins.shift();
    routedIndices.add(grid.idx(first.col, first.row));

    while (pins.length > 0) {
      const targetIndices = pins.map(p => grid.idx(p.col, p.row));
      const result = grid.astarMultiTarget(routedIndices, targetIndices);

      if (result && result.path) {
        newWires.push({ net: net.net, path: result.path, failed: false });
        grid.markWire(result.path);
        result.path.forEach(pt => routedIndices.add(grid.idx(pt.col, pt.row)));
        const hitIdx = pins.findIndex(p => grid.idx(p.col, p.row) === result.hitTargetIdx);
        if (hitIdx !== -1) pins.splice(hitIdx, 1);
      } else {
        const failPin = pins.shift();
        newWires.push({
          net: net.net,
          path: [{ col: first.col, row: first.row }, { col: failPin.col, row: failPin.row }],
          failed: true
        });
        allRouted = false;
      }
    }
  }

  return { success: allRouted, wires: newWires };
}
