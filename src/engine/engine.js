import { doOptimizeFootprint, doPlateauExplore } from './optimizer.js';
import { route } from './router.js';
import { scoreState } from './optimizer-algorithms.js';
import { placeInitial } from './initial-placement.js';

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
    }

    setCallbacks({ onStateChange, onProgress, onStatusUpdate, onToast }) {
        if (onStateChange) this.onStateChange = onStateChange;
        if (onProgress) this.onProgress = onProgress;
        if (onStatusUpdate) this.onStatusUpdate = onStatusUpdate;
        if (onToast) this.onToast = onToast;
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
            }
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
            this.components = this.components; // already updated by callback
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
            false,
            () => this.gCancelRequested
        );
        this.wires = testWires;
        this.notify();
        return scoreState(this.components, testWires);
    }

    initializeBoard(compDefs) {
        this.components = placeInitial(compDefs, this.cols, this.rows);
        this.wires = [];
        this.notify();
    }
}
