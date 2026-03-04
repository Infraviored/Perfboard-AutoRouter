import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AutorouterEngine } from './engine/engine.js';
import { PcbCanvas } from './components/PcbCanvas.jsx';
import { Topbar } from './components/Topbar.jsx';
import { SidebarLeft } from './components/SidebarLeft.jsx';
import { SidebarRight } from './components/SidebarRight.jsx';
import { ProcessingBar } from './components/ProcessingBar.jsx';
import { Toast } from './components/Toast.jsx';
import { LibraryOverlay } from './components/LibraryOverlay.jsx';
import { CompEditorOverlay } from './components/CompEditorOverlay.jsx';
import { PromptOverlay } from './components/PromptOverlay.jsx';
import { TEMPLATE, processTemplate } from './engine/templates.js';
import { getAllNets } from './engine/router.js';
import { scoreState } from './engine/optimizer-algorithms.js';

function App() {
  // --- ENGINE ---
  const engine = useMemo(() => {
    const saved = localStorage.getItem('pcb_board_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return new AutorouterEngine(parsed.cols || 30, parsed.rows || 20);
      } catch (e) { }
    }
    return new AutorouterEngine(30, 20);
  }, []);

  // --- STATE ---
  const [board, setBoard] = useState(() => {
    const saved = localStorage.getItem('pcb_board_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          components: parsed.components || [],
          wires: parsed.wires || [],
          cols: parsed.cols || 30,
          rows: parsed.rows || 20,
          tick: 0
        };
      } catch (e) { }
    }
    return { components: [], wires: [], cols: 30, rows: 20, tick: 0 };
  });

  const [jsonInput, setJsonInput] = useState(() => {
    return localStorage.getItem('pcb_json_input') || '';
  });

  // Sync board to engine on first load if engine was initialized with defaults but localStorage had values
  useEffect(() => {
    engine.setState({
      components: board.components,
      wires: board.wires,
      cols: board.cols,
      rows: board.rows
    });
  }, []);

  // Persist to localStorage
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('pcb_board_state', JSON.stringify({
        components: board.components,
        wires: board.wires,
        cols: board.cols,
        rows: board.rows
      }));
    }, 500);
    return () => clearTimeout(timer);
  }, [board.components, board.wires, board.cols, board.rows]);

  useEffect(() => {
    localStorage.setItem('pcb_json_input', jsonInput);
  }, [jsonInput]);

  const [status, setStatus] = useState({ title: '', progress: 0, best: '', isProcessing: false });
  const [toast, setToast] = useState({ msg: '', type: 'ok' });
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredNet, setHoveredNet] = useState(null);
  const [autoOptimize, setAutoOptimize] = useState(true);
  const [tool, setTool] = useState('sel');
  const [bestSnapshot, setBestSnapshot] = useState(null);


  // Modal states
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [editingComp, setEditingComp] = useState(null);

  // History for Undo/Redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // --- ACTIONS ---
  const saveHistory = useCallback(() => {
    const snap = JSON.stringify({
      components: engine.components,
      wires: engine.wires,
      cols: engine.cols,
      rows: engine.rows
    });
    setHistory(prev => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(snap);
      if (next.length > 30) next.shift();
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [engine, historyIndex]);

  const handleLoadTemplate = useCallback(() => {
    setJsonInput(JSON.stringify(TEMPLATE, null, 2));
    const defs = processTemplate(TEMPLATE);
    engine.initializeBoard(defs);
    saveHistory();
  }, [engine, saveHistory]);

  const handleLoadCircuit = useCallback(() => {
    try {
      const data = JSON.parse(jsonInput);
      const defs = processTemplate(data);
      if (defs) {
        engine.initializeBoard(defs);
        saveHistory();
      }
    } catch (e) {
      setToast({ msg: 'Parse error: ' + e.message, type: 'err' });
    }
  }, [engine, jsonInput, saveHistory]);

  const handlePlaceAndRoute = useCallback(async () => {
    setBestSnapshot(null);
    setStatus(prev => ({ ...prev, isProcessing: true }));
    try {
      const data = JSON.parse(jsonInput);
      const defs = processTemplate(data);
      await engine.placeAndRoute(defs, autoOptimize);
    } catch (e) {
      setToast({ msg: 'Error: ' + e.message, type: 'err' });
    }
    setStatus(prev => ({ ...prev, isProcessing: false, title: '', best: '' }));
    saveHistory();
  }, [engine, jsonInput, autoOptimize, saveHistory]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prev = JSON.parse(history[historyIndex - 1]);
      engine.setState(prev);
      setHistoryIndex(historyIndex - 1);
    }
  }, [history, historyIndex, engine]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = JSON.parse(history[historyIndex + 1]);
      engine.setState(next);
      setHistoryIndex(historyIndex + 1);
    }
  }, [history, historyIndex, engine]);

  const handleCopyPrompt = useCallback(() => {
    const prompt = `Act as an expert electronics designer. Generate a JSON circuit definition for the following request: "Simple ESP32 power controller with relay".
Use this format:
{
  "components": [
    { "id": "U1", "name": "ESP32", "pins": [{"offset": [0,0], "label": "GND", "net": "GND"}] }
  ]
}`;
    navigator.clipboard.writeText(prompt);
    setToast({ msg: 'Prompt template copied!', type: 'ok' });
  }, []);

  const handleRouteOnly = useCallback(async () => {
    setStatus(prev => ({ ...prev, isProcessing: true }));
    await engine.routeOnly();
    setStatus(prev => ({ ...prev, isProcessing: false, title: '', best: '' }));
    saveHistory();
  }, [engine, saveHistory]);

  const handleOptimizeFootprint = useCallback(async () => {
    setBestSnapshot(null);
    setStatus(prev => ({ ...prev, isProcessing: true }));
    await engine.optimize();
    setStatus(prev => ({ ...prev, isProcessing: false, title: '', best: '' }));
    setBestSnapshot(null);
    saveHistory();
  }, [engine, saveHistory]);

  const handlePlateauExplore = useCallback(async () => {
    setBestSnapshot(null);
    setStatus(prev => ({ ...prev, isProcessing: true }));
    await engine.plateau();
    setStatus(prev => ({ ...prev, isProcessing: false, title: '', best: '' }));
    setBestSnapshot(null);
    saveHistory();
  }, [engine, saveHistory]);

  const handleClearWires = useCallback(() => {
    engine.setState({ wires: [] });
    saveHistory();
  }, [engine, saveHistory]);

  const handleMoveComp = useCallback((id, ox, oy) => {
    engine.moveComponent(id, ox, oy);
  }, [engine]);

  const handleRotateComp = useCallback((id) => {
    engine.rotateComponent(id);
    saveHistory();
  }, [engine, saveHistory]);

  const handleReset = useCallback(() => {
    if (window.confirm('Reset everything?')) handleLoadTemplate();
  }, [handleLoadTemplate]);

  const handleAddFromLibrary = useCallback((compDef) => {
    const newId = `C${board.components.length + 1}`;
    let mw = 0, mh = 0;
    compDef.pins.forEach(p => {
      mw = Math.max(mw, p.offset[0] + 1);
      mh = Math.max(mh, p.offset[1] + 1);
    });

    let cx = 5, cy = 5;
    if (board.components.length > 0) {
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      board.components.forEach(c => {
        minC = Math.min(minC, c.ox); maxC = Math.max(maxC, c.ox + c.w);
        minR = Math.min(minR, c.oy); maxR = Math.max(maxR, c.oy + c.h);
      });
      cx = Math.floor((minC + maxC) / 2) + Math.floor(Math.random() * 5);
      cy = Math.floor((minR + maxR) / 2) + Math.floor(Math.random() * 5);
    }

    const newComp = {
      id: newId, name: compDef.name, value: compDef.value, color: compDef.color,
      w: mw, h: mh, ox: cx, oy: cy,
      pins: compDef.pins.map(p => ({
        dCol: p.offset[0], dRow: p.offset[1],
        col: cx + p.offset[0], row: cy + p.offset[1],
        lbl: p.label, net: ''
      }))
    };
    engine.setState({ components: [...board.components, newComp], wires: [] });
    setIsLibraryOpen(false);
    setSelectedId(newId);
    saveHistory();
  }, [board.components, engine, saveHistory]);

  const handleSaveEdit = useCallback((updated) => {
    engine.setState({ components: board.components.map(c => c.id === updated.id ? updated : c), wires: [] });
    setIsEditorOpen(false);
    saveHistory();
    setToast({ msg: 'Component saved', type: 'ok' });
  }, [board.components, engine, saveHistory]);


  const handleExportState = useCallback(() => {
    const state = { components: board.components, wires: board.wires };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'pcb_circuit.json'; a.click();
    URL.revokeObjectURL(url);
  }, [board]);

  // --- ENGINE SYNC ---
  useEffect(() => {
    engine.setCallbacks({
      onStateChange: (newState) => setBoard(prev => ({ ...prev, ...newState })),
      onProgress: (p, t) => setStatus(prev => ({ ...prev, progress: p, title: t })),
      onStatusUpdate: (upd) => setStatus(prev => ({ ...prev, ...upd })),
      onToast: (msg, type) => setToast({ msg, type }),
      onBestSnapshot: (snapshot) => {
        // Deep clone the snapshot so the treadmill doesn't mutate its path points!
        const safeWires = snapshot.wires.map(w => ({
          ...w,
          path: w.path ? w.path.map(pt => ({ ...pt })) : null
        }));
        // Components are typically saved via saveComps() which clones, but let's be safe
        const safeComps = snapshot.components.map(c => ({
          ...c,
          pins: c.pins ? c.pins.map(p => ({ ...p })) : []
        }));
        setBestSnapshot({ components: safeComps, wires: safeWires });
      }
    });
  }, [engine]);


  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo(); }
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handlePlaceAndRoute(); }
      if (e.shiftKey && e.key === 'R') { e.preventDefault(); handleRouteOnly(); }
      if (e.key === 'v') { e.preventDefault(); setTool('sel'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handlePlaceAndRoute, handleRouteOnly]);

  // --- INITIAL LOAD ---
  useEffect(() => {
    if (!localStorage.getItem('pcb_board_state')) {
      const timer = setTimeout(() => handleLoadTemplate(), 0);
      return () => clearTimeout(timer);
    }
  }, [handleLoadTemplate]);

  // --- DERIVED STATS ---
  const stats = useMemo(() => {
    const nets = getAllNets(board.components);
    const score = scoreState(board.components, board.wires);
    const routedNum = board.wires.filter(w => !w.failed).length;
    const totalConns = nets.reduce((sum, n) => sum + n.pins.length - 1, 0);
    return {
      components: board.components.length,
      nets: nets.length,
      routed: routedNum,
      failed: board.wires.filter(w => w.failed).length,
      wireLength: score.wl,
      footprint: `${score.width}×${score.height}`,
      area: score.area,
      completion: totalConns > 0 ? Math.round((routedNum / totalConns) * 100) : null
    };
  }, [board]);

  const netsMap = useMemo(() => {
    const m = {};
    board.components.forEach(c => c.pins.forEach(p => {
      if (p.net) {
        if (!m[p.net]) m[p.net] = [];
        m[p.net].push(p);
      }
    }));
    return m;
  }, [board.components]);

  const selectedComp = useMemo(() => board.components.find(c => c.id === selectedId), [board.components, selectedId]);

  return (
    <div className="app-main">
      <Topbar
        tool={tool} setTool={setTool} autoOptimize={autoOptimize} setAutoOptimize={setAutoOptimize}
        onPlaceAndRoute={handlePlaceAndRoute} onOptimizeFootprint={handleOptimizeFootprint}
        onPlateauExplore={handlePlateauExplore} onRouteOnly={handleRouteOnly}
        onClearWires={handleClearWires} onReset={handleReset} onUndo={handleUndo} onRedo={handleRedo}
        onExportState={handleExportState} onExportSVG={() => {/* SVG Export Logic */ }}
        hasWires={board.wires.length > 0}
      />
      <div id="layout">
        <SidebarLeft
          onOpenPrompt={() => setIsPromptOpen(true)}
          jsonInput={jsonInput} setJsonInput={setJsonInput} onLoadCircuit={handleLoadCircuit}
          onLoadTemplate={handleLoadTemplate} components={board.components} selectedId={selectedId}
          onSelectComponent={setSelectedId} onOpenLibrary={() => setIsLibraryOpen(true)}
          onAddNewComponent={() => { setEditingComp(null); setIsEditorOpen(true); }}
          onEditComponent={(id) => { setEditingComp(board.components.find(x => x.id === id)); setIsEditorOpen(true); }}
        />
        <div id="ca-col">
          <main id="ca">
            <PcbCanvas
              components={board.components} wires={board.wires} cols={board.cols} rows={board.rows}
              selectedId={selectedId} onSelect={setSelectedId} hoveredNet={hoveredNet}
              onMove={handleMoveComp} onRotate={handleRotateComp} onMoveEnd={saveHistory}
              tick={board.tick}
            />
          </main>
          <ProcessingBar
            status={status}
            bestSnapshot={bestSnapshot}
            onGoodEnough={() => {
              engine.cancel(true);
              if (bestSnapshot) {
                setBoard({ components: bestSnapshot.components, wires: bestSnapshot.wires });
                setStatus({ progress: 0, title: '', isProcessing: false }); // clear processing
              } else {
                setStatus({ title: '', progress: 0, best: '', isProcessing: false });
              }
              setBestSnapshot(null);
            }}
          />
        </div>
        <SidebarRight stats={stats} selectedComp={selectedComp} nets={netsMap} hoveredNet={hoveredNet} setHoveredNet={setHoveredNet} />
      </div>
      <Toast key={toast.msg} msg={toast.msg} type={toast.type} onClear={() => setToast({ msg: '', type: 'ok' })} />
      <LibraryOverlay isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} onSelect={handleAddFromLibrary} />
      <CompEditorOverlay key={editingComp?.id} isOpen={isEditorOpen} component={editingComp} onClose={() => setIsEditorOpen(false)} onSave={handleSaveEdit} />
      <PromptOverlay isOpen={isPromptOpen} onClose={() => setIsPromptOpen(false)} />
      <style dangerouslySetInnerHTML={{
        __html: `
        .app-main { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; background: var(--bg0); }
        #layout { display: flex; flex: 1; overflow: hidden; min-height: 0; }
        #ca-col { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
        #ca { flex: 1; position: relative; background: #050706; overflow: hidden; border-radius: 4px; margin: 4px; box-shadow: inset 0 0 40px rgba(0,0,0,0.8); min-height: 0; }
      `}} />
    </div>
  );
}

export default App;
