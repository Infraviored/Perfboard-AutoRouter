import { route } from './router.js';
import { scoreState, footprintBoxMetrics, calculateComponentBounds, doRecursivePushPacking, tryRotateOptimize, explorePlateauStates, tryGlobalNudge, tryShrinkAlongWires, tryWireAbsorption, tryAffinityPacking, tryChainedCompaction, tryClusterRotateOptimize, isScoreBetter, recenterComponents, stateKeyForPlateau, enumeratePlateauNeighbors } from './optimizer-algorithms.js';
import { saveComps, restoreComps, completion } from './state-utils.js';
import { moveComp, rotateComp90InPlace, anneal, anyOverlap } from './placer.js';

const pointKey = (pt) => `${pt.col},${pt.row}`;
const nowMs = () => globalThis.performance?.now?.() || Date.now();

function buildPinMapByNet(components) {
    const map = new Map();
    for (const comp of components) {
        for (const pin of comp.pins || []) {
            if (!pin.net) continue;
            if (!map.has(pin.net)) map.set(pin.net, new Set());
            map.get(pin.net).add(`${comp.ox + pin.dCol},${comp.oy + pin.dRow}`);
        }
    }
    return map;
}

function syncComponentPins(components) {
    for (const comp of components || []) {
        for (const pin of comp.pins || []) {
            pin.col = comp.ox + pin.dCol;
            pin.row = comp.oy + pin.dRow;
        }
    }
}

function buildManualPointMapByNet(wires) {
    const map = new Map();
    for (const wire of wires || []) {
        if (!wire?.manual || !wire?.net || !wire?.path?.length) continue;
        if (!map.has(wire.net)) map.set(wire.net, new Set());
        const points = map.get(wire.net);
        for (const pt of wire.path) points.add(pointKey(pt));
    }
    return map;
}

function getRenderableWires(components, wires, pinsByNet = null) {
    if (!wires?.length) return [];
    const pinMap = pinsByNet || buildPinMapByNet(components);
    const manualPointMap = buildManualPointMapByNet(wires);

    // Build a map of ALL points occupied by every net (excluding the current wire under test)
    // Actually, a simpler approach is to build a full Set of all points per net,
    // then for each wire, we check if its endpoints are in the pinMap OR are shared with ANOTHER wire in the net.

    // To distinguish "this wire's points" from "other wires' points", we can just count occurrences of points.
    // If an endpoint occurs > 1 time across the net's ALL paths, it touches a junction.
    const pointOccurrenceCounts = new Map();

    wires.forEach(wire => {
        if (!wire?.path?.length || wire.failed) return;
        if (!pointOccurrenceCounts.has(wire.net)) pointOccurrenceCounts.set(wire.net, new Map());
        const counts = pointOccurrenceCounts.get(wire.net);
        wire.path.forEach(pt => {
            const pk = pointKey(pt);
            counts.set(pk, (counts.get(pk) || 0) + 1);
        });
    });

    return wires.filter((wire) => {
        if (!wire?.path?.length || wire.failed) return false;
        const netPins = pinMap.get(wire.net);
        const manualPoints = manualPointMap.get(wire.net);
        if (!netPins?.size && !manualPoints?.size) return false;

        const counts = pointOccurrenceCounts.get(wire.net);

        const startKey = pointKey(wire.path[0]);
        const endKey = pointKey(wire.path[wire.path.length - 1]);

        // A wire is valid if its start and end points either touch a pin, a manual point, or intersect with another wire segment of the same net.
        const hasStartAnchor = netPins?.has(startKey) || manualPoints?.has(startKey) || (counts.get(startKey) > 1);
        const hasEndAnchor = netPins?.has(endKey) || manualPoints?.has(endKey) || (counts.get(endKey) > 1);

        return hasStartAnchor && hasEndAnchor;
    });
}



function cloneWires(wires) {
    return (wires || []).map((wire) => ({
        ...wire,
        path: wire.path ? wire.path.map((pt) => ({ ...pt })) : wire.path
    }));
}

