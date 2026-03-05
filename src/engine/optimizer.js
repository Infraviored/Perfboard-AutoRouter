import { route } from './router.js';
import { scoreState, formatScore, calculateFootprintArea, footprintBoxMetrics, calculateComponentBounds, doRecursivePushPacking, tryRotateOptimize, explorePlateauStates, tryGlobalNudge, tryShrinkAlongWires, tryWireAbsorption, tryAffinityPacking, tryChainedCompaction, isScoreBetter, recenterComponents, stateKeyForPlateau, enumeratePlateauNeighbors } from './optimizer-algorithms.js';
import { saveComps, restoreComps } from './state-utils.js';
import { moveComp, rotateComp90InPlace, anneal, anyOverlap } from './placer.js';

export async function doOptimizeFootprint(components, wires, cols, rows, config, options = {}) {
    const { onProgress, onStatusUpdate, onStateChange, onBestSnapshot, onToast } = options;
    const toast = onToast;
    const setProg = onProgress;
    const setBestLine = (msg) => onStatusUpdate?.({ best: msg });

    let currentWires = wires;
    let uiCols = cols;
    let uiRows = rows;

    let gCancelRequested = false;
    const checkCancel = () => {
        if (options.checkCancel) return options.checkCancel();
        return gCancelRequested;
    };

    // Flash the main canvas with whatever intermediate state we're exploring
    const flashUIState = () => {
        // Spread each component so React sees new references and re-renders positions
        onStateChange?.({
            components: components.map(c => ({ ...c, pins: c.pins })),
            wires: currentWires,
            cols: uiCols,
            rows: uiRows
        });
    };
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

    if (!components.length) { toast?.('No components to optimize', 'warn'); return; }


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

    setBestLine('');

    const startSnapshot = saveComps(components);
    const startWires = await route(components, uiCols, uiRows, () => { }, checkCancel);
    const startScore = scoreState(components, startWires);
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
    currentWires = await route(components, vCols, vRows, () => { }, false, checkCancel);

    // Track Absolute Best
    let globalBestScore = scoreState(components, currentWires);
    let globalBestComps = saveComps(components);
    let globalBestWires = [...currentWires];

    let bestUiMsg = `Best: ${formatScore(globalBestScore)}`;
    setBestLine(bestUiMsg);
    pushHydratedBest(components, globalBestWires);

    // Track Progress of Current Search Branch
    let localBestScore = globalBestScore;
    let localBestComps = saveComps(components);

    let stagnation = 0;
    let macroCount = 0;

    const startTime = performance.now();

    for (let currentEpoch = 1; currentEpoch <= MAX_EPOCHS; currentEpoch++) {
        if (checkCancel() || (performance.now() - startTime) > maxTimeMs) break;

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
            currentWires = await route(components, vCols, vRows, () => { }, checkCancel);
            recenterComponents(components, currentWires);
            localBestScore = scoreState(components, currentWires);
            localBestComps = saveComps(components);
            stagnation = 0;
            macroCount = 0;
        }

        // --- 2. SEARCH LOOP ---
        for (let iter = 1; iter <= MAX_ITERS; iter++) {
            if (checkCancel() || (performance.now() - startTime) > maxTimeMs) break;
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
                    currentWires = await route(components, vCols, vRows, () => { }, checkCancel);
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
                currentWires = await route(components, vCols, vRows, () => { }, checkCancel);
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

            const rotRes = await tryRotateOptimize(components, currentWires, vCols, vRows, checkCancel());
            currentWires = rotRes.wires;

            const nudgeRes = await tryGlobalNudge(components, currentWires, localBestScore, vCols, vRows, checkCancel());
            if (nudgeRes.improved) {
                localBestScore = nudgeRes.score;
                currentWires = nudgeRes.wires;
            }

            const shrinkRes = await tryShrinkAlongWires(components, currentWires, localBestScore, vCols, vRows, checkCancel());
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

                    const shrink2 = await tryShrinkAlongWires(components, currentWires, localBestScore, vCols, vRows, checkCancel());
                    if (shrink2.improved) {
                        localBestScore = shrink2.score;
                        localBestComps = saveComps(components);
                        currentWires = shrink2.wires;
                    }
                }
            }

            if (checkCancel()) break;
            const preEval = saveComps(components);

            const testWires = await route(components, vCols, vRows, () => { }, checkCancel);
            recenterComponents(components, testWires);
            const testScore = scoreState(components, testWires);

            if (isScoreBetter(testScore, globalBestScore)) {
                globalBestScore = testScore;
                globalBestComps = saveComps(components); globalBestWires = [...testWires];
                localBestScore = testScore;
                localBestComps = saveComps(components);
                stagnation = 0;
                setBestLine(`Best: ${formatScore(testScore)}`);
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
            flashUIState();
            await new Promise(r => setTimeout(r, 0));
            restoreComps(components, preEval);
        } // End Iter Loop
    } // End Epoch Loop

    // --- 3. CLEANUP & RESTORE ---
    restoreComps(components, globalBestComps);
    currentWires = globalBestWires;
    // Removed translateFootprintToTopLeftUI(); to stop jumping to top-left

    const finalScore = scoreState(components, currentWires);
    if (!isScoreBetter(finalScore, startScore)) {
        restoreComps(components, startSnapshot);
        toast?.('Optimization found no improvement', 'inf');
        return { improved: false };
    }

    setBestLine('');
    flashUIState();
    if (checkCancel()) toast?.('Optimization cancelled — kept best so far', 'inf');
    else toast?.(`Optimization complete!`, "ok");

    return { improved: true, score: finalScore, wires: currentWires };
}


