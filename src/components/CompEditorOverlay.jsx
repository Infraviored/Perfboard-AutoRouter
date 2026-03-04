import React, { useState } from 'react';

export function CompEditorOverlay({ component, isOpen, onClose, onSave }) {
    const [data, setData] = useState(() => component ? JSON.parse(JSON.stringify(component)) : null);

    if (!isOpen || !data) return null;

    const handleUpdate = (field, val) => setData(prev => ({ ...prev, [field]: val }));

    return (
        <div className="overlay-bg">
            <div className="modal editor">
                <div className="modal-header">
                    <h3>Edit Component: {data.id}</h3>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                <div className="grid-2">
                    <div>
                        <label>ID</label>
                        <input type="text" value={data.id} onChange={e => handleUpdate('id', e.target.value)} />
                    </div>
                    <div>
                        <label>Name</label>
                        <input type="text" value={data.name} onChange={e => handleUpdate('name', e.target.value)} />
                    </div>
                </div>

                <div className="grid-2">
                    <div>
                        <label>Value</label>
                        <input type="text" value={data.value} onChange={e => handleUpdate('value', e.target.value)} />
                    </div>
                    <div>
                        <label>Color</label>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <input type="color" value={data.color} onChange={e => handleUpdate('color', e.target.value)} style={{ width: 40, padding: 0, height: 32 }} />
                            <input type="text" value={data.color} onChange={e => handleUpdate('color', e.target.value)} style={{ flex: 1 }} />
                        </div>
                    </div>
                </div>

                <div className="pin-list-area">
                    <label>Pins ({data.pins.length})</label>
                    <div className="pin-scroller">
                        {data.pins.map((p, i) => (
                            <div key={i} className="pin-edit-row">
                                <span className="p-idx">{i + 1}</span>
                                <input
                                    className="p-lbl"
                                    type="text"
                                    value={p.lbl}
                                    onChange={e => {
                                        const next = [...data.pins];
                                        next[i].lbl = e.target.value;
                                        setData({ ...data, pins: next });
                                    }}
                                />
                                <input
                                    className="p-net"
                                    type="text"
                                    placeholder="NET"
                                    value={p.net || ''}
                                    onChange={e => {
                                        const next = [...data.pins];
                                        next[i].net = e.target.value;
                                        setData({ ...data, pins: next });
                                    }}
                                />
                                <span className="p-off">({p.dCol},{p.dRow})</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn" onClick={onClose}>Cancel</button>
                    <button className="btn grn" onClick={() => onSave(data)}>Save Changes</button>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        .modal.editor { max-width: 600px; width: 95%; height: auto; max-height: 90vh; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .pin-list-area { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
        .pin-scroller { flex: 1; overflow-y: auto; border: 1px solid var(--border); border-radius: 4px; background: var(--bg3); padding: 5px; }
        .pin-edit-row { display: flex; align-items: center; gap: 8px; padding: 4px; border-bottom: 1px solid var(--border); }
        .p-idx { font-size: .7em; color: var(--txt2); width: 15px; }
        .p-lbl { width: 80px; }
        .p-net { flex: 1; color: var(--blu); }
        .p-off { font-size: .65em; color: var(--txt2); width: 50px; text-align: right; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
      `}} />
        </div>
    );
}
