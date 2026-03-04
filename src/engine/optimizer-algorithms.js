import { getAllNets, route } from './router.js';
import { moveComp, anyOverlap, rotateComp90InPlace } from './placer.js';
import { saveComps, restoreComps, completion } from './state-utils.js';

export function calculateFootprintArea(components, wires) {
  if (components.length === 0) return { area: 0, bounds: { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 } };

  let minCol = Infinity, maxCol = -Infinity;
  let minRow = Infinity, maxRow = -Infinity;

  components.forEach(c => {
    minCol = Math.min(minCol, c.ox);
    maxCol = Math.max(maxCol, c.ox + c.w - 1);
    minRow = Math.min(minRow, c.oy);
    maxRow = Math.max(maxRow, c.oy + c.h - 1);
  });

  wires.forEach(w => {
    if (w.path) w.path.forEach(pt => {
      minCol = Math.min(minCol, pt.col);
      maxCol = Math.max(maxCol, pt.col);
      minRow = Math.min(minRow, pt.row);
      maxRow = Math.max(maxRow, pt.row);
    });
  });

  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  const area = width * height;

  return { area, bounds: { minCol, maxCol, minRow, maxRow } };
}


export function calculateComponentBounds(components) {
  if (components.length === 0) return { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 };
  let minCol = Infinity, maxCol = -Infinity;
  let minRow = Infinity, maxRow = -Infinity;
  components.forEach(c => {
    minCol = Math.min(minCol, c.ox);
    maxCol = Math.max(maxCol, c.ox + c.w - 1);
    minRow = Math.min(minRow, c.oy);
    maxRow = Math.max(maxRow, c.oy + c.h - 1);
  });
  return { minCol, maxCol, minRow, maxRow };
}


export function footprintBoxMetrics(components, ws) {
  const b0 = calculateComponentBounds(components);
  let minCol = b0.minCol, maxCol = b0.maxCol, minRow = b0.minRow, maxRow = b0.maxRow;
  (ws || []).forEach(w => {
    if (w?.path) w.path.forEach(pt => {
      minCol = Math.min(minCol, pt.col);
      maxCol = Math.max(maxCol, pt.col);
      minRow = Math.min(minRow, pt.row);
      maxRow = Math.max(maxRow, pt.row);
    });
  });
  const width = (maxCol - minCol + 1);
  const height = (maxRow - minRow + 1);
  const area = width * height;
  const perim = (width + height) * 2;
  return { area, perim, width, height, bounds: { minCol, maxCol, minRow, maxRow } };
}

export function wireLengthMetric(ws) {
  return (ws || []).reduce((s, w) => s + (w.failed ? 0 : Math.max(0, (w.path?.length || 0) - 1)), 0);
}

export function scoreState(components, ws) {
  const comp = completion(ws || []);
  const { area, perim, width, height, bounds } = footprintBoxMetrics(components, ws || []);
  const wl = wireLengthMetric(ws || []);
  return { comp, area, perim, wl, width, height, bounds };
}


export function formatScore(s) {
  if (!s) return '';
  return `Comp ${Math.round((s.comp || 0) * 100)}%, Board ${s.width}×${s.height}, area ${s.area} holes², perimeter ${s.perim} holes, WL ${s.wl}`;
}

export function isScoreBetter(a, b) {
  if (a.comp !== b.comp) return a.comp > b.comp;
  if (a.area !== b.area) return a.area < b.area;
  if (a.perim !== b.perim) return a.perim < b.perim;
  if (a.wl !== b.wl) return a.wl < b.wl;
  return false;
}



export function restoreCompRotation(c, orig) {
  c.w = orig.w;
  c.h = orig.h;
  c.pins.forEach((p, idx) => {
    const op = orig.pins && orig.pins[idx];
    if (op) {
      p.dCol = op.dCol;
      p.dRow = op.dRow;
    }
    p.col = c.ox + p.dCol;
    p.row = c.oy + p.dRow;
  });
}


