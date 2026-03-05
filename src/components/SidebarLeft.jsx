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
          width: 18px;
          height: 18px;
          border-radius: 6px;
          background: var(--bg4);
          border: 1px solid var(--border2);
          font-size: .6em;
          font-weight: 800;
          color: var(--txt1);
          margin-right: 8px;
          font-family: 'Inter', sans-serif;
        }
        .sbadge.act { background: var(--grn-bright); color: #000; border-color: var(--grn-bright); }
        
        .tplbtn {
          padding: 6px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: .75em;
          font-weight: 600;
          background: var(--bg4);
          border: 1px solid var(--border);
          color: var(--txt0);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tplbtn:hover { 
          background: var(--bg3);
          border-color: var(--txt1);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .tplbtn.blu-bg { 
          background: var(--blu); 
          color: #fff; 
          border-color: rgba(255,255,255,0.1); 
          box-shadow: 0 2px 8px rgba(31, 111, 235, 0.3);
        }
        .tplbtn.blu-bg:hover { background: #388bfd; box-shadow: 0 4px 16px rgba(31, 111, 235, 0.5); }

        .tplbtn.grn-bg { 
          background: var(--grn); 
          color: #fff; 
          border-color: rgba(255,255,255,0.1);
          box-shadow: 0 2px 8px rgba(35, 134, 54, 0.3);
        }
        .tplbtn.grn-bg:hover { background: #2ea043; box-shadow: 0 4px 16px rgba(35, 134, 54, 0.5); }

        .comp-card {
          position: relative;
          background: var(--bg3);
          border: 1px solid var(--border);
          border-left: 4px solid var(--comp-color);
          border-radius: 10px;
          padding: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .comp-card:hover { 
          transform: translateX(4px);
          border-color: var(--border2);
          background: var(--bg4);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        
        .comp-card.sel { 
          background: var(--bg4);
          border-color: var(--blu);
          box-shadow: 0 0 0 1px var(--blu), 0 8px 24px rgba(0,0,0,0.4);
        }

        .comp-id-tag {
          font-family: 'Consolas', monospace;
          font-weight: 800;
          font-size: 0.95em;
          color: var(--txt0);
          min-width: 28px;
          background: rgba(255,255,255,0.05);
          padding: 2px 4px;
          border-radius: 4px;
          text-align: center;
        }

        .comp-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0; /* CRITICAL for truncation */
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
          font-size: 0.7em;
          color: var(--txt1);
          font-family: 'Consolas', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .comp-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0; /* Don't squash the icons */
        }

        .comp-pins-tag {
          font-size: 0.65em;
          background: var(--bg0);
          color: var(--txt1);
          padding: 2px 6px;
          border-radius: 100px;
          border: 1px solid var(--border);
          font-weight: 700;
        }

        .edit-mini-btn {
          background: var(--bg2);
          border: 1px solid var(--border);
          color: var(--txt1);
          width: 24px;
          height: 24px;
          border-radius: 6px;
          font-size: 0.8em;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .edit-mini-btn:hover { 
          color: var(--txt0); 
          background: var(--blu);
          border-color: var(--blu);
          transform: rotate(45deg); 
        }
      `}} />
    </aside>
  );
}
