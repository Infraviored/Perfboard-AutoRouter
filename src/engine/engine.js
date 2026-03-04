import { route } from './router.js';
import { doOptimizeFootprint, doPlateauExplore } from './optimizer.js';
import { scoreState, doRecursivePushPacking } from './optimizer-algorithms.js';
import { placeInitial } from './initial-placement.js';
import { anneal } from './placer.js';
import { saveComps, restoreComps, completion } from './state-utils.js';

/**
 * AutorouterEngine - A "Headless" wrapper for the PCB autorouting logic.
 * This class encapsulates state and provides a clean API for the UI.
 */
export class AutorouterEngine {
    constructor(cols = 22, rows = 16) {
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
        this.notify();
    }

    notify() {
        this.onStateChange?.({
            components: this.components,
            wires: this.wires,
            cols: this.cols,
            rows: this.rows
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

    async placeAndRoute(compDefs, autoOptimize = true) {
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

            // 1. Initial random placement
            const currentComponents = placeInitial(compDefs, this.cols, this.rows);

            // 2. Simulated Annealing
            await anneal(currentComponents, this.cols, this.rows, (p, s) => {
                this.onProgress?.(p * 100, `[${attempt}/${maxAttempts}] SA — ${s}`);
            }, () => this.gCancelRequested);

            if (this.gCancelRequested) break;

            // 3. Routing
            const candidateWires = await route(
                currentComponents, this.cols, this.rows,
                (p, s) => { this.onProgress?.(p * 100, `[${attempt}/${maxAttempts}] Route — ${s}`); },
                () => this.gCancelRequested
            );

            const c = completion(candidateWires);
            if (c > bestCompletion) {
                bestCompletion = c;
                bestWires = candidateWires;
                bestComps = saveComps(currentComponents);

                // Push status message and snapshot to bottom bar
                const currentScore = scoreState(currentComponents, candidateWires);
                this.onStatusUpdate?.({ best: `Best: ${Math.round(bestCompletion * 100)}% (WL ${currentScore.wl})` });

                const snapshotComps = currentComponents.map(comp => ({
                    ...comp,
                    pins: comp.pins.map(p => ({ ...p, col: comp.ox + p.dCol, row: comp.oy + p.dRow }))
                }));
                this.onBestSnapshot?.({ components: snapshotComps, wires: [...candidateWires] });
            }

            if (c === 1.0) break; // Found 100% solution
        }

        if (bestComps) {
            this.components = placeInitial(compDefs, this.cols, this.rows); // Reset structure
            restoreComps(this.components, bestComps);
            this.wires = bestWires;

            if (bestCompletion === 1.0 && autoOptimize) {
                this.onProgress?.(0, 'Optimizing footprint...');
                const res = await doRecursivePushPacking(this.components, this.wires, this.cols, this.rows, () => this.gCancelRequested);
                this.wires = res.wires;
            }

            this.notify();
            if (bestCompletion === 1.0) {
                this.onToast?.('Perfect routing achieved!', 'ok');
            } else {
                this.onToast?.(`Best completion: ${Math.round(bestCompletion * 100)}%`, 'warn');
            }
        }
    }

    initializeBoard(compDefs) {
        this.components = placeInitial(compDefs, this.cols, this.rows);
        this.wires = [];
        this.notify();
    }
}