function routeCacheKey(components, cols, rows, existingWires) {
    const compSig = componentsSignature(components);

    const manualSig = (existingWires || [])
        .filter((w) => w?.manual && w?.path?.length)
        .map((w) => {
            const pathArr = w.path.map((pt) => [pt.col, pt.row]);
            return {
                net: w.net || '',
                path: pathArr,
                _sortKey: `${w.net || ''}:${JSON.stringify(pathArr)}`
            };
        })
        .sort((a, b) => a._sortKey.localeCompare(b._sortKey))
        .map(({ net, path }) => ({ net, path }));

    if (components?.length > 0) {
        return JSON.stringify({ compSig, manualSig });
    }

    return JSON.stringify({ cols, rows, compSig, manualSig });
}

function componentsSignature(components) {
    return components.map((c) => ({
        id: c.id,
        ox: c.ox,
        oy: c.oy,
        w: c.w,
        h: c.h,
        routeUnder: !!c.routeUnder,
        pins: (c.pins || []).map((p) => ({
            dCol: p.dCol,
            dRow: p.dRow,
            net: p.net || ''
        }))
    }));
}


function createRouteCache(maxEntries = 400) {
    const cache = new Map();

    return async (components, cols, rows, onProg = () => { }, checkCancel, existingWires) => {
        syncComponentPins(components);
        const key = routeCacheKey(components, cols, rows, existingWires);
        const cached = cache.get(key);
        if (cached) {
            cache.delete(key);
            cache.set(key, cached);
            return cloneWires(cached);
        }

        const routed = await route(components, cols, rows, onProg, checkCancel, existingWires);
        const clonedToStore = cloneWires(routed);
        cache.set(key, clonedToStore);

        if (cache.size > maxEntries) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
        }

        return cloneWires(clonedToStore);
    };
}

async function runFinalWirePullPostprocess(components, wires, score, cols, rows, routeCached, checkCancel) {
    if (!components?.length) return { improved: false, wires, score };

    let workingWires = wires;
    let workingScore = score;
    let improved = false;
    const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
    ];

    const ordered = [...components].sort((a, b) => {
        const ap = (a.pins?.length === 1) ? 0 : 1;
        const bp = (b.pins?.length === 1) ? 0 : 1;
        return ap - bp;
    });

    for (const comp of ordered) {
        if (checkCancel?.()) break;
        const baseOx = comp.ox;
        const baseOy = comp.oy;

        let bestMove = null;
        for (const { dx, dy } of dirs) {
            moveComp(comp, baseOx + dx, baseOy + dy);
            if (anyOverlap(comp, components)) {
                moveComp(comp, baseOx, baseOy);
                continue;
            }

            const testWires = await routeCached(components, cols, rows, () => { }, checkCancel, workingWires);
            const testScore = scoreState(components, testWires);

            moveComp(comp, baseOx, baseOy);

            const keepsQuality =
                testScore.comp >= workingScore.comp &&
                testScore.area <= workingScore.area &&
                testScore.perim <= workingScore.perim &&
                testScore.wl <= workingScore.wl;
            if (!keepsQuality) continue;

            if (!bestMove || isScoreBetter(testScore, bestMove.score)) {
                bestMove = { ox: baseOx + dx, oy: baseOy + dy, wires: testWires, score: testScore };
            }
        }

        if (bestMove) {
            moveComp(comp, bestMove.ox, bestMove.oy);
            workingWires = bestMove.wires;
            workingScore = bestMove.score;
            improved = true;
        }
    }

    return { improved, wires: workingWires, score: workingScore };
}

