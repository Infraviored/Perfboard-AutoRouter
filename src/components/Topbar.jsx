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
  FileJson
} from 'lucide-react';

export function Topbar({
  workflowStep,
  onStepClick,
  onUndo,
  onRedo,
  onImportState,
  onExportState,
  onClearWires,
  onReset,
  onExportSVG,
  hasWires,
  isProcessing
}) {
  return (
    <header id="topbar">
      <div className="logo">Perfboard<em>Designer</em></div>

      <div className="sep"></div>

      <div className="workflow-track">
        <button
          className={`flow-btn ${workflowStep >= 1 ? 'active' : ''}`}
          onClick={() => onStepClick(1)}
          style={{ '--flow-color': '#4da0ff' }}
        >
          <FileJson size={16} />
          Load
        </button>
        <button
          className={`flow-btn ${workflowStep >= 2 ? 'active' : ''}`}
          onClick={() => onStepClick(2)}
          disabled={workflowStep < 1 || isProcessing}
          style={{ '--flow-color': 'var(--grn-bright)' }}
        >
          <Zap size={16} />
          Route
        </button>
        <button
          className={`flow-btn ${workflowStep >= 3 ? 'active' : ''}`}
          onClick={() => onStepClick(3)}
          disabled={workflowStep < 2 || isProcessing}
          style={{ '--flow-color': 'var(--blu-bright)' }}
        >
          <Wrench size={16} />
          Optimize
        </button>
        <button
          className={`flow-btn ${workflowStep >= 4 ? 'active' : ''}`}
          onClick={() => onStepClick(4)}
          disabled={workflowStep < 3 || isProcessing}
          style={{ '--flow-color': '#a371f7' }}
        >
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

      <div className="sep"></div>

      <div className="btn-group">
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
        
        /* RESTORED: Horizontal layout for button groups */
        .btn-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .workflow-track {
          display: flex;
          gap: 6px;
          padding: 4px;
          background: rgba(0,0,0,0.1);
          border-radius: 10px;
          border: 1px solid var(--border);
        }

        .flow-btn {
          background: transparent;
          border: 1px solid transparent;
          color: var(--txt2);
          padding: 6px 14px;
          border-radius: 7px;
          cursor: pointer;
          font-size: .78em;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
        }
        
        .flow-btn.active {
          background: var(--bg3);
          color: var(--txt0);
          border-color: var(--border);
          box-shadow: var(--shadow-small);
        }
        
        .flow-btn.active svg {
          color: var(--flow-color);
          filter: drop-shadow(0 0 4px var(--flow-color));
        }

        .flow-btn.active::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 10%;
          right: 10%;
          height: 2px;
          background: var(--flow-color);
          box-shadow: 0 0 8px var(--flow-color);
          border-radius: 2px;
          opacity: 0.7;
        }

        .flow-btn:hover:not(:disabled) {
          background: var(--bg4);
          color: var(--txt0);
        }

        .flow-btn:disabled {
          opacity: 0.2;
          cursor: not-allowed;
          filter: grayscale(1);
        }
      `}} />
    </header>
  );
}
