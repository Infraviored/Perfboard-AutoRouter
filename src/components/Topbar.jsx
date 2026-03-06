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
  setTool,
  hasWires,
  isProcessing
}) {
  return (
    <header id="topbar">
      <div className="logo">Perfboard<em>Designer</em></div>

      <div className="sep"></div>

      <div className="workflow-track">
        <div className="flow-item">
          <button
            className={`flow-btn ${isProcessing ? 'active' : ''}`}
            onClick={onPlaceAndRoute}
            style={{ '--flow-color': 'var(--grn-bright)' }}
          >
            <Zap size={16} />
            Place & Route
          </button>
        </div>
        <div className="flow-item">
          <button
            className="flow-btn"
            onClick={onOptimizeFootprint}
            disabled={!hasWires || isProcessing}
            style={{ '--flow-color': 'var(--blu-bright)' }}
          >
            <Wrench size={16} />
            Optimize
          </button>
        </div>
        <div className="flow-item">
          <button
            className="flow-btn"
            onClick={onPlateauExplore}
            disabled={!hasWires || isProcessing}
            style={{ '--flow-color': '#a371f7' }}
          >
            <Compass size={16} />
            Explore
          </button>
        </div>
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



      <div className="sep"></div>

      <div className="btn-group">
        <button className="tbtn" onClick={onRouteOnly} disabled={isProcessing}>
          <Spline size={16} />
          Route Only
        </button>
        <button className="tbtn" onClick={onClearWires} disabled={isProcessing}>
          <Eraser size={16} />
          Clear
        </button>
      </div>

      <div className="sep"></div>

      <button className="tbtn" onClick={onExportSVG} style={{ '--org': '#d29922' }}>
        <ExternalLink size={16} title="Export SVG" />
        Export
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
          font-weight: 700;
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