export function findFirstOverlap(moved, comps) {
  const aMinX = moved.ox;
  const aMaxX = moved.ox + moved.w - 1;
  const aMinY = moved.oy;
  const aMaxY = moved.oy + moved.h - 1;
  for (const o of comps) {
    if (o === moved) continue;
    const bMinX = o.ox;
    const bMaxX = o.ox + o.w - 1;
    const bMinY = o.oy;
    const bMaxY = o.oy + o.h - 1;
    const overlap = !(aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY);
    if (overlap) return o;
  }
  return null;
}


export function moveVectorTowardWires(c, components) {
  const nets = getAllNets(components);
  let sumX = 0, sumY = 0, count = 0;
  c.pins.forEach(p => {
    if (!p.net || !nets[p.net]) return;
    nets[p.net].forEach(op => {
      if (op.col >= c.ox && op.col < c.ox + c.w && op.row >= c.oy && op.row < c.oy + c.h) return;
      sumX += op.col;
      sumY += op.row;
      count++;
    });
  });
  if (count === 0) return { dx: 0, dy: 0 };
  const tx = sumX / count;
  const ty = sumY / count;
  const cx = c.ox + c.w / 2;
  const cy = c.oy + c.h / 2;
  const dx = (tx > cx + 0.1) ? 1 : (tx < cx - 0.1) ? -1 : 0;
  const dy = (ty > cy + 0.1) ? 1 : (ty < cy - 0.1) ? -1 : 0;
  return { dx, dy };
}


export function pickShrinkDirsForComp(c, components) {
  const b = calculateComponentBounds(components);
  const dirs = [];
  if (c.ox === b.minCol) dirs.push({ dx: 1, dy: 0 });
  if (c.ox + c.w - 1 === b.maxCol) dirs.push({ dx: -1, dy: 0 });
  if (c.oy === b.minRow) dirs.push({ dx: 0, dy: 1 });
  if (c.oy + c.h - 1 === b.maxRow) dirs.push({ dx: 0, dy: -1 });

  // Bias toward moving along the "wire pull" direction when possible.
  const pull = moveVectorTowardWires(c, components);
  const scoreDir = (d) => d.dx * pull.dx + d.dy * pull.dy;
  dirs.sort((a, b) => scoreDir(b) - scoreDir(a));
  return dirs;
}


export function stateKeyForPlateau(components) {
  const byId = [...components].slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(byId.map(c => ({
    id: c.id,
    ox: c.ox,
    oy: c.oy,
    w: c.w,
    h: c.h,
    pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }))
  })));
}


