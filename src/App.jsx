import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AutorouterEngine } from './engine/engine.js';
import { PcbCanvas } from './components/PcbCanvas.jsx';
import { Topbar } from './components/Topbar.jsx';
import { SidebarLeft } from './components/SidebarLeft.jsx';
import { SidebarRight } from './components/SidebarRight.jsx';
import { ProcessingBar } from './components/ProcessingBar.jsx';
import { LibraryOverlay } from './components/LibraryOverlay.jsx';
import { CompEditorOverlay } from './components/CompEditorOverlay.jsx';
import { PromptOverlay } from './components/PromptOverlay.jsx';
import { ConfirmOverlay } from './components/ConfirmOverlay.jsx';
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
      } catch (e) {
        console.warn("Failed to parse saved board state for engine", e);
      }
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
      } catch (e) {
        console.warn("Failed to parse saved board state", e);
      }
    }
    return { components: [], wires: [], cols: 30, rows: 20, tick: 0 };
  });

  const [workflowStep, setWorkflowStep] = useState(() => {
    const saved = localStorage.getItem('pcb_workflow_step');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [snapCounter, setSnapCounter] = useState(0);

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

  useEffect(() => {
    localStorage.setItem('pcb_workflow_step', workflowStep.toString());
  }, [workflowStep]);

  // Sync board components back to JSON input live
  useEffect(() => {
    if (board.components.length === 0) return;

    // We only update if the board tick changed (meaning an operation happened)
    const nets = getAllNets(board.components);
    const doc = {
      components: board.components.map(c => ({
        id: c.id,
        name: c.name,
        value: c.value,
        pins: c.pins.map(p => ({
          offset: [p.dCol, p.dRow],
          label: p.lbl,
          net: p.net || ''
        }))
      })),
      connections: nets.map(n => ({
        net: n.net,
        count: n.pins.length
      }))
    };

    const newJson = JSON.stringify(doc, null, 2);
    // Only set if different to avoid infinite loops or unnecessary re-renders
    if (newJson !== jsonInput) {
      setJsonInput(newJson);
    }
  }, [board.components, board.tick]);

  const [status, setStatus] = useState({ title: '', progress: 0, best: '', isProcessing: false, isInitial: false });
  const [selectedId, setSelectedId] = useState(null);
  const [selectedNet, setSelectedNet] = useState(null);
  const [hoveredNet, setHoveredNet] = useState(null);
  const [bestSnapshot, setBestSnapshot] = useState(null);


  // Modal states
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [editingComp, setEditingComp] = useState(null);
  const [confirmData, setConfirmData] = useState({ isOpen: false, type: null, targetId: null });
  const [activePin, setActivePin] = useState(null);
  const [previewPath, setPreviewPath] = useState(null);

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
    setWorkflowStep(0); // Reset for clean trigger
    setJsonInput(JSON.stringify(TEMPLATE, null, 2));
    const defs = processTemplate(TEMPLATE);
    engine.initializeBoard(defs);
    setWorkflowStep(1); // Loaded
    setSnapCounter(c => c + 1);
    saveHistory();
  }, [engine, saveHistory]);

  const handleLoadCircuit = useCallback(() => {
    try {
      const data = JSON.parse(jsonInput);
      const defs = processTemplate(data);
      if (defs) {
        engine.initializeBoard(defs);
        setWorkflowStep(1);
        setSnapCounter(c => c + 1);
        saveHistory();
      }
    } catch (e) {
      console.error('Failed to load circuit:', e);
    }
  }, [engine, jsonInput, saveHistory]);

  const handleRoute = useCallback(async () => {
    setWorkflowStep(2);
    setStatus(prev => ({ ...prev, isProcessing: true, isInitial: true, results: null }));
    try {
      const data = JSON.parse(jsonInput);
      const defs = processTemplate(data);
      const res = await engine.placeAndRoute(defs);
      if (res) {
        setStatus(prev => ({ ...prev, isProcessing: false, isInitial: false, results: res }));
        setSnapCounter(c => c + 1);
        setTimeout(() => {
          setStatus(prev => ({ ...prev, results: null }));
        }, 6000);
      } else {
        setStatus(prev => ({ ...prev, isProcessing: false, isInitial: false, title: '', best: null }));
      }
      setStatus(prev => ({ ...prev, isProcessing: false, isInitial: false, title: '', best: null }));
    } catch (e) {
      console.error('Failed to route:', e);
      setStatus(prev => ({ ...prev, isProcessing: false, isInitial: false, title: '', best: '' }));
    }
    saveHistory();
  }, [engine, jsonInput, saveHistory]);

  const handleCompact = useCallback(async () => {
    setWorkflowStep(3);
    setStatus(prev => ({ ...prev, isProcessing: true, results: null }));
    const res = await engine.optimize();
    if (res) {
      setStatus(prev => ({ ...prev, isProcessing: false, results: res }));
      setTimeout(() => {
        setStatus(prev => ({ ...prev, results: null }));
        setBestSnapshot(null);
      }, 4000);
    } else {
      setStatus(prev => ({ ...prev, isProcessing: false, title: '', best: '' }));
      setBestSnapshot(null);
    }
    saveHistory();
  }, [engine, saveHistory]);

  const handleOptimizeBoard = useCallback(async () => {
    setWorkflowStep(4);
    setStatus(prev => ({ ...prev, isProcessing: true, results: null }));
    const res = await engine.plateau();
    if (res) {
      setStatus(prev => ({ ...prev, isProcessing: false, results: res }));
      setTimeout(() => {
        setStatus(prev => ({ ...prev, results: null }));
        setBestSnapshot(null);
      }, 4000);
    } else {
      setStatus(prev => ({ ...prev, isProcessing: false, title: '', best: '' }));
      setBestSnapshot(null);
    }
    saveHistory();
  }, [engine, saveHistory]);


  const handleStepClick = useCallback(async (step) => {
    if (step === 0) {
      engine.setState({ components: [], wires: [] });
      setWorkflowStep(0);
    } else if (step === 1) {
      handleLoadCircuit();
    } else if (step === 2) {
      handleRoute();
    } else if (step === 3) {
      handleCompact();
    } else if (step === 4) {
      handleOptimizeBoard();
    }
  }, [handleLoadCircuit, handleRoute, handleCompact, handleOptimizeBoard, engine]);

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


  const handleRouteOnly = useCallback(async () => {
    setStatus(prev => ({ ...prev, isProcessing: true }));
    try {
      await engine.routeOnly();
      setStatus(prev => ({ ...prev, title: '', best: '' }));
    } finally {
      setStatus(prev => ({ ...prev, isProcessing: false }));
    }
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

  const handleManualRoute = useCallback(async (start, end, path) => {
    if (!path) {
      setPreviewPath(null);
      return;
    }
    const netA = start.pin.net;
    let netB = null;
    if (typeof end === 'object' && end !== null) {
      netB = end.pin.net;
    } else if (typeof end === 'string') {
      netB = end;
    }

    let targetNet = netA || netB;

    if (!targetNet) {
      const netsList = getAllNets(board.components);
      let i = 1;
      while (netsList.some(n => n.net === `NET_${i}`)) i++;
      targetNet = `NET_${i}`;
    }

    if (netA && netB && netA !== netB) {
      engine.mergeNets(netB, netA);
      targetNet = netA;
    } else {
      engine.updatePinNet(start.compId, start.pinIdx, targetNet);
      if (typeof end === 'object' && end !== null) {
        engine.updatePinNet(end.compId, end.pinIdx, targetNet);
      }
    }

    const hasCrossing = path.some(p => p.isCrossing);

    if (hasCrossing) {
      // Intent confirmed, but path is illegal. 
      // Ask the autorouter to find a legal path given the new net connectivity.
      // We don't add the dashed manual wire to the board.
      await engine.route();
    } else {
      // Legal manual connection! Add it as a permanent trace.
      engine.addManualWire(targetNet, path);
    }

    setPreviewPath(null);
    saveHistory();
  }, [board.components, engine, saveHistory]);

  const handlePreviewRoute = useCallback(async (startPin, currentPos, targetNet = null) => {
    setActivePin(startPin);
    if (!startPin || !currentPos) {
      setPreviewPath(null);
      return;
    }
    const path = await engine.previewManualRoute(startPin, currentPos, targetNet);
    setPreviewPath(path);
  }, [engine]);

  const requestDelete = useCallback(() => {
    if (activePin) {
      setConfirmData({ isOpen: true, type: 'pin', targetId: `${activePin.compId}.${activePin.pin.lbl}` });
    } else if (selectedId) {
      setConfirmData({ isOpen: true, type: 'comp', targetId: selectedId });
    } else if (selectedNet) {
      setConfirmData({ isOpen: true, type: 'net', targetId: selectedNet });
    }
  }, [activePin, selectedId, selectedNet]);

  const handleConfirmDelete = useCallback(() => {
    if (confirmData.type === 'pin' && activePin) {
      engine.updatePinNet(activePin.compId, activePin.pinIdx, '');
      setActivePin(null);
      setPreviewPath(null);
      handleRouteOnly();
    } else if (confirmData.type === 'comp') {
      engine.deleteComponent(confirmData.targetId);
      setSelectedId(null);
    } else if (confirmData.type === 'net') {
      engine.deleteWire(confirmData.targetId);
      setSelectedNet(null);
    } else if (confirmData.type === 'reset') {
      handleLoadTemplate();
    }
    setConfirmData({ isOpen: false, type: null, targetId: null });
    saveHistory();
  }, [confirmData, engine, activePin, handleRouteOnly, handleLoadTemplate, saveHistory]);

  const handleReset = useCallback(() => {
    setConfirmData({
      isOpen: true,
      type: 'reset',
      targetId: 'board'
    });
  }, []);

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
      id: newId, name: compDef.name, value: compDef.value, color: compDef.color || null,
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
  }, [board.components, engine, saveHistory]);


  const handleExportState = useCallback(() => {
    const state = { components: board.components, wires: board.wires };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'pcb_circuit.json'; a.click();
    URL.revokeObjectURL(url);
  }, [board]);
  const handleImportState = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (parsed.components) {
            engine.setState({
              components: parsed.components,
              wires: parsed.wires || [],
              cols: parsed.cols || board.cols,
              rows: parsed.rows || board.rows
            });
            saveHistory();
          }
        } catch (err) {
          console.error('Failed to import PCB state from file:', err);
          window.alert('Failed to import PCB file. Please make sure it is valid JSON in the expected format.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [engine, board.cols, board.rows, saveHistory]);

  // --- ENGINE SYNC ---
  useEffect(() => {
    engine.setCallbacks({
      onStateChange: (newState) => setBoard(prev => ({ ...prev, ...newState })),
      onProgress: (p, t) => setStatus(prev => ({ ...prev, progress: p, title: t })),
      onStatusUpdate: (upd) => setStatus(prev => ({ ...prev, ...upd })),
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
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleRoute(); }
      if (e.shiftKey && e.key === 'R') { e.preventDefault(); handleRouteOnly(); }

      // Removed tool switching logic

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only trigger if no input is focused
        if (document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
          e.preventDefault();
          requestDelete();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleRoute, handleRouteOnly, requestDelete]);

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

  const activeNets = useMemo(() => {
    const list = new Set();
    if (hoveredNet) list.add(hoveredNet);
    if (selectedNet) list.add(selectedNet);
    if (selectedComp) {
      selectedComp.pins.forEach(p => { if (p.net) list.add(p.net); });
    }
    return Array.from(list);
  }, [hoveredNet, selectedNet, selectedComp]);

  return (
    <div className="app-main">
      <Topbar
        workflowStep={workflowStep}
        onStepClick={handleStepClick}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onImportState={handleImportState}
        onExportState={handleExportState}
        onClearWires={handleClearWires}
        onReset={handleReset}
        onRouteOnly={handleRouteOnly}
        onExportSVG={() => { /* logic */ }}
        hasWires={board.wires.length > 0}
        isProcessing={status.isProcessing}
      />
      <div id="layout">
        <SidebarLeft
          onOpenPrompt={() => setIsPromptOpen(true)}
          jsonInput={jsonInput} setJsonInput={setJsonInput}
          onLoadTemplate={handleLoadTemplate} components={board.components} selectedId={selectedId}
          onSelectComponent={(id) => {
            setSelectedId(id);
            if (id) setSelectedNet(null); // Clear net if comp selected
          }} onOpenLibrary={() => setIsLibraryOpen(true)}
          onAddNewComponent={() => { setEditingComp(null); setIsEditorOpen(true); }}
          onEditComponent={(id) => { setEditingComp(board.components.find(x => x.id === id)); setIsEditorOpen(true); }}
        />
        <div id="ca-col">
          <main id="ca">
            <PcbCanvas
              components={board.components} wires={board.wires} cols={board.cols} rows={board.rows}
              selectedId={selectedId} onSelect={(id) => {
                if (id) {
                  setSelectedId(id);
                  setSelectedNet(null);
                } else {
                  setSelectedId(null);
                }
              }}
              onSelectNet={(net) => {
                if (net) {
                  setSelectedNet(net);
                  setSelectedId(null);
                } else {
                  setSelectedNet(null);
                }
              }}
              activeNets={activeNets}
              onMove={handleMoveComp} onRotate={handleRotateComp} onMoveEnd={saveHistory}
              onManualRoute={handleManualRoute}
              onPreviewRoute={handlePreviewRoute}
              previewPath={previewPath}
              tick={board.tick} isProcessing={status.isProcessing || !!status.results}
              isInitialProcessing={status.isInitial}
              workflowStep={workflowStep}
              snapCounter={snapCounter}
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
        <SidebarRight stats={stats} selectedComp={selectedComp} nets={netsMap}
          hoveredNet={hoveredNet} setHoveredNet={setHoveredNet}
          selectedNet={selectedNet} setSelectedNet={(net) => {
            setSelectedNet(net);
            if (net) setSelectedId(null); // Clear comp if net selected
          }}
          activeNets={activeNets}
        />
      </div>
      <LibraryOverlay isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} onSelect={handleAddFromLibrary} />
      <CompEditorOverlay key={editingComp?.id} isOpen={isEditorOpen} component={editingComp} onClose={() => setIsEditorOpen(false)} onSave={handleSaveEdit} />
      <PromptOverlay isOpen={isPromptOpen} onClose={() => setIsPromptOpen(false)} />
      <ConfirmOverlay
        isOpen={confirmData.isOpen}
        title={
          confirmData.type === 'pin' ? 'Disconnect Pin' :
            confirmData.type === 'comp' ? 'Delete Component' :
              confirmData.type === 'net' ? 'Delete Net' :
                confirmData.type === 'reset' ? 'Reset Workspace' : 'Confirm Action'
        }
        message={
          confirmData.type === 'pin' ? `Are you sure you want to disconnect ${confirmData.targetId}? This will remove its net assignment.` :
            confirmData.type === 'comp' ? `Are you sure you want to delete ${confirmData.targetId}? All associated wires will be removed.` :
              confirmData.type === 'net' ? `Are you sure you want to clear all wires for net ${confirmData.targetId}?` :
                confirmData.type === 'reset' ? 'This will clear all components and wires, reverting to the template. This cannot be undone.' :
                  'Are you sure you want to proceed with this action?'
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmData({ isOpen: false, type: null, targetId: null })}
      />
      <style dangerouslySetInnerHTML={{
        __html: `
        .app-main { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; background: var(--bg0); }
        #layout { display: flex; flex: 1; overflow: hidden; min-height: 0; }
        #ca-col { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; overflow: hidden; }
        #ca { flex: 1; position: relative; background: #050706; overflow: hidden; border-radius: 4px; margin: 4px; box-shadow: inset 0 0 40px rgba(0,0,0,0.8); min-height: 0; }

        @keyframes active-pin-blink {
          0% { r: 6.16; fill: #fff; opacity: 1; filter: drop-shadow(0 0 5px #fff); }
          50% { r: 8.4; fill: var(--active-color); opacity: 0.8; filter: drop-shadow(0 0 10px var(--active-color)); }
          100% { r: 6.16; fill: #fff; opacity: 1; filter: drop-shadow(0 0 5px #fff); }
        }
        .active-pin {
          animation: active-pin-blink 0.8s infinite ease-in-out;
          stroke: #fff;
          stroke-width: 2px;
        }
      `}} />
    </div>
  );
}

export default App;
