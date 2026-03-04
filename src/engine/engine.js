import { route, getAllNets } from './router.js';
import { Grid } from './grid.js';
import { doOptimizeFootprint, doPlateauExplore } from './optimizer.js';
import { scoreState, doRecursivePushPacking, recenterComponents } from './optimizer-algorithms.js';
import { placeInitial } from './initial-placement.js';
import { anneal, moveComp, rotateComp90InPlace } from './placer.js';
import { saveComps, restoreComps, completion } from './state-utils.js';

/**
 * AutorouterEngine - A "Headless" wrapper for the PCB autorouting logic.
 * This class encapsulates state and provides a clean API for the UI.
 */
export class AutorouterEngine {
    constructor(cols = 30, rows = 20) {
        this.components = [];
        this.wires = [];
        this.cols = cols;
        this.rows = rows;
        this.config = {
            maxEpochs: 1,
            maxIters: 100,
            maxTimeMs: 25000,
            saTrigger: 5,
            plateauTrigger: 8,
            deepStagnation: 12
        };

        this.gCancelRequested = false;

        // Callbacks for UI updates
        this.onStateChange = null;
        this.onProgress = null;
        this.onStatusUpdate = null;
        this.onToast = null;
        this.onBestSnapshot = null;
        this.tick = 0;
    }

    setCallbacks({ onStateChange, onProgress, onStatusUpdate, onToast, onBestSnapshot }) {
        if (onStateChange) this.onStateChange = onStateChange;
        if (onProgress) this.onProgress = onProgress;
        if (onStatusUpdate) this.onStatusUpdate = onStatusUpdate;
        if (onToast) this.onToast = onToast;
        if (onBestSnapshot) this.onBestSnapshot = onBestSnapshot;
    }

    setState(newState) {
        if (newState.components) this.components = newState.components;
        if (newState.wires) this.wires = newState.wires;
        if (newState.cols) this.cols = newState.cols;
        if (newState.rows) this.rows = newState.rows;
        this.tick++;
        this.notify();
    }

    notify() {
        this.onStateChange?.({
            components: this.components,
            wires: this.wires,
            cols: this.cols,
            rows: this.rows,
            tick: this.tick
        });
    }

    cancel() {
        this.gCancelRequested = true;
    }

    async optimize() {
        this.gCancelRequested = false;
        const options = {
            onProgress: this.onProgress,
            onStatusUpdate: this.onStatusUpdate,
            onToast: this.onToast,
            checkCancel: () => this.gCancelRequested,
            onStateChange: (state) => {
                this.components = state.components;
                this.wires = state.wires;
                this.tick++;
                this.notify();
            },
            onBestSnapshot: (snapshot) => { this.onBestSnapshot?.(snapshot); }
        };

        const res = await doOptimizeFootprint(
            this.components,
            this.wires,
            this.cols,
            this.rows,
            this.config,
            options
        );

        if (res.improved) {
            this.wires = res.wires;
            this.notify();
        }
    }

    async plateau() {
        this.gCancelRequested = false;
        const options = {
            onProgress: this.onProgress,
            onStatusUpdate: this.onStatusUpdate,
            onToast: this.onToast,
            checkCancel: () => this.gCancelRequested,
            onStateChange: (state) => {
                this.components = state.components;
                this.wires = state.wires;
                this.notify();
            }
        };

        const res = await doPlateauExplore(
            this.components,
            this.wires,
            this.cols,
            this.rows,
            options
        );

        if (res.improved) {
            this.wires = res.wires;
            this.notify();
        }
    }

    async routeOnly() {
        this.gCancelRequested = false;
        const testWires = await route(
            this.components,
            this.cols,
            this.rows,
            (p, m) => this.onProgress?.(p * 100, m),
            () => this.gCancelRequested
        );
        this.wires = testWires;
        this.notify();
        return scoreState(this.components, testWires);
    }