export async function enumeratePlateauNeighbors(components, wires, baseBox, baseScore, cols, rows, maxPerComp = 80, startCompOffset = 0, visited = null, onProgress = null, maxTotalEvals = 80, gCancelRequested = false) {
  const out = [];
  const bounds = baseBox.bounds;
  const minX = bounds.minCol;
  const maxX = bounds.maxCol;
  const minY = bounds.minRow;
  const maxY = bounds.maxRow;

  const makeKey = (ox, oy) => `${ox},${oy}`;
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const compsSorted = [...components].slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const ncs = compsSorted.length;
  let totalEvals = 0;
  for (let ci = 0; ci < ncs; ci++) {
    const c = compsSorted[(ci + (startCompOffset % Math.max(1, ncs))) % Math.max(1, ncs)];
    const cId = c.id;
    const orig = { ox: c.ox, oy: c.oy, w: c.w, h: c.h, pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
    let emitted = 0;
    for (let rot = 0; rot < 4; rot++) {
      restoreCompRotation(c, orig);
      moveComp(c, orig.ox, orig.oy);
      for (let r = 0; r < rot; r++) rotateComp90InPlace(c);

      const maxOx = maxX - c.w + 1;
      const maxOy = maxY - c.h + 1;
      if (minX > maxOx || minY > maxOy) continue;

      // Instead of scanning all ox/oy (very slow), sample a small set of promising candidates.
      const cand = [];
      const candSeen = new Set();
      const add = (ox, oy) => {
        if (ox < minX || ox > maxOx || oy < minY || oy > maxOy) return;
        const k = makeKey(ox, oy);
        if (candSeen.has(k)) return;
        candSeen.add(k);
        cand.push({ ox, oy });
      };

      // Boundary / shrink-friendly positions.
      add(minX, orig.oy);
      add(maxOx, orig.oy);
      add(orig.ox, minY);
      add(orig.ox, maxOy);
      add(minX, minY);
      add(minX, maxOy);
      add(maxOx, minY);
      add(maxOx, maxOy);

      // One-step and two-step pulls toward wires.
      const pull = moveVectorTowardWires(c, components);
      if (pull.dx || pull.dy) {
        add(orig.ox + pull.dx, orig.oy + pull.dy);
        add(orig.ox + 2 * pull.dx, orig.oy + 2 * pull.dy);
        add(orig.ox + 3 * pull.dx, orig.oy + 3 * pull.dy);
      }

      // Small local neighborhood (helps avoid missing near improvements).
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(orig.ox + dx, orig.oy + dy);

      // A few random samples within the current bbox.
      for (let i = 0; i < 10; i++) {
        const ox = minX + Math.floor(Math.random() * (maxOx - minX + 1));
        const oy = minY + Math.floor(Math.random() * (maxOy - minY + 1));
        add(ox, oy);
      }

      shuffle(cand);

      for (const pos of cand) {
        const ox = pos.ox;
        const oy = pos.oy;
        if (rot === 0 && ox === orig.ox && oy === orig.oy) continue;
        moveComp(c, ox, oy);
        if (anyOverlap(c, components)) continue;

        const preKey = stateKeyForPlateau(components);
        if (visited && visited.has(preKey)) continue;

        totalEvals++;
        if (onProgress) onProgress(totalEvals, maxTotalEvals, `${cId} rot${rot}`);
        if (totalEvals > maxTotalEvals || gCancelRequested) break;

        // Measure changes primarily via area bounds for now to quickly filter candidates.
        const cBounds = footprintBoxMetrics(components, wires);

        if (cBounds.area > baseBox.area) continue;
        if (cBounds.area === baseBox.area && cBounds.perim > baseBox.perim) continue;

        out.push({
          key: preKey,
          comps: saveComps(components),
          score: { comp: baseScore.comp, area: cBounds.area, perim: cBounds.perim, wl: baseScore.wl }, // placeholder, full routing evaluated by caller
          compId: cId,
          desc: `${cId}@(${ox},${oy}) rot${rot}`
        });
        emitted++;
        if (emitted >= maxPerComp) break;
      }

      if (totalEvals > maxTotalEvals) break;
      if (emitted >= maxPerComp) break;
    }
    restoreCompRotation(c, orig);
    moveComp(c, orig.ox, orig.oy);
    if (totalEvals > maxTotalEvals) break;
  }
  return out;
}


export async function postOptimizePlateauTree(components, wires, startBestScore, cols, rows, gCancelRequested = false) {
  const startComps = saveComps(components);
  const startWires = wires;

  let bestScore = startBestScore;
  let bestComps = startComps;
  let bestWires = startWires;

  const startBox = footprintBoxMetrics(components, wires);
  const baseBox = { area: startBox.area, perim: startBox.perim, bounds: startBox.bounds };

  const visited = new Set();
  const q = [];

  const k0 = stateKeyForPlateau(components);
  visited.add(k0);
  q.push({ comps: startComps, wires: startWires, score: startBestScore, box: baseBox, depth: 0, tag: 'start' });

  const MAX_NODES = 220;
  let nodes = 0;

  while (q.length && nodes < MAX_NODES) {
    const cur = q.shift();
    nodes++;

    restoreComps(components, cur.comps);
    let currentWires = cur.wires;

    const shrinkRes = await tryShrinkAlongWires(components, currentWires, cur.score, cols, rows, gCancelRequested);
    if (shrinkRes.improved) {
      const msg = `NEW post-opt shrink @node ${nodes}: ${formatScore(shrinkRes.score)}`;
      console.log(msg);
      bestScore = shrinkRes.score;
      bestComps = saveComps(components);
      bestWires = shrinkRes.wires;
      const nb = footprintBoxMetrics(components, bestWires);
      const newBox = { area: nb.area, perim: nb.perim, bounds: nb.bounds };
      visited.clear();
      q.length = 0;
      const k = stateKeyForPlateau(components);
      visited.add(k);
      q.push({ comps: bestComps, wires: bestWires, score: bestScore, box: newBox, depth: 0, tag: 'after-shrink' });
      continue;
    }

    const neighbors = await enumeratePlateauNeighbors(components, currentWires, cur.box, cur.score, cols, rows, 80, 0, visited, null, 80, gCancelRequested);
    for (const n of neighbors) {
      if (visited.has(n.key)) continue;

      // Compute actual routing metrics before adopting
      restoreComps(components, n.comps);
      const testWires = await route(components, cols, rows, () => { }, () => gCancelRequested);
      n.wires = testWires;
      n.score = scoreState(components, testWires);

      visited.add(n.key);
      const msg = `NEW plateau ${cur.depth + 1}: ${n.desc} | ${formatScore(n.score)}`;
      console.log(msg);
      q.push({ comps: n.comps, wires: n.wires, score: n.score, box: footprintBoxMetrics(components, n.wires), depth: cur.depth + 1, tag: n.desc });
      if (q.length + nodes >= MAX_NODES) break;
    }
  }

  restoreComps(components, bestComps);
  return { improved: isScoreBetter(bestScore, startBestScore), score: bestScore, wires: bestWires };
}


export function tryTranslateWithPush(comp, dx, dy, cols, rows, visited, depth, components) {
  if (dx === 0 && dy === 0) return false;
  if (visited.has(comp)) return false;
  visited.add(comp);

  const prev = { ox: comp.ox, oy: comp.oy };
  const nx = comp.ox + dx;
  const ny = comp.oy + dy;
  if (nx < 0 || ny < 0 || nx + comp.w > cols || ny + comp.h > rows) return false;

  moveComp(comp, nx, ny);
  let blocker = findFirstOverlap(comp, components);
  if (!blocker) return true;

  // Revert this move, attempt to push blocker, then retry.
  moveComp(comp, prev.ox, prev.oy);

  if (depth >= 4) return false;

  if (tryTranslateWithPush(blocker, dx, dy, cols, rows, visited, depth + 1, components)) {
    moveComp(comp, nx, ny);
    blocker = findFirstOverlap(comp, components);
    if (!blocker) return true;
    moveComp(comp, prev.ox, prev.oy);
  }

  if (depth <= 2) {
    const orig = { w: blocker.w, h: blocker.h, pins: blocker.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
    rotateComp90InPlace(blocker);
    const rotOk = blocker.ox >= 0 && blocker.oy >= 0 && blocker.ox + blocker.w <= cols && blocker.oy + blocker.h <= rows && !anyOverlap(blocker, components);
    if (rotOk) {
      moveComp(comp, nx, ny);
      blocker = findFirstOverlap(comp, components);
      if (!blocker) return true;
      moveComp(comp, prev.ox, prev.oy);
    }
    restoreCompRotation(blocker, orig);
  }

  if (depth <= 2) {
    const orig = { w: blocker.w, h: blocker.h, pins: blocker.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
    rotateComp90InPlace(blocker);
    if (!anyOverlap(blocker, components)) {
      if (tryTranslateWithPush(blocker, dx, dy, cols, rows, visited, depth + 1, components)) {
        moveComp(comp, nx, ny);
        blocker = findFirstOverlap(comp, components);
        if (!blocker) return true;
        moveComp(comp, prev.ox, prev.oy);
      }
    }
    restoreCompRotation(blocker, orig);
  }

  return false;
}


export async function tryShrinkAlongWires(components, currentWires, bestScore, cols, rows, gCancelRequested = false) {
  const original = saveComps(components);
  const originalWires = currentWires;

  // Prefer components on the boundary.
  const bounds = calculateComponentBounds(components);
  const onEdge = (c) => c.ox === bounds.minCol || (c.ox + c.w - 1) === bounds.maxCol || c.oy === bounds.minRow || (c.oy + c.h - 1) === bounds.maxRow;
  const candidates = components.filter(onEdge);
  // Try the ones with strongest pull first.
  candidates.sort((a, b) => {
    const pa = moveVectorTowardWires(a, components);
    const pb = moveVectorTowardWires(b, components);
    return (Math.abs(pb.dx) + Math.abs(pb.dy)) - (Math.abs(pa.dx) + Math.abs(pa.dy));
  });

  for (const c of candidates) {
    const dirs = pickShrinkDirsForComp(c, components);
    for (const d of dirs) {
      restoreComps(components, original);

      const visited = new Set();
      const ok = tryTranslateWithPush(c, d.dx, d.dy, cols, rows, visited, 0, components);
      if (!ok) continue;
      if (anyOverlap(c, components)) continue;

      const testWires = await route(components, cols, rows, () => { }, () => gCancelRequested);
      const testScore = scoreState(components, testWires);

      // Only allow moves that keep routing completion and improve score.
      if (testScore.comp < bestScore.comp) continue;
      if (!isScoreBetter(testScore, bestScore)) continue;

      return { improved: true, score: testScore, wires: testWires };
    }
  }

  restoreComps(components, original);
  return { improved: false, score: bestScore, wires: originalWires };
}


export async function explorePlateauStates(components, currentWires, bestScore, cols, rows, gCancelRequested = false) {
  const baseBounds = calculateComponentBounds(components);
  const baseW = (baseBounds.maxCol - baseBounds.minCol + 1);
  const baseH = (baseBounds.maxRow - baseBounds.minRow + 1);
  const baseArea = baseW * baseH;
  const basePerim = (baseW + baseH) * 2;

  if (baseArea > 700) return { improved: false, score: bestScore, wires: currentWires };

  const original = saveComps(components);
  const originalWires = currentWires;

  const bounds = baseBounds;
  const candidates = [...components];

  let bestLocalScore = bestScore;
  let bestLocalComps = null;
  let bestLocalWires = null;

  for (const c of candidates) {
    const cOrig = { w: c.w, h: c.h, pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })), ox: c.ox, oy: c.oy };

    for (let rot = 0; rot < 4; rot++) {
      restoreComps(components, original);

      const cc = components.find(x => x.id === c.id);
      const rotOrig = { w: cc.w, h: cc.h, pins: cc.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow })) };
      for (let r = 0; r < rot; r++) rotateComp90InPlace(cc);

      const minOx = bounds.minCol;
      const maxOx = bounds.maxCol - cc.w + 1;
      const minOy = bounds.minRow;
      const maxOy = bounds.maxRow - cc.h + 1;
      if (minOx > maxOx || minOy > maxOy) {
        restoreCompRotation(cc, rotOrig);
        continue;
      }

      for (let ox = minOx; ox <= maxOx; ox++) {
        for (let oy = minOy; oy <= maxOy; oy++) {
          if (gCancelRequested) return { improved: false, score: bestLocalScore, wires: bestLocalWires || originalWires };
          if (rot === 0 && ox === cOrig.ox && oy === cOrig.oy) continue;

          moveComp(cc, ox, oy);
          if (anyOverlap(cc, components)) continue;

          const b2 = calculateComponentBounds(components);
          const w2 = (b2.maxCol - b2.minCol + 1);
          const h2 = (b2.maxRow - b2.minRow + 1);
          const area2 = w2 * h2;
          const per2 = (w2 + h2) * 2;
          if (area2 > baseArea) continue;
          if (area2 === baseArea && per2 > basePerim) continue;

          const testScore = { comp: bestScore.comp, area: area2, perim: per2, wl: bestScore.wl, width: w2, height: h2, bounds: b2 };

          if (isScoreBetter(testScore, bestLocalScore) || (
            testScore.comp === bestLocalScore.comp &&
            testScore.area === bestLocalScore.area &&
            testScore.perim === bestLocalScore.perim &&
            testScore.wl < bestLocalScore.wl
          )) {
            // Need actual routing if we pretend we improved
            const testWires = await route(components, cols, rows, () => { }, () => gCancelRequested);
            const realScore = scoreState(components, testWires);
            if (realScore.comp < bestScore.comp) continue;

            if (isScoreBetter(realScore, bestLocalScore) || (
              realScore.comp === bestLocalScore.comp &&
              realScore.area === bestLocalScore.area &&
              realScore.perim === bestLocalScore.perim &&
              realScore.wl < bestLocalScore.wl
            )) {
              bestLocalScore = realScore;
              bestLocalComps = saveComps(components);
              bestLocalWires = testWires;
            }
          }
        }
      }

      restoreCompRotation(cc, rotOrig);
    }
  }

  if (bestLocalComps) {
    restoreComps(components, bestLocalComps);
    return { improved: true, score: bestLocalScore, wires: bestLocalWires };
  }

  restoreComps(components, original);
  return { improved: false, score: bestScore, wires: originalWires };
}


