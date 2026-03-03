
window.doOptimizeFootprint = async function () {
    if (!components.length) { toast('No components to optimize', 'warn'); return; }

    gCancelRequested = false;
    gCancelOp = 'Optimize';

    const MAX_ITERS = window.packerConfig.maxIters || 100;
    const saThresh = window.packerConfig.saTrigger || 5;
    const platThresh = window.packerConfig.plateauTrigger || 8;
    const deepThresh = window.packerConfig.deepStagnation || 12;
    const maxTimeMs = window.packerConfig.maxTimeMs || 25000;

    showOverlay(true);
    ostep(1);
    setBestLine('');

    // Keep optimization transactional: if nothing improves, restore exactly.
    const startSnapshot = snapshotBoardState();
    const startWires = await route(components, COLS, ROWS, () => { }, false, () => gCancelRequested);
    const startScore = scoreState(startWires);
    wires = startWires;

    // Keep showing pre-opt PCB until we actually beat startScore.
    const startPreviewSnapshot = snapshotBoardState();

    const uiCols = COLS;
    const uiRows = ROWS;
    document.getElementById('ot').textContent = `Optimize 0 / ${MAX_ITERS}`;

    // --- 1. EXPAND VIRTUAL BOARD ---
    const { bounds } = calculateFootprintArea();
    // Pad by 20 units so the Simulated Annealer has room to breathe
    const vCols = Math.max(uiCols, (bounds.maxCol - bounds.minCol) + 20);
    const vRows = Math.max(uiRows, (bounds.maxRow - bounds.minRow) + 20);

    // Center everything initially
    const offsetX = Math.floor(vCols / 2 - (bounds.minCol + (bounds.maxCol - bounds.minCol) / 2));
    const offsetY = Math.floor(vRows / 2 - (bounds.minRow + (bounds.maxRow - bounds.minRow) / 2));
    components.forEach(c => moveComp(c, c.ox + offsetX, c.oy + offsetY));

    setProg(0, `Preparing virtual workspace...`);
    // Route only for internal initialization; evaluation later is done on the original board.
    wires = await route(components, vCols, vRows, () => { }, false, () => gCancelRequested);

    // Track Absolute Best
    let globalBestScore = scoreState(wires);
    let globalBestComps = saveComps();
    let globalBestWires = [...wires];

    let bestUiMsg = `Best: ${formatScore(globalBestScore)}`;
    setBestLine(bestUiMsg);

    // Track Progress of Current Search Branch
    let localBestScore = globalBestScore;
    let localBestComps = saveComps();

    let stagnation = 0;
    let macroCount = 0;

    // IMPORTANT: do not render here; keep showing the pre-opt PCB until we have an actual improvement.

    const translateToFitUI = () => {
        const b = calculateComponentBounds();
        const w = (b.maxCol - b.minCol + 1);
        const h = (b.maxRow - b.minRow + 1);
        const margin = 2;
        if (w + margin * 2 > uiCols || h + margin * 2 > uiRows) return false;

        const dx = Math.floor((uiCols - w) / 2) - b.minCol;
        const dy = Math.floor((uiRows - h) / 2) - b.minRow;
        for (const c of components) moveComp(c, c.ox + dx, c.oy + dy);
        return true;
    };

    const translateFootprintToTopLeftUI = () => {
        const fb = footprintBoxMetrics(wires);
        const dx = -fb.bounds.minCol;
        const dy = -fb.bounds.minRow;
        for (const c of components) moveComp(c, c.ox + dx, c.oy + dy);
        if (wires) {
            wires.forEach(w => {
                if (w?.path) w.path.forEach(pt => { pt.col += dx; pt.row += dy; });
            });
        }
    };

    // --- 2. SEARCH LOOP ---
    const startTime = performance.now();
    for (let iter = 1; iter <= MAX_ITERS; iter++) {
        if (gCancelRequested || (performance.now() - startTime) > maxTimeMs) break;
        document.getElementById('ot').textContent = `Optimize ${iter} / ${MAX_ITERS}`;

        if (iter % 10 === 0 || stagnation >= platThresh) {
            if (stagnation >= saThresh && stagnation < platThresh) {
                // Skip SA, let stagnation hit platThresh to trigger plateau explore
            } else {
                // ==========================================
                // MACRO MUTATION (Simulated Annealing)
                // ==========================================
                macroCount++;
                if (stagnation >= deepThresh) {
                    const b = calculateComponentBounds();
                    const spanX = Math.max(1, (b.maxCol - b.minCol + 1));
                    const spanY = Math.max(1, (b.maxRow - b.minRow + 1));
                    const cx = Math.floor(vCols / 2 - spanX / 2);
                    const cy = Math.floor(vRows / 2 - spanY / 2);
                    for (const c of components) {
                        const nx = Math.max(0, Math.min(vCols - c.w, cx + Math.floor(Math.random() * 7) - 3));
                        const ny = Math.max(0, Math.min(vRows - c.h, cy + Math.floor(Math.random() * 7) - 3));
                        moveComp(c, nx, ny);
                    }
                    stagnation = 6;
                }

                await anneal(components, vCols, vRows, (p, s) => {
                    setProg((iter / MAX_ITERS) * 100, `Iter ${iter}: SA Routing ${macroCount} — ${Math.round(p * 100)}%`);
                }, () => gCancelRequested);

                if (stagnation >= deepThresh) stagnation = 0; // Reset deep frustration, but let edge stay near plateau
            }
        }

        if (iter % 10 !== 0 && stagnation < platThresh) {
            // ==========================================
            // MICRO MUTATION (Jitter)
            // ==========================================
            setProg((iter / MAX_ITERS) * 100, `Iter ${iter}: Micro Search (Stagnation: ${stagnation}/${platThresh})...`);

            // Branch off the current local working set
            restoreComps(localBestComps);

            // Tweak 1 or 2 components slightly
            const numMutations = Math.max(1, Math.floor(components.length * 0.15));
            let compsToMutate = [...components].sort(() => 0.5 - Math.random()).slice(0, numMutations);

            for (let c of compsToMutate) {
                const oldW = c.w, oldH = c.h, oldOx = c.ox, oldOy = c.oy;
                const oldPins = c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }));

                if (Math.random() < 0.2) {
                    c.w = oldH; c.h = oldW;
                    c.pins.forEach(p => {
                        const r = p.dRow; p.dRow = p.dCol; p.dCol = c.w - 1 - r;
                        p.col = c.ox + p.dCol; p.row = c.oy + p.dRow;
                    });
                }

                let dx = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);
                let dy = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 2) + 1);

                const nx = Math.max(0, Math.min(vCols - c.w, c.ox + dx));
                const ny = Math.max(0, Math.min(vRows - c.h, c.oy + dy));

                moveComp(c, nx, ny);
                if (anyOverlap(c, components)) {
                    c.w = oldW; c.h = oldH;
                    moveComp(c, oldOx, oldOy);
                    c.pins.forEach((p, idx) => Object.assign(p, oldPins[idx]));
                }
            }
        }

        // --- APPLY PACKING (The Squeeze) ---
        if (gCancelRequested) break;
        await doRecursivePushPacking();
        await tryRotateOptimize();
        await doRecursivePushPacking();

        if (gCancelRequested) break;
        const nudgeRes = await tryGlobalNudge(localBestScore, vCols, vRows);
        if (nudgeRes.improved) {
            localBestScore = nudgeRes.score;
        }

        if (gCancelRequested) break;
        const shrinkRes = await tryShrinkAlongWires(localBestScore, vCols, vRows);
        if (shrinkRes.improved) {
            localBestScore = shrinkRes.score;
            localBestComps = saveComps();
            stagnation = 0;
        }

        if (!gCancelRequested && stagnation >= platThresh) {
            const plateauRes = await explorePlateauStates(localBestScore, vCols, vRows);
            if (plateauRes.improved) {
                localBestScore = plateauRes.score;
                localBestComps = saveComps();
                stagnation = 0;

                const shrink2 = await tryShrinkAlongWires(localBestScore, vCols, vRows);
                if (shrink2.improved) {
                    localBestScore = shrink2.score;
                    localBestComps = saveComps();
                }
            }
        }

        // --- EVALUATE METRICS ---
        // Translate the current virtual placement into the UI board window for evaluation.
        if (gCancelRequested) break;
        const preEval = saveComps();
        const preEvalWires = wires;
        if (!translateToFitUI()) {
            restoreComps(preEval);
            stagnation++;
            await new Promise(r => setTimeout(r, 0));
            continue;
        }

        const testWires = await route(components, uiCols, uiRows, () => { }, false, () => gCancelRequested);
        const testScore = scoreState(testWires);

        // 1. Is it a new GLOBAL Best?
        let isGlobalBest = false;
        if (isScoreBetter(testScore, globalBestScore)) isGlobalBest = true;

        // 2. Is it a new LOCAL Best?
        let isLocalBest = false;
        if (isScoreBetter(testScore, localBestScore)) isLocalBest = true;

        if (isGlobalBest) {
            // Save global records
            globalBestScore = testScore;
            globalBestComps = saveComps(); globalBestWires = [...testWires];

            // Sync local records to the new global high score
            localBestScore = testScore;
            localBestComps = saveComps();

            stagnation = 0;
            const msg = `Iter ${iter}: New global best — ${formatScore(testScore)}`;
            console.log(`[Iter ${iter}] NEW GLOBAL BEST! ${formatScore(testScore)}`);
            bestUiMsg = `Best: ${formatScore(testScore)}`;
            setBestLine(bestUiMsg);
            setProg((iter / MAX_ITERS) * 100, msg);

            // UPDATE UI: Only preview if we actually improved over the original pre-opt.
            if (isScoreBetter(testScore, startScore)) {
                wires = globalBestWires;
                render();
                updateStats();
                await new Promise(r => setTimeout(r, 0)); // Let browser paint
            } else {
                restoreBoardState(startPreviewSnapshot);
            }
        }
        else if (isLocalBest) {
            // Made progress, but didn't beat the absolute high score
            localBestScore = testScore;
            localBestComps = saveComps();
            stagnation = 0;
            const msg = `Iter ${iter}: Local improvement — ${formatScore(testScore)}`;
            console.log(`[Iter ${iter}] Local improvement. ${formatScore(testScore)}`);
            setProg((iter / MAX_ITERS) * 100, msg);
        }
        else {
            // Dead end. Increase frustration.
            stagnation++;
        }

        // Always yield event loop to keep the browser responsive
        await new Promise(r => setTimeout(r, 0));

        // Restore the virtual search state after UI-space evaluation/preview.
        restoreComps(preEval);
        wires = preEvalWires;
    }

    // --- 3. CLEANUP & RESTORE ---
    restoreComps(globalBestComps);
    wires = globalBestWires;

    // Always end in UI board dimensions.
    COLS = uiCols;
    ROWS = uiRows;
    document.getElementById('bCols').value = COLS;
    document.getElementById('bRows').value = ROWS;
    applyBoard();

    // Only translate to the UI corner after we're done searching.
    translateFootprintToTopLeftUI();

    // Commit only if strictly improved vs start.
    const finalScore = scoreState(wires);
    if (!isScoreBetter(finalScore, startScore)) {
        restoreBoardState(startSnapshot);
        showOverlay(false);
        gCancelOp = null;
        toast('Optimization found no improvement', 'inf');
        return;
    }

    showOverlay(false);
    setBestLine('');
    render(); updateStats(); saveState();
    gCancelOp = null;
    if (gCancelRequested) toast('Optimization cancelled — kept best so far', 'inf');
    else toast(`Optimization complete!`, "ok");
}