    async placeAndRoute(compDefs, autoOptimize = false) {
        if (!compDefs || compDefs.length === 0) {
            this.onToast?.('No components to place', 'warn');
            return;
        }

        this.gCancelRequested = false;
        const maxAttempts = 100;
        let bestWires = null;
        let bestComps = null;
        let bestCompletion = 0;

        this.onStatusUpdate?.({ title: 'Initializing...' });
        this.onProgress?.(0, 'Starting placement...');

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (this.gCancelRequested) break;

            this.onStatusUpdate?.({ title: `Attempt ${attempt}/${maxAttempts}` });

            // 1. Initial random placement centered around 0,0
            const currentComponents = placeInitial(compDefs, 0, 0);
            recenterComponents(currentComponents, null);

            // 2. Simulated Annealing
            await anneal(currentComponents, this.cols, this.rows, (p, s) => {
                recenterComponents(currentComponents, null);
                this.onProgress?.(p * 100, `[${attempt}/${maxAttempts}] SA — ${s}`);
            }, () => this.gCancelRequested);

            if (this.gCancelRequested) break;

            // 3. Routing
            const candidateWires = await route(
                currentComponents, this.cols, this.rows,
                (p, s) => { this.onProgress?.(p * 100, `[${attempt}/${maxAttempts}] Route — ${s}`); },
                () => this.gCancelRequested
            );
            recenterComponents(currentComponents, candidateWires);

            const c = completion(candidateWires);
            if (c > bestCompletion) {
                bestCompletion = c;
                bestWires = candidateWires;
                bestComps = saveComps(currentComponents);
            }

            if (c === 1.0) break; // Found 100% solution
        }

        if (bestComps) {
            this.components = placeInitial(compDefs, this.cols, this.rows); // Reset structure
            restoreComps(this.components, bestComps);
            this.wires = bestWires;

            this.notify();
            if (bestCompletion < 1.0) {
                this.onToast?.(`Best completion: ${Math.round(bestCompletion * 100)}%`, 'warn');
            }
        }
    }

    moveComponent(id, ox, oy) {
        const c = this.components.find(x => x.id === id);
        if (c) {
            moveComp(c, ox, oy);
            if (this.wires.length > 0) {
                this.updateIncrementalWires(c);
            }
            this.components = [...this.components];
            this.tick++;
            this.notify();
        }
    }

    rotateComponent(id) {
        const c = this.components.find(x => x.id === id);
        if (c) {
            rotateComp90InPlace(c);
            if (this.wires.length > 0) {
                this.updateIncrementalWires(c);
            }
            this.components = [...this.components];
            this.tick++;
            this.notify();
        }
    }

    updateIncrementalWires(movedComp) {
        const affectedNets = new Set(movedComp.pins.map(p => p.net).filter(Boolean));
        if (affectedNets.size === 0) return;

        // 1. Filter existing wires
        this.wires = this.wires.filter(w => {
            if (affectedNets.has(w.net)) return false;
            if (w.failed) return true;
            if (!movedComp.routeUnder) {
                return !w.path.some(pt =>
                    pt.col >= movedComp.ox && pt.col < movedComp.ox + movedComp.w &&
                    pt.row >= movedComp.oy && pt.row < movedComp.oy + movedComp.h
                );
            }
            return true;
        });

        // 2. Setup grid for current state
        let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
        if (this.components.length > 0) {
            this.components.forEach(c => {
                minCol = Math.min(minCol, c.ox); maxCol = Math.max(maxCol, c.ox + c.w - 1);
                minRow = Math.min(minRow, c.oy); maxRow = Math.max(maxRow, c.oy + c.h - 1);
            });
        } else {
            minCol = 0; maxCol = 50; minRow = 0; maxRow = 50;
        }

        const pad = 15;
        const gridMinC = minCol - pad;
        const gridMinR = minRow - pad;
        const gridCols = (maxCol - minCol + 1) + pad * 2;
        const gridRows = (maxRow - minRow + 1) + pad * 2;

        const grid = new Grid(gridCols, gridRows, gridMinC, gridMinR);
        this.components.forEach(comp => grid.registerComp(comp));
        this.wires.forEach(w => { if (!w.failed) grid.markWire(w.path); });

        // 3. Reroute affected nets
        const allNets = getAllNets(this.components);
        const toRoute = allNets.filter(n => affectedNets.has(n.net));

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
                    this.wires.push({ net: net.net, path: result.path, failed: false });
                    grid.markWire(result.path);
                    result.path.forEach(pt => routedIndices.add(grid.idx(pt.col, pt.row)));
                    const hitIdx = pins.findIndex(p => grid.idx(p.col, p.row) === result.hitTargetIdx);
                    if (hitIdx !== -1) pins.splice(hitIdx, 1);
                } else {
                    const failPin = pins.shift();
                    this.wires.push({
                        net: net.net,
                        path: [{ col: first.col, row: first.row }, { col: failPin.col, row: failPin.row }],
                        failed: true
                    });
                }
            }
        }
    }

    initializeBoard(compDefs) {
        this.components = placeInitial(compDefs, this.cols, this.rows);
        this.wires = [];
        this.notify();
    }
}
