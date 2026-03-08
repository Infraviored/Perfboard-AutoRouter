import { route, incrementalReroute } from './router.js';
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
        this.onBestSnapshot = null;
        this.tick = 0;
    }

    setCallbacks({ onStateChange, onProgress, onStatusUpdate, onBestSnapshot }) {
        if (onStateChange) this.onStateChange = onStateChange;
        if (onProgress) this.onProgress = onProgress;
        if (onStatusUpdate) this.onStatusUpdate = onStatusUpdate;
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

        this.wires = res.wires || this.wires;
        this.notify();
        return res;
    }

    async plateau() {
        this.gCancelRequested = false;
        const options = {
            onProgress: this.onProgress,
            onStatusUpdate: this.onStatusUpdate,
            checkCancel: () => this.gCancelRequested,
            onStateChange: (state) => {
                this.components = state.components;
                this.wires = state.wires;
                this.tick++;
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

        this.wires = res.wires || this.wires;
        this.notify();
        return res;
    }

    async routeOnly() {
        this.gCancelRequested = false;
        const testWires = await route(
            this.components,
            this.cols,
            this.rows,
            (p, m) => this.onProgress?.(p * 100, m),
            () => this.gCancelRequested,
            this.wires
        );
        this.wires = testWires;
        this.notify();
        return scoreState(this.components, testWires);
    }

    async route() {
        this.gCancelRequested = false;
        this.onStatusUpdate?.({ title: 'Rerouting...', isProcessing: true });
        const manualOnly = this.wires.filter(w => w.manual);
        const res = await route(
            this.components,
            this.cols,
            this.rows,
            (p, m) => this.onProgress?.(p * 100, m),
            () => this.gCancelRequested,
            manualOnly
        );
        this.wires = res;
        this.onStatusUpdate?.({ isProcessing: false });
        this.notify();
        return res;
    }

    async placeAndRoute(compDefs) {
        if (!compDefs || compDefs.length === 0) {
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
            const startScore = scoreState(this.components, this.wires);
            this.components = placeInitial(compDefs, this.cols, this.rows); // Reset structure
            restoreComps(this.components, bestComps);
            this.wires = bestWires;

            this.notify();
            const finalScore = scoreState(this.components, this.wires);
            return { score: finalScore, startScore };
        }
        return null;
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
        const { success, wires } = incrementalReroute(this.components, this.wires, movedComp);
        this.wires = wires;
    }

    async previewManualRoute(startPin, currentPos, targetNet = null) {
        // Fast A* for single path
        let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
        this.components.forEach(c => {
            minCol = Math.min(minCol, c.ox); maxCol = Math.max(maxCol, c.ox + c.w - 1);
            minRow = Math.min(minRow, c.oy); maxRow = Math.max(maxRow, c.oy + c.h - 1);
        });
        const pad = 15;
        const gridMinC = Math.min(minCol - pad, startPin.pin.col, currentPos.col);
        const gridMinR = Math.min(minRow - pad, startPin.pin.row, currentPos.row);
        const gridCols = Math.max(maxCol - minCol + pad * 2, Math.abs(currentPos.col - gridMinC) + pad, Math.abs(startPin.pin.col - gridMinC) + pad);
        const gridRows = Math.max(maxRow - minRow + pad * 2, Math.abs(currentPos.row - gridMinR) + pad, Math.abs(startPin.pin.row - gridMinR) + pad);

        const grid = new Grid(gridCols, gridRows, gridMinC, gridMinR);
        this.components.forEach(c => grid.registerComp(c));

        const startNet = startPin.pin.net;
        const startIndices = new Set([grid.idx(startPin.pin.col, startPin.pin.row)]);
        const targetIndices = [grid.idx(currentPos.col, currentPos.row)];

        this.wires.forEach(w => {
            if (!w.failed && w.path) {
                const isStartNet = startNet && w.net === startNet;
                const isTargetNet = targetNet && w.net === targetNet;

                if (isStartNet || isTargetNet) {
                    // Same net: don't block. Also add as valid start/end points
                    w.path.forEach(pt => {
                        if (grid.inBounds(pt.col, pt.row)) {
                            const kidx = grid.idx(pt.col, pt.row);
                            if (isStartNet) startIndices.add(kidx);
                            if (isTargetNet) targetIndices.push(kidx);
                        }
                    });
                } else {
                    grid.markWire(w.path);
                }
            }
        });

        const res = grid.astarMultiTarget(startIndices, targetIndices, true);
        return res ? res.path : null;
    }

    initializeBoard(compDefs) {
        this.components = placeInitial(compDefs, this.cols, this.rows);
        this.wires = [];
        this.notify();
    }

    deleteComponent(id) {
        // Collect all nets associated with the component being deleted
        const comp = this.components.find(c => c.id === id);
        const affectedNets = new Set();
        if (comp && Array.isArray(comp.pins)) {
            comp.pins.forEach(p => {
                if (p && p.net != null) {
                    affectedNets.add(p.net);
                }
            });
        }

        // Remove the component itself
        this.components = this.components.filter(c => c.id !== id);

        // For nets touched by this component, remove wires if the net
        // no longer has at least two pins remaining on the board.
        if (affectedNets.size > 0) {
            const netPinCounts = new Map();

            // Recompute pin counts for affected nets across remaining components
            this.components.forEach(c => {
                if (!Array.isArray(c.pins)) return;
                c.pins.forEach(p => {
                    if (!p || p.net == null) return;
                    if (!affectedNets.has(p.net)) return;
                    const current = netPinCounts.get(p.net) || 0;
                    netPinCounts.set(p.net, current + 1);
                });
            });

            // Drop wires whose nets have fewer than 2 remaining pins
            this.wires = this.wires.filter(w => {
                if (!w || w.net == null) return true;
                if (!affectedNets.has(w.net)) return true;
                const count = netPinCounts.get(w.net) || 0;
                return count >= 2;
            });
        }
        this.tick++;
        this.notify();
    }

    deleteWire(net) {
        this.wires = this.wires.filter(w => w.net !== net);
        this.tick++;
        this.notify();
    }

    updatePinNet(compId, pinIdx, net) {
        const c = this.components.find(x => x.id === compId);
        if (c && c.pins[pinIdx]) {
            c.pins[pinIdx].net = net;
            this.tick++;
            this.notify();
        }
    }

    addManualWire(net, path) {
        this.wires.push({ net, path, failed: false, manual: true });
        this.tick++;
        this.notify();
    }

    mergeNets(oldNet, newNet) {
        if (!oldNet || !newNet || oldNet === newNet) return;
        // Update pins
        this.components.forEach(c => {
            c.pins.forEach(p => {
                if (p.net === oldNet) p.net = newNet;
            });
        });
        // Update wires
        this.wires.forEach(w => {
            if (w.net === oldNet) w.net = newNet;
        });
        this.tick++;
        this.notify();
    }
}