export async function doPlateauExplore(components, wires, cols, rows, options = {}) {
    const { onProgress, onStatusUpdate, onStateChange, onToast } = options;
    const toast = (m, t) => onToast?.(m, t);
    const setProg = (p, m) => onProgress?.(p, m);
    const setBestLine = (m) => onStatusUpdate?.({ best: m });

    let currentWires = wires;
    let gCancelRequested = false;
    const checkCancel = () => options.checkCancel ? options.checkCancel() : gCancelRequested;

    if (!components.length) { toast('No components loaded', 'warn'); return; }

    const startSnapshot = saveComps(components);
    let bestWires = await route(components, cols, rows, () => { }, checkCancel);
    let bestScore = scoreState(components, bestWires);
    const startScore = bestScore;
    currentWires = bestWires;

    onStateChange?.({ components, wires: bestWires });

    setBestLine(`Best: ${formatScore(bestScore)}`);

    const visited = new Set();
    visited.add(stateKeyForPlateau(components));
    let lastPickedCompId = null;

    const MAX_STEPS = 10;
    const MAX_NEIGHBORS_PER_COMP = 12;
    const MAX_ROUTINGS_PER_STEP = 35;

    for (let step = 1; step <= MAX_STEPS; step++) {
        if (checkCancel()) break;
        setProg((step / MAX_STEPS) * 100, `Plateau explore: step ${step} / ${MAX_STEPS}`);

        const shrinkRes = await tryShrinkAlongWires(components, currentWires, bestScore, cols, rows, checkCancel());
        if (shrinkRes.improved) {
            bestScore = shrinkRes.score;
            bestWires = shrinkRes.wires;
            currentWires = bestWires;
            setBestLine(`Best: ${formatScore(bestScore)}`);
            onStateChange?.({ components, wires: bestWires });
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
            const testWires = await route(components, cols, rows, () => { }, checkCancel);
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
        setBestLine(`Best: ${formatScore(bestScore)}`);
        onStateChange?.({ components, wires: bestWires });
        await new Promise(r => setTimeout(r, 0));
    }

    const finalScore = scoreState(components, currentWires);
    if (!isScoreBetter(finalScore, startScore)) {
        restoreComps(components, startSnapshot);
    }

    setBestLine('');
    if (checkCancel()) toast('Plateau explore cancelled — kept best so far', 'inf');

    return { improved: isScoreBetter(finalScore, startScore), score: finalScore, wires: currentWires };
}