async function runInwardPotentialCompaction(components, wires, score, cols, rows, routeCached, checkCancel) {
    if (!components?.length) return { improved: false, wires, score };

    let workingWires = wires;
    let workingScore = score;
    let improved = false;

    for (let pass = 0; pass < 3; pass++) {
        if (checkCancel?.()) break;

        const b = calculateComponentBounds(components);
        const cx = (b.minCol + b.maxCol) / 2;
        const cy = (b.minRow + b.maxRow) / 2;

        const ordered = [...components].sort((a, bComp) => {
            const aDist = Math.abs((a.ox + a.w / 2) - cx) + Math.abs((a.oy + a.h / 2) - cy);
            const bDist = Math.abs((bComp.ox + bComp.w / 2) - cx) + Math.abs((bComp.oy + bComp.h / 2) - cy);
            return bDist - aDist;
        });

        let passImproved = false;
        for (const comp of ordered) {
            if (checkCancel?.()) break;

            const baseOx = comp.ox;
            const baseOy = comp.oy;
            const dx = cx > (baseOx + comp.w / 2) ? 1 : (cx < (baseOx + comp.w / 2) ? -1 : 0);
            const dy = cy > (baseOy + comp.h / 2) ? 1 : (cy < (baseOy + comp.h / 2) ? -1 : 0);

            const candidates = [];
            if (dx !== 0) candidates.push({ ox: baseOx + dx, oy: baseOy });
            if (dy !== 0) candidates.push({ ox: baseOx, oy: baseOy + dy });
            if (dx !== 0 && dy !== 0) candidates.push({ ox: baseOx + dx, oy: baseOy + dy });

            let best = null;
            for (const c of candidates) {
                moveComp(comp, c.ox, c.oy);
                if (anyOverlap(comp, components)) {
                    moveComp(comp, baseOx, baseOy);
                    continue;
                }

                const testWires = await routeCached(components, cols, rows, () => { }, checkCancel, workingWires);
                const testScore = scoreState(components, testWires);
                moveComp(comp, baseOx, baseOy);

                const keepQuality =
                    testScore.comp >= workingScore.comp &&
                    testScore.area <= workingScore.area &&
                    testScore.perim <= workingScore.perim &&
                    testScore.wl <= workingScore.wl;
                if (!keepQuality) continue;

                if (!best || isScoreBetter(testScore, best.score)) {
                    best = { ...c, wires: testWires, score: testScore };
                }
            }

            if (best) {
                moveComp(comp, best.ox, best.oy);
                workingWires = best.wires;
                workingScore = best.score;
                improved = true;
                passImproved = true;
            }
        }

        if (!passImproved) break;
    }

    return { improved, wires: workingWires, score: workingScore };
}

function createLiveRenderer(onStateChange, intervalMs = 120, initialCompletion = 0) {
    let lastRenderAt = 0;
    let bestRenderedCompletion = initialCompletion;
    let lastCompSig = '';
    let cachedPinsByNet = new Map();

    return ({ components, wires, cols, rows, force = false, resetCompletionFloor = false }) => {
        if (!onStateChange) return;
        syncComponentPins(components);

        const now = nowMs();
        if (!force && now - lastRenderAt < intervalMs) return;
        lastRenderAt = now;

        const currentCompletion = completion(wires || []);
        if (resetCompletionFloor) {
            bestRenderedCompletion = currentCompletion;
        }
        if (currentCompletion < bestRenderedCompletion) return;

        if (currentCompletion > bestRenderedCompletion) {
            bestRenderedCompletion = currentCompletion;
        }

        const compSig = JSON.stringify(componentsSignature(components));
        if (compSig !== lastCompSig) {
            cachedPinsByNet = buildPinMapByNet(components);
            lastCompSig = compSig;
        }

        const renderWires = getRenderableWires(components, wires, cachedPinsByNet);

        onStateChange({
            components: components.map(c => ({ ...c, pins: c.pins.map(p => ({ ...p })) })),
            // Preserve full engine wire state; use renderWires for UI-only rendering.
            wires: (wires || []).map(w => ({ ...w })),
            renderWires,
            cols,
            rows
        });
    };
}