window.doPlateauExplore = async function () {
    if (!components.length) { toast('No components loaded', 'warn'); return; }

    gCancelRequested = false;
    gCancelOp = 'Plateau';

    const startSnapshot = snapshotBoardState();
    showOverlay(true);
    ostep(2);

    let bestWires = await route(components, COLS, ROWS, () => { }, false, () => gCancelRequested);
    let bestScore = scoreState(bestWires);
    const startScore = bestScore;
    wires = bestWires;
    render();
    updateStats();

    let bestMsg = `Best: ${formatScore(bestScore)}`;
    setBestLine(bestMsg);

    const visited = new Set();
    visited.add(stateKeyForPlateau());
    let lastPickedCompId = null;

    const MAX_STEPS = 10;
    const MAX_NEIGHBORS_PER_COMP = 12;
    const MAX_ROUTINGS_PER_STEP = 35;

    for (let step = 1; step <= MAX_STEPS; step++) {
        if (gCancelRequested) break;
        setProg((step / MAX_STEPS) * 100, `Plateau explore: step ${step} / ${MAX_STEPS}`);

        const shrinkRes = await tryShrinkAlongWires(bestScore, COLS, ROWS);
        if (shrinkRes.improved) {
            bestScore = shrinkRes.score;
            bestWires = wires;
            bestMsg = `Best: ${formatScore(bestScore)}`;
            setBestLine(bestMsg);
            render();
            updateStats();
            await new Promise(r => setTimeout(r, 0));
            continue;
        }

        const box = footprintBoxMetrics(wires);
        const baseBox = { area: box.area, perim: box.perim, bounds: box.bounds };

        const neighborsAll = await enumeratePlateauNeighbors(
            baseBox,
            bestScore,
            COLS,
            ROWS,
            MAX_NEIGHBORS_PER_COMP,
            step,
            visited,
            (done, total, tag) => {
                if (gCancelRequested) return;
                setProg((step / MAX_STEPS) * 100, `Plateau explore: step ${step}/${MAX_STEPS} — eval ${Math.min(done, total)}/${total} (${tag})`);
            },
            MAX_ROUTINGS_PER_STEP
        );
        const neighbors = neighborsAll.filter(n => !visited.has(n.key));
        let pick = null;
        for (const n of neighbors) {
            if (gCancelRequested) break;

            restoreComps(n.comps);
            const testWires = await route(components, COLS, ROWS, () => { }, false, () => gCancelRequested);
            n.wires = testWires;
            n.score = scoreState(testWires);

            if (n.score.comp < bestScore.comp) continue;
            if (n.score.area > baseBox.area) continue;
            if (n.score.area === baseBox.area && n.score.perim > baseBox.perim) continue;
            if (!pick) pick = n;
            else {
                const a = n.score;
                const b = pick.score;
                // Greedy: try potentially space-shrinking moves first.
                if (a.area !== b.area) { if (a.area < b.area) pick = n; continue; }
                if (a.perim !== b.perim) { if (a.perim < b.perim) pick = n; continue; }

                // Diversify: if tied on space, prefer changing a different component than last time.
                const aSame = lastPickedCompId !== null && String(n.compId) === String(lastPickedCompId);
                const bSame = lastPickedCompId !== null && String(pick.compId) === String(lastPickedCompId);
                if (aSame !== bSame) { if (!aSame) pick = n; continue; }

                if (a.wl < b.wl) pick = n;
            }
        }

        if (!pick) break;
        restoreComps(pick.comps);
        wires = pick.wires;
        visited.add(pick.key);
        lastPickedCompId = pick.compId;
        bestWires = wires;
        bestScore = pick.score;
        bestMsg = `Best: ${formatScore(bestScore)}`;
        setBestLine(bestMsg);
        render();
        updateStats();
        await new Promise(r => setTimeout(r, 0));
    }

    const finalScore = scoreState(wires);
    if (!isScoreBetter(finalScore, startScore)) {
        restoreBoardState(startSnapshot);
    } else {
        saveState();
    }

    showOverlay(false);
    setBestLine('');
    gCancelOp = null;
    if (gCancelRequested) toast('Plateau explore cancelled — kept best so far', 'inf');
}