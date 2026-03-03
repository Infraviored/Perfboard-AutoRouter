
window.runBenchmarkStrategy = async function (runs = 3, overrideConfig = {}) {
    const raw = document.getElementById('jsonInput').value.trim();
    if (!raw) { console.error("Load a circuit JSON first!"); return; }

    if (overrideConfig) {
        Object.assign(window.packerConfig, overrideConfig);
    }

    console.log(`============= BENCHMARK START =============`);
    console.log(`Config:`, window.packerConfig);
    console.log(`Runs: ${runs}`);

    let bestScore = null;
    let bestRun = -1;
    let bestComps = null;
    let bestWires = null;
    let totalPrTime = 0, totalOptTime = 0;

    for (let i = 1; i <= runs; i++) {
        console.log(`\n--- Run ${i} / ${runs} ---`);
        loadComponents(); // Load fresh positions
        await new Promise(r => setTimeout(r, 100)); // allow DOM refresh

        const t0 = performance.now();
        await doPlaceAndRoute();
        const t1 = performance.now();
        const prTime = t1 - t0;

        await new Promise(r => setTimeout(r, 100));

        const t2 = performance.now();
        await doOptimizeFootprint();
        const t3 = performance.now();
        const optTime = t3 - t2;

        const score = scoreState(wires);
        console.log(`Run ${i} Result: P&R ${Math.round(prTime)}ms, Opt ${Math.round(optTime)}ms => ${formatScore(score)}`);

        totalPrTime += prTime;
        totalOptTime += optTime;

        if (!bestScore || isScoreBetter(score, bestScore)) {
            bestScore = score;
            bestRun = i;
            bestComps = saveComps();
            bestWires = wires;
        }
    }

    console.log(`\n============= BENCHMARK END =============`);
    console.log(`Average P&R time: ${Math.round(totalPrTime / runs)}ms`);
    console.log(`Average Optimization time: ${Math.round(totalOptTime / runs)}ms`);
    console.log(`Best Run: #${bestRun} => ${formatScore(bestScore)}`);

    // Restore the best result visually
    restoreComps(bestComps);
    wires = bestWires;
    render(); updateStats();
};

window.runStrategyMatrix = async function () {
    let configs = [];
    try {
        const resp = await fetch('benchmark_strategies.json');
        configs = await resp.json();
    } catch (e) {
        console.warn("Could not load benchmark_strategies.json, using defaults", e);
        configs = [
            { name: "Default", maxIters: 150, saTrigger: 5, plateauTrigger: 8, deepStagnation: 12, maxTimeMs: 25000 }
        ];
    }

    const runsPerConfig = 3;
    const raw = document.getElementById('jsonInput').value.trim();
    if (!raw) { console.error("Load a circuit JSON first!"); return; }

    const logToLocal = async (line) => {
        try {
            await fetch('http://127.0.0.1:3001', {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain' },
                body: typeof line === 'string' ? line : JSON.stringify(line)
            });
        } catch (e) {
            console.warn("Failed to log to local server (is logger.js running?):", e);
        }
    };

    let summary = [];
    const startMsg = "Starting Strategy Matrix...";
    console.log(`%c${startMsg}`, "color: #00e676; font-size: 16px; font-weight: bold;");
    await logToLocal(`=== BENCHMARK START: ${new Date().toLocaleString()} ===`);

    for (let c of configs) {
        if (gCancelRequested) break;
        console.log(`\n%c--- Testing Strategy: ${c.name} ---`, "color: #40c4ff; font-weight: bold;");
        await logToLocal(`Strategy: ${c.name} | Parameters: ${JSON.stringify(c)}`);

        // Override globals
        window.packerConfig = c;

        let bestScore = null;
        let totalOptTime = 0;

        for (let i = 1; i <= runsPerConfig; i++) {
            if (gCancelRequested) break;

            // Reset to initial JSON state
            loadComponents();
            await new Promise(r => setTimeout(r, 100));

            // Initial Placement
            await doPlaceAndRoute();
            await new Promise(r => setTimeout(r, 100));

            // Optimization
            const t0 = performance.now();
            await doOptimizeFootprint();
            const t1 = performance.now();

            const score = scoreState(wires);
            const elapsed = t1 - t0;
            totalOptTime += elapsed;

            const resLine = `Run ${i}: ${Math.round(elapsed / 1000)}s => ${formatScore(score)}`;
            console.log(`   ${resLine}`);
            await logToLocal(`   [${c.name}] ${resLine}`);

            if (!bestScore || isScoreBetter(score, bestScore)) {
                bestScore = score;
            }
        }
        if (gCancelRequested) break;

        summary.push({
            "Strategy": c.name,
            "Avg Time(s)": (totalOptTime / runsPerConfig / 1000).toFixed(1),
            "Area": bestScore.area,
            "Perim": bestScore.perim,
            "WL": bestScore.wl
        });
    }

    console.log(`\n%c============= MATRIX RESULTS =============`, "color: #ff9800; font-weight: bold; font-size: 14px;");
    console.table(summary);
    await logToLocal("SUMMARY RESULTS:");
    await logToLocal(summary);
    await logToLocal("=== BENCHMARK END ===");

    return "Testing Complete. Check the summary table and benchmark_results.log!";
};
