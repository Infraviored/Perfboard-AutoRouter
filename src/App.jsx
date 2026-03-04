import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AutorouterEngine } from './engine/engine.js';
import { PcbCanvas } from './components/PcbCanvas.jsx';
import { TEMPLATE, processTemplate } from './engine/templates.js';
import './App.css';

function App() {
  const [engineState, setEngineState] = useState({
    components: [],
    wires: [],
    cols: 22,
    rows: 16
  });
  const [status, setStatus] = useState({ title: 'Idle', progress: 0, best: '' });
  const [selectedId, setSelectedId] = useState(null);

  // Create engine instance on mount and keep it stable
  const engine = useMemo(() => new AutorouterEngine(22, 16), []);

  useEffect(() => {
    // Connect engine callbacks to React state
    engine.onStateChange = (newState) => {
      setEngineState({ ...newState });
    };
    engine.onProgress = (progress, title) => {
      setStatus(prev => ({ ...prev, progress, title }));
    };
    engine.onStatusUpdate = (update) => {
      if (update.title) setStatus(prev => ({ ...prev, title: update.title }));
      if (update.best) setStatus(prev => ({ ...prev, best: update.best }));
    };
    engine.onToast = (msg, type) => {
      console.log(`[TOAST ${type}] ${msg}`);
      // In a real app, use a toast library or custom component
    };

    // Initial setup
    const initialComps = processTemplate(TEMPLATE);
    engine.initializeBoard(initialComps);
  }, [engine]);

  const handleLoadTemplate = () => {
    const comps = processTemplate(TEMPLATE);
    engine.initializeBoard(comps);
  };

  const handleClear = () => {
    engine.setState({ components: [], wires: [] });
  };

  const handleOptimize = async () => {
    await engine.optimize();
  };

  const handlePlateau = async () => {
    await engine.plateau();
  };

  const selectedComp = useMemo(() =>
    engineState.components.find(c => c.id === selectedId),
    [engineState.components, selectedId]
  );

  return (
    <div className="app-container">
      {/* 1. Sidebar */}
      <aside className="sidebar">
        <header className="panel-header">Components</header>
        <div className="scroll-container">
          {engineState.components.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              No components loaded.
            </div>
          ) : (
            engineState.components.map(c => (
              <div
                key={c.id}
                className="comp-item"
                onClick={() => setSelectedId(c.id)}
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  borderRadius: '6px',
                  background: selectedId === c.id ? 'var(--bg-hover)' : 'var(--bg-elevated)',
                  border: `1px solid ${selectedId === c.id ? c.color : 'var(--border)'}`,
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{c.id}: {c.value}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.name}</div>
              </div>
            ))
          )}
        </div>

        {/* Selected Component Details */}
        {selectedComp && (
          <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', fontWeight: 700, marginBottom: 8 }}>EDIT SELECTION</div>
            <div style={{ fontSize: '0.9rem', marginBottom: 4 }}>{selectedComp.id} Properties</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pos: {selectedComp.ox}, {selectedComp.oy}</div>
          </div>
        )}

        {/* Stats Footer */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {status.best || 'No stats yet'}
        </div>
      </aside>

      {/* 2. Topbar */}
      <header className="topbar">
        <div style={{ fontWeight: 800, color: 'var(--accent-green)', letterSpacing: '-0.02em', marginRight: '2rem', fontSize: '1.1rem' }}>
          PERFBOARD<span style={{ color: 'var(--text-main)', opacity: 0.6 }}>ROUTER</span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="button-primary" onClick={handleOptimize}>OPTIMIZE</button>
          <button className="button-secondary" onClick={handlePlateau}>PLATEAU</button>
          <button className="button-secondary" onClick={() => engine.cancel()}>CANCEL</button>
          <div style={{ width: 1, background: 'var(--border)', height: '24px', alignSelf: 'center', margin: '0 4px' }}></div>
          <button className="button-secondary" onClick={handleLoadTemplate}>TEMPLATE</button>
          <button className="button-secondary" onClick={handleClear} style={{ color: 'var(--accent-red)' }}>CLEAR</button>
        </div>

        {/* Task Progress Inline */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{status.title}</div>
            <div style={{ height: '4px', width: '120px', background: 'var(--bg-deep)', borderRadius: '2px', overflow: 'hidden', marginTop: 4 }}>
              <div style={{ width: `${status.progress}%`, height: '100%', background: 'var(--accent-blue)', transition: 'width 0.2s' }}></div>
            </div>
          </div>
        </div>
      </header>

      {/* 3. Canvas Area */}
      <main className="canvas-area">
        <PcbCanvas
          components={engineState.components}
          wires={engineState.wires}
          cols={engineState.cols}
          rows={engineState.rows}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </main>
    </div>
  );
}

export default App;
