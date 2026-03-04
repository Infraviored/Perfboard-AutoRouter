import React, { useState } from 'react';

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
    onCopyPrompt
}) {
    const [localCols, setLocalCols] = useState(cols);
    const [localRows, setLocalRows] = useState(rows);

    const handleApply = () => {
        onApplyBoard(parseInt(localCols), parseInt(localRows));
    };

    return (
        <aside id="lsb">
            {/* 1. Board Section */}
            <div className="ph">
                <span><span className="sbadge act">1</span>Board</span>
            </div>
            <div className="lbody">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                        <label>Cols (X)</label>
                        <input
                            type="number"
                            value={localCols}
                            onChange={(e) => setLocalCols(e.target.value)}
                            min="5" max="80"
                        />
                    </div>
                    <div>
                        <label>Rows (Y)</label>
                        <input
                            type="number"
                            value={localRows}
                            onChange={(e) => setLocalRows(e.target.value)}
                            min="5" max="60"
                        />
                    </div>
                </div>
                <button className="btn grn" onClick={handleApply}>Apply Board</button>
                <button className="btn" style={{ fontSize: '.7em' }} onClick={onCutToBoundingBox}>✂ Cut to Bounding Box</button>
            </div>

            {/* 2. Circuit Definition Section */}
            <div className="ph">
                <span><span className="sbadge">2</span>Circuit Definition</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="tplbtn" onClick={onCopyPrompt} title="Copy instructions for LLM">🤖 Prompt</button>
                    <button className="tplbtn" onClick={onLoadTemplate}>📋 Template</button>
                </div>
            </div>
            <div className="lbody">
                <textarea
                    placeholder="Paste JSON or generate with an LLM..."
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    spellCheck="false"
                />
                <button className="btn blu" onClick={onLoadCircuit}>▶ Load Circuit</button>
            </div>

            {/* 3. Components Section */}
            <div className="ph">
                <span><span className="sbadge">3</span>Components</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="tplbtn blu-bg" onClick={onOpenLibrary}>📚 Library</button>
                    <button className="tplbtn grn-bg" onClick={onAddNewComponent}>+ New</button>
                </div>
            </div>
            <div className="scroll-container lbody" style={{ gap: '4px' }}>
                {components.length === 0 ? (
                    <div style={{ fontSize: '.7em', color: 'var(--txt2)', textAlign: 'center', padding: '10px' }}>Load components first.</div>
                ) : (
                    components.map(c => (
                        <div
                            key={c.id}
                            className={`comp-card ${selectedId === c.id ? 'sel' : ''}`}
                            onClick={() => onSelectComponent(c.id)}
                            style={{ borderLeft: `4px solid ${c.color}` }}
                        >
                            <span style={{ fontWeight: 600 }}>{c.id}</span>
                            <span style={{ color: 'var(--txt2)', fontSize: '.88em' }}>{c.value}</span>
                            <span style={{ color: 'var(--txt2)', fontSize: '.78em' }}>{c.pins.length}p</span>
                            <button
                                className="edit-mini-btn"
                                onClick={(e) => { e.stopPropagation(); onEditComponent(c.id); }}
                            >
                                Edit
                            </button>
                        </div>
                    ))
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
          padding: 3px 7px;
          border-radius: 4px;
          cursor: pointer;
          font-size: .7em;
          background: var(--bg4);
          border: 1px solid var(--border2);
          color: var(--txt1);
        }
        .tplbtn:hover { color: var(--txt0); }
        .tplbtn.blu-bg { background: var(--blu); color: #fff; border-color: var(--blu); }
        .tplbtn.grn-bg { background: var(--grn); color: #000; border-color: var(--grn); }

        .comp-card {
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 5px;
          padding: 6px 9px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: .72em;
          cursor: pointer;
          transition: .12s;
        }
        .comp-card:hover { background: var(--bg4); border-color: var(--border2); }
        .comp-card.sel { border-color: var(--blu); background: #0d1f3a; }

        .edit-mini-btn {
          margin-left: auto;
          background: var(--blu);
          border: 1px solid var(--blu);
          color: #fff;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: .7em;
          cursor: pointer;
        }
      `}} />
        </aside>
    );
}
