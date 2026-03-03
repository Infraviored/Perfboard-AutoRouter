
// ── STATE MANAGEMENT ──
let stateHistory = [];
let currentStateIndex = -1;

function initializeState() {
    const savedState = localStorage.getItem('autorouterState');
    if (savedState) {
        try {
            const state = JSON.parse(savedState);
            stateHistory = state.history || [];
            currentStateIndex = state.index || -1;

            if (currentStateIndex >= 0 && stateHistory[currentStateIndex]) {
                restoreState(stateHistory[currentStateIndex]);
            }
        } catch (e) {
            console.error('Failed to load saved state:', e);
            resetState();
        }
    } else {
        resetState();
    }
}

function resetState() {
    stateHistory = [];
    currentStateIndex = -1;
    COLS = 40;
    ROWS = 30;
    document.getElementById('bCols').value = COLS;
    document.getElementById('bRows').value = ROWS;
    components = []; wires = []; compDefs = [];
    saveState();
}

function saveState() {
    const state = {
        boardSize: { cols: COLS, rows: ROWS },
        components: components.map(c => ({
            id: c.id,
            name: c.name,
            value: c.value,
            color: c.color,
            ox: c.ox, oy: c.oy, w: c.w, h: c.h, routeUnder: !!c.routeUnder,
            pins: c.pins.map(p => ({
                dCol: p.dCol, dRow: p.dRow, col: p.col, row: p.row, net: p.net, lbl: p.lbl
            }))
        })),
        wires: wires.map(w => ({
            net: w.net, failed: w.failed, path: w.path || []
        })),
        compDefs: structuredClone(compDefs),
        timestamp: Date.now()
    };

    stateHistory = stateHistory.slice(0, currentStateIndex + 1);
    stateHistory.push(state);
    currentStateIndex++;

    if (stateHistory.length > 50) {
        stateHistory.shift();
        currentStateIndex--;
    }

    localStorage.setItem('autorouterState', JSON.stringify({
        history: stateHistory, index: currentStateIndex
    }));
}

function restoreState(state) {
    COLS = state.boardSize.cols;
    ROWS = state.boardSize.rows;
    document.getElementById('bCols').value = COLS;
    document.getElementById('bRows').value = ROWS;

    const defsById = new Map((state.compDefs || compDefs || []).map(cd => [cd.id, cd]));
    components = state.components.map(c => {
        const def = defsById.get(c.id);
        const out = {
            ...c,
            name: c.name ?? def?.name ?? '?',
            value: c.value ?? def?.value ?? '',
            color: c.color ?? def?.color ?? '#222a22',
            routeUnder: !!(c.routeUnder ?? def?.routeUnder),
            pins: (c.pins || []).map(p => {
                const pp = { ...p };
                if (pp.lbl === undefined) pp.lbl = pp.label;
                if (pp.lbl === undefined) pp.lbl = '';
                if (pp.net === undefined) pp.net = null;
                return pp;
            })
        };
        return out;
    });

    wires = state.wires.map(w => ({
        ...w, path: w.path || []
    }));

    compDefs = state.compDefs ? structuredClone(state.compDefs) : [];

    applyBoard(); // CHANGED: Must call this so SVG actually resizes!
    render();
    updateStats();
    renderNetPanel();
    renderCompList();
}

function goBackState() {
    if (currentStateIndex > 0) {
        currentStateIndex--;
        restoreState(stateHistory[currentStateIndex]);
        localStorage.setItem('autorouterState', JSON.stringify({ history: stateHistory, index: currentStateIndex }));
        toast('Reverted to previous state', 'ok');
    } else toast('No previous state', 'warn');
}

function goForwardState() {
    if (currentStateIndex < stateHistory.length - 1) {
        currentStateIndex++;
        restoreState(stateHistory[currentStateIndex]);
        localStorage.setItem('autorouterState', JSON.stringify({ history: stateHistory, index: currentStateIndex }));
        toast('Advanced to next state', 'ok');
    } else toast('No next state', 'warn');
}

function exportCompleteState() {
    const state = {
        boardSize: { cols: COLS, rows: ROWS },
        components: components.map(c => ({
            id: c.id,
            name: c.name,
            value: c.value,
            color: c.color,
            ox: c.ox, oy: c.oy, w: c.w, h: c.h, routeUnder: !!c.routeUnder,
            pins: c.pins.map(p => ({
                dCol: p.dCol, dRow: p.dRow, col: p.col, row: p.row, net: p.net, lbl: p.lbl
            }))
        })),
        wires: wires.map(w => ({ net: w.net, failed: w.failed, path: w.path || [] })),
        compDefs: structuredClone(compDefs),
        timestamp: Date.now(),
        version: '1.0'
    };

    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autorouter-complete-state-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Complete state exported', 'ok');
}

function saveComps() {
    return components.map(c => ({
        id: c.id, ox: c.ox, oy: c.oy, w: c.w, h: c.h,
        pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }))
    }));
}

function restoreComps(saved) {
    saved.forEach(s => {
        const comp = components.find(c => c.id === s.id);
        if (comp) {
            comp.ox = s.ox; comp.oy = s.oy;
            comp.w = s.w; comp.h = s.h;

            comp.pins.forEach((p, idx) => {
                p.dCol = s.pins[idx].dCol;
                p.dRow = s.pins[idx].dRow;
                p.col = comp.ox + p.dCol;
                p.row = comp.oy + p.dRow;
            });
        }
    });
}

function snapshotBoardState() {
    return {
        boardSize: { cols: COLS, rows: ROWS },
        components: structuredClone(components),
        wires: structuredClone(wires),
        compDefs: structuredClone(compDefs)
    };
}

function restoreBoardState(s) {
    COLS = s.boardSize.cols;
    ROWS = s.boardSize.rows;
    document.getElementById('bCols').value = COLS;
    document.getElementById('bRows').value = ROWS;
    components = structuredClone(s.components);
    wires = structuredClone(s.wires);
    compDefs = structuredClone(s.compDefs);
    applyBoard();
    render();
    updateStats();
    renderNetPanel();
    renderCompList();
}

function completion(wires) {
    if (!wires.length) return 0;
    const successful = wires.filter(w => !w.failed).length;
    return successful / wires.length;
}
