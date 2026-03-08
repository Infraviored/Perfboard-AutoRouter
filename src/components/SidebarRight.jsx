import React from 'react';
import { netColor } from '../engine/render-utils.js';

export function SidebarRight({
    stats,
    selectedComp,
    nets,
    hoveredNet,
    setHoveredNet
}) {
    return (
        <aside id="rsb">
            <div className="ph">📊 Stats</div>
            <div className="sgrid">
                <div className="scard">
                    <div className="sv">{stats.components}</div>
                    <div className="sl">Components</div>
                </div>
                <div className="scard">
                    <div className="sv">{stats.nets}</div>
                    <div className="sl">Nets</div>
                </div>
                <div className="scard">
                    <div className="sv">{stats.routed}</div>
                    <div className="sl">Routed</div>
                </div>
                <div className="scard">
                    <div className="sv" style={{ color: stats.failed > 0 ? 'var(--red)' : 'var(--grn)' }}>{stats.failed}</div>
                    <div className="sl">Failed</div>
                </div>
                <div className="scard w2">
                    <div className="sv">{stats.wireLength || '—'}</div>
                    <div className="sl">Wire length (holes)</div>
                </div>
                <div className="scard w2">
                    <div className="sv">{stats.footprint || '—'}</div>
                    <div className="sl">Footprint (W×H)</div>
                </div>
                <div className="scard w2">
                    <div className="sv">{stats.area || '—'}</div>
                    <div className="sl">Area (holes²)</div>
                </div>
                <div className="scard w2">
                    <div className="sv" style={{ color: stats.completion >= 100 ? 'var(--grn)' : 'var(--org)', fontSize: '.9em' }}>
                        {stats.completion !== null ? `${stats.completion}% ${stats.completion === 100 ? '✓' : ''}` : '—'}
                    </div>
                    <div className="sl">Completion</div>
                </div>
            </div>

            <div className="ph">🔧 Selected</div>
            <div id="selInfo">
                {!selectedComp ? (
                    <div className="prop-row"><span className="pk">—</span><span className="pv">nothing</span></div>
                ) : (
                    <>
                        <div className="prop-row"><span className="pk">ID</span><span className="pv">{selectedComp.id}</span></div>
                        <div className="prop-row"><span className="pk">Name</span><span className="pv">{selectedComp.name}</span></div>
                        <div className="prop-row"><span className="pk">Value</span><span className="pv">{selectedComp.value}</span></div>
                        <div className="prop-row"><span className="pk">Origin</span><span className="pv">({selectedComp.ox}, {selectedComp.oy})</span></div>
                        <div className="prop-row"><span className="pk">Pins</span><span className="pv">{selectedComp.pins.length}</span></div>
                        {selectedComp.pins.map((p, i) => (
                            <div className="prop-row" key={i}>
                                <span className="pk" style={{ color: netColor(p.net) }}>{p.lbl}</span>
                                <span className="pv">{p.net || '—'}</span>
                            </div>
                        ))}
                    </>
                )}
            </div>

            <div className="ph">🌐 Nets</div>
            <div id="netPanel" className="scroll-container">
                {Object.entries(nets).map(([name, pins]) => (
                    <div
                        key={name}
                        className={`prop-row ${hoveredNet === name ? 'hov' : ''}`}
                        onMouseEnter={() => setHoveredNet(name)}
                        onMouseLeave={() => setHoveredNet(null)}
                        style={{ cursor: 'pointer' }}
                    >
                        <span className="pk">
                            <span className="net-dot" style={{ background: netColor(name) }}></span>
                        </span>
                        <span className="pv" style={{ fontSize: '.95em' }}>{name}</span>
                        <span style={{ fontSize: '.85em', color: 'var(--txt2)', fontWeight: 600 }}>{pins.length}P</span>
                    </div>
                ))}
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        #rsb {
          width: var(--rsb-width);
          background: var(--bg2);
          border-left: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          grid-area: rsb;
          overflow: hidden;
        }
        .sgrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 12px;
        }
        .scard {
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 12px 8px;
          text-align: center;
          transition: transform 0.2s, background 0.2s;
        }
        .scard:hover {
          transform: translateY(-2px);
          background: var(--bg4);
          border-color: var(--border2);
        }
        .scard.w2 { grid-column: span 2; }
        .sv {
          font-family: 'Outfit', sans-serif;
          font-size: 1.2em;
          font-weight: 800;
          color: var(--blu-bright);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
        }
        .sl {
          font-size: .65em;
          color: var(--txt1);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-top: 6px;
        }

        .prop-row {
          display: flex;
          align-items: center;
          padding: 10px 16px;
          gap: 12px;
          border-bottom: 1px solid var(--border);
          font-size: .82em;
          transition: background 0.1s;
        }
        .prop-row:hover { background: rgba(255,255,255,0.02); }
        .prop-row.hov { background: rgba(31, 111, 235, 0.1); }
        .pk { color: var(--txt1); width: 70px; flex-shrink: 0; font-weight: 600; font-size: .8em; text-transform: uppercase; letter-spacing: 0.05em; }
        .pv { color: var(--txt0); flex: 1; font-family: 'Consolas', monospace; font-size: 1em; overflow: hidden; text-overflow: ellipsis; }
        
        .net-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          vertical-align: middle;
          box-shadow: 0 0 6px rgba(0,0,0,0.5);
        }
      `}} />
        </aside>
    );
}
