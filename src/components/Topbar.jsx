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
    autoOptimize,
    setAutoOptimize,
    tool,
    setTool
}) {
    return (
        <header id="topbar">
            <div className="logo">Perfboard<em>Designer</em></div>
            <div className="sep"></div>

            <button
                className={`tbtn ${tool === 'sel' ? 'act' : ''}`}
                onClick={() => setTool('sel')}
            >
                ↖ Select <kbd>V</kbd>
            </button>

            <div className="sep"></div>

            <button className="tbtn grn" onClick={onPlaceAndRoute}>
                ⚡ Place & Route <kbd>Ctrl+↵</kbd>
            </button>
            <button className="tbtn" onClick={onOptimizeFootprint}>🔧 Optimize Footprint</button>
            <button className="tbtn" onClick={onPlateauExplore}>🧭 Plateau Explore</button>

            <div className="sep"></div>

            <button className="tbtn" onClick={onUndo} title="Undo">↶</button>
            <button className="tbtn" onClick={onRedo} title="Redo">↷</button>
            <button className="tbtn" onClick={onExportState}>📤 Export State</button>

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
          background: var(--bg2);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 10px;
          flex-shrink: 0;
          grid-area: topbar;
        }
        .logo {
          font-size: 1em;
          font-weight: 800;
          color: var(--grn);
          margin-right: 6px;
          white-space: nowrap;
        }
        .logo em {
          color: var(--txt2);
          font-style: normal;
          font-weight: 400;
        }
      `}} />
        </header>
    );
}