export async function tryRotateOptimize(components, wires, cols, rows, gCancelRequested = false) {
  let bestScore = scoreState(components, wires);
  let bestWires = wires;
  let improved = false;

  for (let c of components) {
    const originalW = c.w, originalH = c.h;
    const originalPins = c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }));
    let cImproved = false;

    for (let rot = 1; rot <= 3; rot++) {
      rotateComp90InPlace(c);

      if (anyOverlap(c, components)) continue;

      const testWires = await route(components, cols, rows, () => { }, () => gCancelRequested);
      const testScore = scoreState(components, testWires);

      if (isScoreBetter(testScore, bestScore)) {
        bestScore = testScore;
        bestWires = testWires;
        improved = true; cImproved = true; break;
      }
    }

    if (!cImproved) {
      restoreCompRotation(c, { w: originalW, h: originalH, pins: originalPins });
    }
  }
  return { improved, score: bestScore, wires: bestWires };
}


export async function doRecursivePushPacking(components, wires, cols, rows, gCancelRequested = false) {
  let changed = true;
  let loops = 0;
  let bestScore = scoreState(components, wires);
  let bestWires = wires;

  while (changed && loops < 25) {
    if (gCancelRequested) break;
    changed = false;
    loops++;

    const { bounds } = calculateFootprintArea(components, bestWires);
    const globalCx = bounds.minCol + (bounds.maxCol - bounds.minCol) / 2;
    const globalCy = bounds.minRow + (bounds.maxRow - bounds.minRow) / 2;

    const nets = getAllNets(components);

    // Calculate a specific target "Center of Mass" for EACH component based on its wires
    const compTargets = new Map();
    components.forEach(c => {
      let sumX = 0, sumY = 0, count = 0;

      c.pins.forEach(p => {
        if (p.net && nets[p.net]) {
          nets[p.net].forEach(op => {
            // Don't count pins that are on THIS component
            if (op.col >= c.ox && op.col < c.ox + c.w && op.row >= c.oy && op.row < c.oy + c.h) return;
            sumX += op.col;
            sumY += op.row;
            count++;
          });
        }
      });

      // If connected to things, target their average location. If unconnected, drift to global center.
      if (count > 0) {
        compTargets.set(c, { x: sumX / count, y: sumY / count });
      } else {
        compTargets.set(c, { x: globalCx, y: globalCy });
      }
    });

    // Sort components: furthest from their personal target move first
    const sorted = [...components].sort((a, b) => {
      const tA = compTargets.get(a);
      const tB = compTargets.get(b);
      const distA = Math.max(Math.abs(a.ox + a.w / 2 - tA.x), Math.abs(a.oy + a.h / 2 - tA.y));
      const distB = Math.max(Math.abs(b.ox + b.w / 2 - tB.x), Math.abs(b.oy + b.h / 2 - tB.y));
      return distB - distA;
    });

    const oldStates = saveComps(components);
    let moveOccurred = false;

    for (let c of sorted) {
      const target = compTargets.get(c);
      let dx = 0, dy = 0;

      // Move toward personal target
      if (c.ox + c.w / 2 < target.x - 0.5) dx = 1;
      else if (c.ox + c.w / 2 > target.x + 0.5) dx = -1;

      if (c.oy + c.h / 2 < target.y - 0.5) dy = 1;
      else if (c.oy + c.h / 2 > target.y + 0.5) dy = -1;

      const tryMove = (mx, my) => {
        if (mx === 0 && my === 0) return false;
        moveComp(c, c.ox + mx, c.oy + my);
        if (anyOverlap(c, components)) {
          moveComp(c, c.ox - mx, c.oy - my); // Revert physical collision
          return false;
        }
        return true;
      };

      // Try moving diagonally first, then slide horizontally or vertically
      if (tryMove(dx, dy) || tryMove(dx, 0) || tryMove(0, dy)) {
        moveOccurred = true;
      }
    }

    if (moveOccurred) {
      const testWires = await route(components, cols, rows, () => { }, () => gCancelRequested);
      const testScore = scoreState(components, testWires);

      if (isScoreBetter(testScore, bestScore) || (
        testScore.comp === bestScore.comp && testScore.area === bestScore.area && testScore.perim === bestScore.perim
      )) {
        if (isScoreBetter(testScore, bestScore)) bestScore = testScore;
        bestWires = testWires;
        changed = true;
      } else {
        restoreComps(components, oldStates); // Revert if topological move broke a wire
      }
    }
  }
  return { score: bestScore, wires: bestWires };
}


