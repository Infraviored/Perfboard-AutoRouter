import React from 'react';

export function Topbar({
  onOptimizeFootprint,
  onPlateauExplore,
  onPlaceAndRoute,
  onRouteOnly,
  onClearWires,
  onReset,
  onExportSVG,
  onUndo,
  onRedo,
  onExportState,
  onImportState,
  autoOptimize,
  setAutoOptimize,
  tool,
  setTool,
  hasWires
}) {
  return (
    <header id="topbar">
      <div className="logo">Perfboard<em>Designer</em></div>
      <div className="sep"></div>


      <button className="tbtn grn" onClick={onPlaceAndRoute}>
        ⚡ Place & Route <kbd>Ctrl+↵</kbd>
      </button>
      <button className="tbtn blu" onClick={onOptimizeFootprint} disabled={!hasWires}>🔧 Optimize Footprint</button>
      <button className="tbtn blu" onClick={onPlateauExplore} disabled={!hasWires}>🧭 Plateau Explore</button>

      <div className="sep"></div>

      <button className="tbtn" onClick={onUndo} title="Undo">↶</button>
      <button className="tbtn" onClick={onRedo} title="Redo">↷</button>

      <div style={{ display: 'flex', gap: '2px' }}>
        <button className="tbtn" onClick={onImportState} title="Import State">📥 Import</button>
        <button className="tbtn" onClick={onExportState} title="Export State">📤 Export</button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--txt1)', fontSize: '.75em', cursor: 'pointer', marginLeft: '8px' }}>
        <input
          type="checkbox"
          checked={autoOptimize}
          onChange={(e) => setAutoOptimize(e.target.checked)}
          style={{ margin: 0 }}
        />
        Auto-optimize
      </label>

      <div className="sep"></div>

      <button className="tbtn" onClick={onRouteOnly}>〰 Route Only <kbd>Shift+R</kbd></button>
      <button className="tbtn" onClick={onClearWires}>⊘ Clear Wires</button>

      <div className="sep"></div>

      <button className="tbtn org" onClick={onExportSVG}>⬇ Export SVG</button>

      <div className="spc"></div>

      <button className="tbtn red" onClick={onReset}>⟳ Reset</button>

      <style dangerouslySetInnerHTML={{
        __html: `
        #topbar {
          height: var(--topbar-height);
          background: var(--glass-bg);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 16px;
          flex-shrink: 0;
          grid-area: topbar;
          z-index: 100;
        }
        .logo {
          font-family: 'Outfit', sans-serif;
          font-size: 1.1em;
          font-weight: 800;
          color: var(--txt0);
          margin-right: 12px;
          white-space: nowrap;
          letter-spacing: -0.02em;
        }
        .logo em {
          color: var(--blu-bright);
          font-style: normal;
          font-weight: 600;
        }
      `}} />
    </header>
  );
}
