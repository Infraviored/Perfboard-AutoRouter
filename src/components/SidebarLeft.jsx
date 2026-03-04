import React, { useState } from 'react';
import { boostColor } from '../engine/render-utils.js';

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
      {/* 2. Circuit Definition Section */}
      <div className="ph">
        <span><span className="sbadge">2</span>Circuit Definition</span>
      </div>
      <div className="lbody">
        <textarea
          placeholder="Paste JSON or generate with an LLM..."
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          spellCheck="false"
        />
        <button className="btn blu" onClick={onLoadCircuit}>▶ Load Circuit</button>
        <button
          className="btn"
          style={{ background: '#1a1a1a', border: '1px solid #333', color: 'var(--txt1)', marginTop: '2px' }}
          onClick={onOpenPrompt}
        >
          💡 How do I get this?
        </button>
      </div>

      {/* 3. Components Section */}
      <div className="ph">
        <span><span className="sbadge">3</span>Components</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="tplbtn blu-bg" onClick={onOpenLibrary}>📚 Library</button>
          <button className="tplbtn grn-bg" onClick={onAddNewComponent}>+ New</button>
        </div>
      </div>
      <div className="scroll-container lbody" style={{ gap: '8px' }}>
        {components.length === 0 ? (
          <div style={{ fontSize: '.7em', color: 'var(--txt2)', textAlign: 'center', padding: '10px' }}>Load components first.</div>
        ) : (
          components.map(c => {
            const boosted = boostColor(c.color);
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
                    🔧
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        #lsb {
          width: var(--lsb-width);
          background: var(--bg2);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          grid-area: sidebar;
          overflow: hidden;
        }
        .sbadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 17px;
          height: 17px;
          border-radius: 50%;
          background: var(--bg4);
          border: 1px solid var(--border2);
          font-size: .63em;
          font-weight: 700;
          color: var(--txt2);
          margin-right: 6px;
        }
        .sbadge.act { background: var(--grn); color: #000; border-color: var(--grn); }
        
        .tplbtn {
          padding: 4px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: .85em;
          background: var(--bg4);
          border: 1px solid var(--border2);
          color: var(--txt1);
          transition: all 0.1s ease;
        }
        .tplbtn:hover { color: var(--txt0); }
        .tplbtn.blu-bg { background: var(--blu); color: #fff; border-color: var(--blu); }
        .tplbtn.grn-bg { background: var(--grn); color: #000; border-color: var(--grn); }

        .comp-card {
          position: relative;
          background: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), var(--comp-color);
          background-blend-mode: multiply;
          border: 1px solid rgba(255,255,255,0.08);
          border-left: 3px solid var(--comp-color);
          border-radius: 6px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
        }

        /* The tinted background similar to the board */
        .comp-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: var(--comp-color);
          opacity: 0.15;
          pointer-events: none;
        }

        .comp-card:hover { 
          transform: translateX(2px);
          filter: brightness(1.2);
          border-color: rgba(255,255,255,0.2);
        }
        
        .comp-card.sel { 
          background: linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), var(--comp-color);
          box-shadow: 0 4px 12px rgba(0,0,0,0.3), 0 0 0 1px var(--blu);
          border-color: var(--blu);
        }

        .comp-id-tag {
          font-family: 'Consolas', monospace;
          font-weight: 800;
          font-size: 0.9em;
          color: var(--txt0);
          min-width: 24px;
        }

        .comp-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .comp-name {
          font-size: 0.75em;
          font-weight: 600;
          color: var(--txt1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .comp-value {
          font-size: 0.65em;
          color: var(--txt2);
          font-family: 'Consolas', monospace;
        }

        .comp-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .comp-pins-tag {
          font-size: 0.6em;
          background: rgba(0,0,0,0.3);
          color: var(--txt2);
          padding: 2px 5px;
          border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.05);
          font-weight: 700;
        }

        .edit-mini-btn {
          background: none;
          border: none;
          color: var(--txt2);
          padding: 4px;
          border-radius: 4px;
          font-size: 0.9em;
          cursor: pointer;
          transition: 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .edit-mini-btn:hover { 
          color: var(--txt0); 
          background: rgba(255,255,255,0.1);
          transform: rotate(15deg); 
        }
      `}} />
    </aside>
  );
}
