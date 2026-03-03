
function getAllNets(components) {
  const m = {};
  components.forEach(c => c.pins.forEach(p => {
    if (p.net) {
      if (!m[p.net]) m[p.net] = [];
      m[p.net].push({ col: p.col, row: p.row, net: p.net });
    }
  }));
  return Object.entries(m).map(([net, pins]) => ({ net, pins }));
}

async function route(components, cols, rows, onProg, debug = false, shouldCancel = null) {
  const nets = getAllNets(components);
  const grid = new Grid(cols, rows);

  // Block holes occupied by any component's body (not pins)
  components.forEach(c => {
    for (let dr = 0; dr < c.h; dr++) {
      for (let dc = 0; dc < c.w; dc++) {
        // If the component allows routing under it, only block pins
        if (c.routeUnder) continue;
        grid.set(c.ox + dc, c.oy + dr, BLOCKED_COMP);
      }
    }
  });

  // Re-ensure pins of the components themselves are NOT blocked (since they are routing targets/sources)
  components.forEach(c => {
    c.pins.forEach(p => grid.clear(p.col, p.row, BLOCKED_COMP));
  });

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