export async function compactBoard(components, wires, cols, rows, config, options = {}) {
    const { onProgress, onStatusUpdate, onStateChange, onBestSnapshot } = options;
    const setProg = onProgress;
    const setBestLine = (score) => onStatusUpdate?.({ best: score });

    const startTime = nowMs();
    const MAX_EPOCHS = config.maxEpochs || 1;
    let MAX_ITERS = config.maxIters || 100;

    // Distribute iterations across epochs
    if (MAX_EPOCHS > 1 && MAX_ITERS > 10) {
        MAX_ITERS = Math.max(10, Math.floor(MAX_ITERS / MAX_EPOCHS));
    }
    const saThresh = config.saTrigger || 5;
    const platThresh = config.plateauTrigger || 8;
    const deepThresh = config.deepStagnation || 12;
    const maxTimeMs = config.maxTimeMs || 25000;

    let gCancelRequested = false;
    const checkCancel = () => {
        if (options.checkCancel && options.checkCancel()) return true;
        if ((nowMs() - startTime) > maxTimeMs) return true;
        return gCancelRequested;
    };

    let currentWires = wires;
    let uiCols = cols;
    let uiRows = rows;

    const routeCached = createRouteCache(options.routeCacheSize ?? 400);
    // Push a new "best" snapshot to the bottom bar preview, using full component arrays
    const pushHydratedBest = (liveComps, ws) => {
        const hydratedComps = liveComps.map(c => ({
            ...c,
            // Recompute pins based strictly on ox/oy to avoid stale pin data
            pins: c.pins.map(p => ({ ...p, col: c.ox + p.dCol, row: c.oy + p.dRow }))
        }));
        // Clone wires too
        const wsClone = ws ? JSON.parse(JSON.stringify(ws)) : [];
        onBestSnapshot?.({ components: hydratedComps, wires: wsClone });
    };

    if (!components.length) return;

    setBestLine(null);

    const startSnapshot = saveComps(components);
    const startWires = await routeCached(components, uiCols, uiRows, () => { }, checkCancel, wires);
    const startScore = scoreState(components, startWires);

    // Flash the main canvas with whatever intermediate state we're exploring, passing startScore.comp as the floor
    const flashUIState = createLiveRenderer(onStateChange, options.liveRenderIntervalMs ?? 120, startScore.comp);

    currentWires = startWires;

    const setIterStatus = (epoch, iter) => {
        const msg = `Optimize (E${epoch}) ${iter} / ${MAX_ITERS}`;
        onStatusUpdate?.({ title: msg });
    };
    setIterStatus(0, 0);

    // --- 1. SET INFINITE BOUNDS ---
    const vCols = 1e6;
    const vRows = 1e6;

    setProg?.(0, `Preparing virtual workspace...`);
    currentWires = await routeCached(components, vCols, vRows, () => { }, checkCancel, currentWires);

    // Track Absolute Best
    let globalBestScore = scoreState(components, currentWires);
    let globalBestComps = saveComps(components);
    let globalBestWires = [...currentWires];

    setBestLine(globalBestScore);
    pushHydratedBest(components, globalBestWires);

    // Track Progress of Current Search Branch
    let localBestScore = globalBestScore;
    let localBestComps = saveComps(components);

    let stagnation = 0;
    let macroCount = 0;

    for (let currentEpoch = 1; currentEpoch <= MAX_EPOCHS; currentEpoch++) {
        if (checkCancel() || (nowMs() - startTime) > maxTimeMs) break;

        if (currentEpoch > 1) {
            console.log(`[Epoch ${currentEpoch}] Triggering full random scramble...`);
            setProg?.(0, `Epoch ${currentEpoch} / ${MAX_EPOCHS} (Randomizing...)`);
            const b = calculateComponentBounds(components);
            const spanX = Math.max(20, b.maxCol - b.minCol + 10);
            const spanY = Math.max(20, b.maxRow - b.minRow + 10);
            const cx = Math.floor((b.minCol + b.maxCol) / 2);
            const cy = Math.floor((b.minRow + b.maxRow) / 2);

            for (let c of components) {
                const nx = cx + Math.floor(Math.random() * spanX - spanX / 2);
                const ny = cy + Math.floor(Math.random() * spanY - spanY / 2);

                const rotations = Math.floor(Math.random() * 4);
                // Simple placeholder for multi-rotation logic in placer.js if needed
                for (let i = 0; i < rotations; i++) rotateComp90InPlace(c);

                moveComp(c, nx, ny);
            }
            currentWires = await routeCached(components, vCols, vRows, () => { }, checkCancel, currentWires);
            recenterComponents(components, currentWires);
            localBestScore = scoreState(components, currentWires);
            localBestComps = saveComps(components);
            stagnation = 0;
            macroCount = 0;
        }

        // --- 2. SEARCH LOOP ---
        for (let iter = 1; iter <= MAX_ITERS; iter++) {
            if (checkCancel() || (nowMs() - startTime) > maxTimeMs) break;
            setIterStatus(currentEpoch, iter);

            if (iter % 10 === 0 || stagnation >= platThresh) {
                if (stagnation >= saThresh && stagnation < platThresh) {
                    // Skip SA
                } else {
                    macroCount++;
                    if (stagnation >= deepThresh) {
                        const b = calculateComponentBounds(components);
                        const cx = Math.floor((b.minCol + b.maxCol) / 2);
                        const cy = Math.floor((b.minRow + b.maxRow) / 2);
                        for (const c of components) {
                            const nx = cx + Math.floor(Math.random() * 7) - 3;
                            const ny = cy + Math.floor(Math.random() * 7) - 3;
                            moveComp(c, nx, ny);
                        }
                        stagnation = 6;
                    }

                    await anneal(components, vCols, vRows, (p) => {
                        recenterComponents(components, null);
                        setProg?.((iter / MAX_ITERS) * 100, `Iter ${iter}: SA Routing ${macroCount} — ${Math.round(p * 100)}%`);
                    }, checkCancel);

                    // Re-route after SA since positions changed
                    currentWires = await routeCached(components, vCols, vRows, () => { }, checkCancel, currentWires);
                    recenterComponents(components, currentWires);

                    if (stagnation >= deepThresh) stagnation = 0;
                }
            }

            if (iter % 10 !== 0 && stagnation < platThresh) {
                setProg?.((iter / MAX_ITERS) * 100, `Iter ${iter}: Micro Search (Stagnation: ${stagnation}/${platThresh})...`);

                restoreComps(components, localBestComps);

                const numMutations = Math.max(1, Math.floor(components.length * 0.15));
                let compsToMutate = [...components].sort(() => 0.5 - Math.random()).slice(0, numMutations);

                for (let c of compsToMutate) {
                    const oldW = c.w, oldH = c.h, oldOx = c.ox, oldOy = c.oy;
                    const oldPins = c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }));

                    if (Math.random() < 0.2) {
                        rotateComp90InPlace(c);
                    }

                    let dx = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);
                    let dy = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);

                    const nx = c.ox + dx;
                    const ny = c.oy + dy;

                    moveComp(c, nx, ny);
                    if (anyOverlap(c, components)) {
                        c.w = oldW; c.h = oldH;
                        moveComp(c, oldOx, oldOy);
                        c.pins.forEach((p, idx) => {
                            p.dCol = oldPins[idx].dCol;
                            p.dRow = oldPins[idx].dRow;
                            p.col = c.ox + p.dCol;
                            p.row = c.oy + p.dRow;
                        });
                    }
                }
                // Re-route after micro-mutations so wires aren't "detached"
                currentWires = await routeCached(components, vCols, vRows, () => { }, checkCancel, currentWires);
                recenterComponents(components, currentWires);
            }

            if (checkCancel()) break;
            const pushRes = await doRecursivePushPacking(components, currentWires, vCols, vRows, checkCancel());
            currentWires = pushRes.wires;

            if (!checkCancel()) {
                const affinityRes = tryAffinityPacking(components, currentWires, localBestScore, vCols, vRows, checkCancel());
                if (affinityRes.improved) {
                    localBestScore = affinityRes.score;
                    localBestComps = saveComps(components);
                    currentWires = affinityRes.wires;
                    stagnation = 0;
                }
            }

            if (!checkCancel()) {
                const clusterRotRes = tryClusterRotateOptimize(components, currentWires, localBestScore, vCols, vRows, checkCancel());
                if (clusterRotRes.improved) {
                    localBestScore = clusterRotRes.score;
                    localBestComps = saveComps(components);
                    currentWires = clusterRotRes.wires;
                    stagnation = 0;
                }
            }

            const rotRes = await tryRotateOptimize(components, currentWires, checkCancel);
            currentWires = rotRes.wires;

            const nudgeRes = await tryGlobalNudge(components, currentWires, localBestScore, vCols, vRows, checkCancel());
            if (nudgeRes.improved) {
                localBestScore = nudgeRes.score;
                currentWires = nudgeRes.wires;
            }

            const shrinkRes = await tryShrinkAlongWires(components, currentWires, localBestScore, vCols, vRows, checkCancel);
            if (shrinkRes.improved) {
                localBestScore = shrinkRes.score;
                localBestComps = saveComps(components);
                currentWires = shrinkRes.wires;
                stagnation = 0;
            }

            if (!checkCancel()) {
                const absorbRes = tryWireAbsorption(components, currentWires, localBestScore, vCols, vRows, checkCancel());
                if (absorbRes.improved) {
                    localBestScore = absorbRes.score;
                    localBestComps = saveComps(components);
                    currentWires = absorbRes.wires;
                    stagnation = 0;
                }
            }

            if (!checkCancel()) {
                const chainRes = tryChainedCompaction(components, currentWires, localBestScore, vCols, vRows, checkCancel());
                if (chainRes.improved) {
                    localBestScore = chainRes.score;
                    localBestComps = saveComps(components);
                    currentWires = chainRes.wires;
                    stagnation = 0;
                }
            }

            if (!checkCancel() && stagnation >= platThresh) {
                const plateauRes = await explorePlateauStates(components, currentWires, localBestScore, vCols, vRows, checkCancel());
                if (plateauRes.improved) {
                    localBestScore = plateauRes.score;
                    localBestComps = saveComps(components);
                    currentWires = plateauRes.wires;
                    stagnation = 0;

                    const shrink2 = await tryShrinkAlongWires(components, currentWires, localBestScore, vCols, vRows, checkCancel);
                    if (shrink2.improved) {
                        localBestScore = shrink2.score;
                        localBestComps = saveComps(components);
                        currentWires = shrink2.wires;
                    }
                }
            }

            if (checkCancel()) break;
            const preEval = saveComps(components);

            const testWires = await routeCached(components, vCols, vRows, () => { }, checkCancel, currentWires);
            recenterComponents(components, testWires);
            const testScore = scoreState(components, testWires);

            if (isScoreBetter(testScore, globalBestScore)) {
                globalBestScore = testScore;
                globalBestComps = saveComps(components); globalBestWires = [...testWires];
                localBestScore = testScore;
                localBestComps = saveComps(components);
                stagnation = 0;
                setBestLine(testScore);
                if (isScoreBetter(testScore, startScore)) {
                    currentWires = globalBestWires;

                    // Push best snapshot to bottom bar
                    pushHydratedBest(components, globalBestWires);
                }
            }
            else if (isScoreBetter(testScore, localBestScore)) {
                localBestScore = testScore;
                localBestComps = saveComps(components);
                stagnation = 0;
            }
            else {
                stagnation++;
            }

            // Flash the canvas so the user sees the AI "thinking"
            flashUIState({ components, wires: testWires, cols: uiCols, rows: uiRows });
            await new Promise(r => setTimeout(r, 0));
            restoreComps(components, preEval);
        } // End Iter Loop
    } // End Epoch Loop

    // --- 3. CLEANUP & RESTORE ---
    restoreComps(components, globalBestComps);
    currentWires = globalBestWires;
    // Removed translateFootprintToTopLeftUI(); to stop jumping to top-left

    const finalScore = scoreState(components, currentWires);
    const improved = isScoreBetter(finalScore, startScore);
    if (!improved) {
        restoreComps(components, startSnapshot);
        currentWires = startWires;
    }

    setBestLine(null);
    flashUIState({ components, wires: currentWires, cols: uiCols, rows: uiRows, force: true, resetCompletionFloor: true });

    return { improved, score: improved ? finalScore : startScore, wires: currentWires, startScore: startScore };
}