export async function tryGlobalNudge(components, wires, bestScore, cols, rows, gCancelRequested = false) {
  const dirs = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 }
  ];

  const original = saveComps(components);
  const originalWires = wires;

  for (const d of dirs) {
    restoreComps(components, original);

    // Validate bounds for the entire translation first.
    let inBounds = true;
    for (const c of components) {
      const nx = c.ox + d.dx;
      const ny = c.oy + d.dy;
      if (nx < 0 || ny < 0 || nx + c.w > cols || ny + c.h > rows) { inBounds = false; break; }
    }
    if (!inBounds) continue;

    // Apply the translation atomically.
    for (const c of components) moveComp(c, c.ox + d.dx, c.oy + d.dy);

    const testWires = await route(components, cols, rows, () => { }, () => gCancelRequested);
    const testScore = scoreState(components, testWires);
    if (isScoreBetter(testScore, bestScore)) {
      return { improved: true, score: testScore, wires: testWires };
    }
  }

  restoreComps(components, original);
  return { improved: false, score: bestScore, wires: originalWires };
}


export function recenterComponents(components, wires, cols, rows) {
  if (components.length === 0) return;
  const b = calculateComponentBounds(components);
  const cx = Math.floor((b.minCol + b.maxCol + 1) / 2);
  const cy = Math.floor((b.minRow + b.maxRow + 1) / 2);
  const dx = Math.floor(cols / 2) - cx;
  const dy = Math.floor(rows / 2) - cy;

  if (dx === 0 && dy === 0) return;

  components.forEach(c => moveComp(c, c.ox + dx, c.oy + dy));
  wires.forEach(w => {
    if (w.path) w.path.forEach(pt => { pt.col += dx; pt.row += dy; });
  });
}

export function cutToBoundingBox(components, wires) {
  if (!components.length) return null;

  const { bounds } = calculateFootprintArea(components, wires);

  const pad = 0;
  const newCols = (bounds.maxCol - bounds.minCol) + 1 + (pad * 2);
  const newRows = (bounds.maxRow - bounds.minRow) + 1 + (pad * 2);

  if (newCols <= 0 || newRows <= 0) return null;

  const offsetX = -bounds.minCol + pad;
  const offsetY = -bounds.minRow + pad;

  components.forEach(comp => {
    comp.ox += offsetX;
    comp.oy += offsetY;
    comp.pins.forEach(pin => {
      pin.col += offsetX;
      pin.row += offsetY;
    });
  });

  wires.forEach(wire => {
    if (wire.path) {
      wire.path.forEach(point => {
        point.col += offsetX;
        point.row += offsetY;
      });
    }
  });

  return { cols: newCols, rows: newRows, offsetX, offsetY };
}
