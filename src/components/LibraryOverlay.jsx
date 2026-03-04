import React, { useState, useEffect } from 'react';

export function LibraryOverlay({ isOpen, onClose, onSelect }) {
    const [db, setDb] = useState([]);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetch('/component_database.json')
            .then(r => r.json())
            .then(setDb)
            .catch(console.error);
    }, []);

    if (!isOpen) return null;

    const filtered = db.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.value.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="overlay-bg">
            <div className="modal">
                <div className="modal-header">
                    <h3>Component Library</h3>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
                <input
                    type="text"
                    placeholder="Search components (e.g., 'ESP32')..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                />
                <div className="lib-list">
                    {filtered.map((c, i) => (
                        <div key={i} className="lib-item" onClick={() => onSelect(c)}>
                            <div className="lib-swatch" style={{ background: c.color }}></div>
                            <div className="lib-info">
                                <div className="lib-name">{c.name}</div>
                                <div className="lib-val">{c.value} • {c.pins.length} pins</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        .lib-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .lib-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px;
          background: var(--bg3);
          border: 1px solid var(--border2);
          border-radius: 6px;
          cursor: pointer;
          transition: .12s;
        }
        .lib-item:hover { background: var(--bg4); border-color: var(--blu); }
        .lib-swatch { width: 32px; height: 32px; border-radius: 4px; flex-shrink: 0; }
        .lib-name { font-size: .85em; font-weight: 700; color: var(--txt0); }
        .lib-val { font-size: .7em; color: var(--txt2); margin-top: 2px; }
      `}} />
        </div>
    );
}
