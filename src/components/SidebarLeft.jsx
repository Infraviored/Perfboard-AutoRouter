import React, { useState } from 'react';
import { boostColor, compColor } from '../engine/render-utils.js';
import {
  FileJson,
  Plus,
  Library,
  Settings2,
  HelpCircle,
  Cpu,
  Play,
  Pencil
} from 'lucide-react';

export function SidebarLeft({
  cols,
  rows,
  onApplyBoard,
  onCutToBoundingBox,
  jsonInput,
  setJsonInput,
  onLoadCircuit,
  onLoadTemplate,
  components,
  selectedId,
  onSelectComponent,
  onOpenLibrary,
  onAddNewComponent,
  onEditComponent,
  onOpenPrompt
}) {
  const [localCols, setLocalCols] = useState(cols);
  const [localRows, setLocalRows] = useState(rows);

  const handleApply = () => {
    onApplyBoard(parseInt(localCols), parseInt(localRows));
  };

  return (
    <aside id="lsb">
      {/* Circuit Definition Section */}
      <section className="sidebar-section">
        <div className="section-header">
          <FileJson size={18} />
          <h2>Circuit Definition</h2>
        </div>
        <div className="lbody">
          <div className="textarea-container">
            <textarea
              placeholder="Paste JSON or generate with an LLM..."
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              spellCheck="false"
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button className="btn blu" onClick={onLoadCircuit} style={{ flex: 1 }}>
              <Play size={14} /> Load Circuit
            </button>
            <button
              className="btn"
              style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--txt1)', width: '40px' }}
              onClick={onOpenPrompt}
              title="How do I get this?"
            >
              <HelpCircle size={14} />
            </button>
          </div>
        </div>
      </section>

      <div className="section-divider"></div>

      {/* Components Section */}
      <section className="sidebar-section scroll-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="section-header">
          <Cpu size={18} />
          <h2>Components</h2>
        </div>

        <div className="header-actions-row">
          <button className="tplbtn blu-bg" onClick={onOpenLibrary} style={{ flex: 1 }}>
            <Library size={14} /> Library
          </button>
          <button className="tplbtn grn-bg" onClick={onAddNewComponent} style={{ flex: 1 }}>
            <Plus size={14} /> New
          </button>
        </div>

        <div className="lbody comp-list">
          {components.length === 0 ? (
            <div className="empty-state">
              <Cpu size={32} style={{ opacity: 0.2, marginBottom: '8px' }} />
              <div>No components loaded.</div>
            </div>
          ) : (
            components.map(c => {
              const boosted = boostColor(compColor(c));
              return (
                <div
                  key={c.id}
                  className={`comp-card ${selectedId === c.id ? 'sel' : ''}`}
                  onClick={() => onSelectComponent(c.id)}
                  style={{
                    '--comp-color': boosted,
                  }}
                >
                  <div className="comp-id-tag">{c.id}</div>
                  <div className="comp-info">
                    <div className="comp-name">{c.name}</div>
                    <div className="comp-value">{c.value}</div>
                  </div>
                  <div className="comp-actions">
                    <div className="comp-pins-tag">{c.pins.length}P</div>
                    <button
                      className="edit-mini-btn"
                      onClick={(e) => { e.stopPropagation(); onEditComponent(c.id); }}
                      title="Edit Component"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <style dangerouslySetInnerHTML={{
        __html: `
        #lsb {
          width: var(--lsb-width);
          background: var(--bg2);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          z-index: 10;
        }
        .sidebar-section {
          display: flex;
          flex-direction: column;
          padding: 4px 0;
        }
        .section-header {
           padding: 12px 16px 6px 16px;
           display: flex;
           align-items: center;
           gap: 10px;
           color: var(--txt0);
        }
        .section-header h2 {
           font-size: 0.95rem;
           font-weight: 700;
           margin: 0;
           letter-spacing: -0.01em;
           color: var(--txt0);
        }
        .section-header svg {
           color: var(--blu-bright);
           opacity: 0.8;
        }
        .section-divider {
           height: 1px;
           background: linear-gradient(90deg, transparent, var(--border2), transparent);
           margin: 4px 16px;
           opacity: 0.3;
        }
        .header-actions-row {
          display: flex;
          gap: 6px;
          padding: 0 16px 8px 16px;
        }
        .textarea-container {
           position: relative;
           border-radius: 8px;
           overflow: hidden;
           border: 1px solid var(--border2);
           background: var(--bg3);
        }
        textarea {
           border: none !important;
           background: transparent !important;
           min-height: 120px;
           font-size: .75em;
           padding: 10px;
           line-height: 1.5;
        }
        .tplbtn {
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: .72em;
          font-weight: 600;
          background: var(--bg4);
          border: 1px solid var(--border);
          color: var(--txt0);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: 0.2s;
        }
        .tplbtn:hover { 
          background: var(--bg3);
          border-color: var(--border2);
          transform: translateY(-1px);
        }
        
        .comp-list {
          gap: 6px;
          padding: 0 16px 16px 16px;
        }
        .empty-state {
          padding: 30px 20px;
          text-align: center;
          font-size: .75em;
          color: var(--txt2);
          display: flex;
          flex-direction: column;
          align-items: center;
          background: rgba(255,255,255,0.01);
          border-radius: 10px;
          border: 1px dashed var(--border);
        }

        .comp-card {
           background: var(--bg3);
           border: 1px solid var(--border);
           border-left: 3px solid var(--comp-color);
           border-radius: 8px;
           padding: 6px 10px;
           display: flex;
           align-items: center;
           gap: 10px;
           cursor: pointer;
           transition: all 0.2s;
        }
        .comp-card:hover {
           background: var(--bg4);
           border-color: var(--border2);
           border-left-color: var(--comp-color);
        }
        .comp-card.sel {
           background: var(--bg4);
           border-color: var(--comp-color);
           box-shadow: 0 0 0 1px var(--comp-color), 0 0 15px color-mix(in srgb, var(--comp-color), transparent 60%);
        }
        .comp-id-tag {
          font-family: 'Outfit', sans-serif;
          font-weight: 800;
          font-size: 0.75em;
          color: var(--txt0);
          min-width: 26px;
          background: rgba(255,255,255,0.05);
          padding: 2px 4px;
          border-radius: 4px;
          text-align: center;
          border: 1px solid var(--border);
        }
        .comp-info {
          display: flex;
          flex-direction: column;
          gap: 0px;
          min-width: 0;
          flex: 1;
        }
        .comp-name {
          font-size: 0.8em;
          font-weight: 600;
          color: var(--txt0);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .comp-value {
          font-size: 0.65em;
          color: var(--txt1);
          font-family: 'Consolas', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .comp-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: auto;
        }
        .comp-pins-tag {
           font-size: 0.6em;
           font-weight: 800;
           color: var(--txt2);
           background: var(--bg2);
           padding: 1px 5px;
           border-radius: 4px;
           border: 1px solid var(--border);
        }
        .edit-mini-btn {
          background: var(--bg2);
          border: 1px solid var(--border);
          color: var(--txt1);
          width: 22px;
          height: 22px;
          border-radius: 5px;
          cursor: pointer;
          transition: 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .edit-mini-btn:hover {
          background: var(--blu);
          color: #fff;
          border-color: var(--blu);
        }
      `}} />
    </aside>
  );
}
