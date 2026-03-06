import React from 'react';
import {
  Zap,
  Wrench,
  Compass,
  Undo2,
  Redo2,
  Download,
  Upload,
  RotateCcw,
  FileJson,
  ExternalLink,
  Eraser,
  Spline
} from 'lucide-react';

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

      <div className="btn-group">
        <button className="tbtn grn" onClick={onPlaceAndRoute}>
          <Zap size={16} />
          Place & Route
          <kbd>Ctrl+↵</kbd>
        </button>
        <button className="tbtn blu" onClick={onOptimizeFootprint} disabled={!hasWires}>
          <Wrench size={16} />
          Optimize
        </button>
        <button className="tbtn blu" onClick={onPlateauExplore} disabled={!hasWires}>
          <Compass size={16} />
          Explore
        </button>
      </div>

      <div className="sep"></div>

      <div className="btn-group">
        <button className="tbtn" onClick={onUndo} title="Undo">
          <Undo2 size={16} />
        </button>
        <button className="tbtn" onClick={onRedo} title="Redo">
          <Redo2 size={16} />
        </button>
      </div>

      <div className="sep"></div>

      <div className="btn-group">
        <button className="tbtn" onClick={onImportState} title="Import State">
          <Download size={16} />
          Import
        </button>
        <button className="tbtn" onClick={onExportState} title="Export State">
          <Upload size={16} />
          Export
        </button>
      </div>

      <label className="topbar-toggle">
        <input
          type="checkbox"
          checked={autoOptimize}
          onChange={(e) => setAutoOptimize(e.target.checked)}
        />
        <span>Auto-optimize</span>
      </label>

      <div className="sep"></div>

      <div className="btn-group">
        <button className="tbtn" onClick={onRouteOnly}>
          <Spline size={16} />
          Route Only
          <kbd>Shift+R</kbd>
        </button>
        <button className="tbtn" onClick={onClearWires}>
          <Eraser size={16} />
          Clear
        </button>
      </div>

      <div className="sep"></div>

      <button className="tbtn org" onClick={onExportSVG}>
        <ExternalLink size={16} />
        Export SVG
      </button>

      <div className="spc"></div>

      <button className="tbtn red" onClick={onReset}>
        <RotateCcw size={16} />
        Reset
      </button>

      <style dangerouslySetInnerHTML={{
        __html: `
        #topbar {
          height: var(--topbar-height);
          background: var(--glass-bg);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 16px;
          flex-shrink: 0;
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
        .btn-group {
          display: flex;
          gap: 4px;
        }
        .topbar-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--txt1);
          font-size: .75em;
          font-weight: 600;
          cursor: pointer;
          margin-left: 12px;
          padding: 6px 10px;
          border-radius: 8px;
          transition: background 0.2s;
        }
        .topbar-toggle:hover {
          background: rgba(255,255,255,0.05);
          color: var(--txt0);
        }
        .topbar-toggle input {
          width: 14px;
          height: 14px;
          accent-color: var(--blu-bright);
          margin: 0;
          cursor: pointer;
        }
      `}} />
    </header>
  );
}