export async function optimizeBoard(components, wires, cols, rows, options = {}) {
    const { onProgress, onStatusUpdate, onStateChange, onBestSnapshot } = options;
    const setProg = (p, m) => onProgress?.(p, m);
    const setBestLine = (m) => onStatusUpdate?.({ best: m });

    const routeCached = createRouteCache(options.routeCacheSize ?? 400);

    const pushHydratedBest = (liveComps, ws) => {
        const hydratedComps = liveComps.map(c => ({
            ...c,
            pins: c.pins.map(p => ({ ...p, col: c.ox + p.dCol, row: c.oy + p.dRow }))
        }));
        const wsClone = ws ? JSON.parse(JSON.stringify(ws)) : [];
        onBestSnapshot?.({ components: hydratedComps, wires: wsClone });
    };

    let currentWires = wires;
    let gCancelRequested = false;
    const checkCancel = () => options.checkCancel ? options.checkCancel() : gCancelRequested;

    if (!components.length) return;

    const startSnapshot = saveComps(components);
    const startWires = await routeCached(components, cols, rows, () => { }, checkCancel, currentWires);
    const startScore = scoreState(components, startWires);

    const flashUIState = createLiveRenderer(onStateChange, options.liveRenderIntervalMs ?? 120, startScore.comp);

    let bestWires = startWires;
    let bestScore = startScore;
    currentWires = startWires;

    flashUIState({ components, wires: bestWires, cols, rows, force: true });
    setBestLine(bestScore);
    pushHydratedBest(components, bestWires);

    const visited = new Set();
    visited.add(stateKeyForPlateau(components));
    let lastPickedCompId = null;

    const MAX_STEPS = 10;
    const MAX_NEIGHBORS_PER_COMP = 12;
    const MAX_ROUTINGS_PER_STEP = 35;

    for (let step = 1; step <= MAX_STEPS; step++) {
        if (checkCancel()) break;
        setProg((step / MAX_STEPS) * 100, `Plateau explore: step ${step} / ${MAX_STEPS}`);

        const shrinkRes = await tryShrinkAlongWires(components, currentWires, bestScore, cols, rows, checkCancel);
        if (shrinkRes.improved) {
            bestScore = shrinkRes.score;
            bestWires = shrinkRes.wires;
            currentWires = bestWires;
            setBestLine(bestScore);
            flashUIState({ components, wires: bestWires, cols, rows, force: true });
            pushHydratedBest(components, bestWires);
            await new Promise(r => setTimeout(r, 0));
            continue;
        }

        const box = footprintBoxMetrics(components, bestWires);
        const baseBox = { area: box.area, perim: box.perim, bounds: box.bounds };

        const neighborsAll = await enumeratePlateauNeighbors(
            components,
            bestWires,
            baseBox,
            bestScore,
            cols,
            rows,
            MAX_NEIGHBORS_PER_COMP,
            step,
            visited,
            (done, total, tag) => {
                if (checkCancel()) return;
                setProg((step / MAX_STEPS) * 100, `Plateau explore: step ${step}/${MAX_STEPS} — eval ${Math.min(done, total)}/${total} (${tag})`);
            },
            MAX_ROUTINGS_PER_STEP,
            checkCancel()
        );
        const neighbors = neighborsAll.filter(n => !visited.has(n.key));
        let pick = null;
        for (const n of neighbors) {
            if (checkCancel()) break;

            restoreComps(components, n.comps);
            const testWires = await routeCached(components, cols, rows, () => { }, checkCancel, currentWires);
            n.wires = testWires;
            n.score = scoreState(components, testWires);

            if (n.score.comp < bestScore.comp) continue;
            if (n.score.area > baseBox.area) continue;
            if (n.score.area === baseBox.area && n.score.perim > baseBox.perim) continue;
            if (!pick) pick = n;
            else {
                const a = n.score;
                const b = pick.score;
                if (a.area !== b.area) { if (a.area < b.area) pick = n; continue; }
                if (a.perim !== b.perim) { if (a.perim < b.perim) pick = n; continue; }

                const aSame = lastPickedCompId !== null && String(n.compId) === String(lastPickedCompId);
                const bSame = lastPickedCompId !== null && String(pick.compId) === String(lastPickedCompId);
                if (aSame !== bSame) { if (!aSame) pick = n; continue; }

                if (a.wl < b.wl) pick = n;
            }
        }

        if (!pick) break;
        restoreComps(components, pick.comps);
        currentWires = pick.wires;
        recenterComponents(components, currentWires);
        visited.add(pick.key);
        lastPickedCompId = pick.compId;
        bestWires = currentWires;
        bestScore = pick.score;
        setBestLine(bestScore);
        flashUIState({ components, wires: bestWires, cols, rows, force: true });
        pushHydratedBest(components, bestWires);
        await new Promise(r => setTimeout(r, 0));
    }

    const postRes = await runFinalWirePullPostprocess(
        components,
        currentWires,
        bestScore,
        cols,
        rows,
        routeCached,
        checkCancel
    );
    if (postRes.improved) {
        currentWires = postRes.wires;
        bestWires = currentWires;
        bestScore = postRes.score;
        setBestLine(bestScore);
        flashUIState({ components, wires: bestWires, cols, rows, force: true });
        pushHydratedBest(components, bestWires);
    }

    const potentialRes = await runInwardPotentialCompaction(
        components,
        currentWires,
        bestScore,
        cols,
        rows,
        routeCached,
        checkCancel
    );
    if (potentialRes.improved) {
        currentWires = potentialRes.wires;
        bestWires = currentWires;
        bestScore = potentialRes.score;
        setBestLine(bestScore);
        flashUIState({ components, wires: bestWires, cols, rows, force: true });
        pushHydratedBest(components, bestWires);
    }

    const finalScore = scoreState(components, currentWires);
    const improved = isScoreBetter(finalScore, startScore);
    if (!improved) {
        restoreComps(components, startSnapshot);
        currentWires = startWires;
    }

    setBestLine(null);
    flashUIState({ components, wires: currentWires, cols, rows, force: true, resetCompletionFloor: true });
    return { improved, score: improved ? finalScore : startScore, wires: currentWires, startScore: startScore };
}
