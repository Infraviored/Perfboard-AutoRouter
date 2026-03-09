import React from 'react';
import { netColor } from '../engine/render-utils.js';
import {
  BarChart3,
  Settings2,
  Network,
  Fingerprint,
  Tag,
  Hash,
  MapPin,
  Maximize
} from 'lucide-react';

export function SidebarRight({
  stats,
  selectedComp,
  nets,
  hoveredNet,
  setHoveredNet,
  selectedNet,
  setSelectedNet,
  activeNets = []
}) {
  return (
    <aside id="rsb">
      <div className="ph"><BarChart3 size={14} style={{ marginRight: '8px' }} />Stats</div>
      <div className="sgrid">
        <div className="scard">
          <div className="sv">{stats.components}</div>
          <div className="sl">Components</div>
        </div>
        <div className="scard">
          <div className="sv" style={{ color: 'var(--blu-bright)' }}>{stats.nets}</div>
          <div className="sl">Nets</div>
        </div>
        <div className="scard">
          <div className="sv" style={{ color: 'var(--grn-bright)' }}>{stats.routed}</div>
          <div className="sl">Routed</div>
        </div>
        <div className="scard">
          <div className="sv" style={{ color: stats.failed > 0 ? 'var(--red)' : 'var(--txt1)' }}>{stats.failed}</div>
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
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${stats.completion || 0}%`, background: stats.completion >= 100 ? 'var(--grn-bright)' : 'var(--blu-bright)' }}></div>
            <div className="progress-text">{stats.completion !== null ? `${stats.completion}%` : '—'}</div>
          </div>
          <div className="sl">Routing Completion</div>
        </div>
      </div>

      <div className="ph"><Maximize size={14} style={{ marginRight: '8px' }} />Selected</div>
      <div id="selInfo">
        {!selectedComp ? (
          <div className="empty-selection">
            <Fingerprint size={24} style={{ opacity: 0.2, marginBottom: '8px' }} />
            <div>No component selected</div>
          </div>
        ) : (
          <div className="prop-list">
            <div className="prop-item">
              <Tag size={12} className="prop-icon" />
              <div className="prop-label">ID</div>
              <div className="prop-value">{selectedComp.id}</div>
            </div>
            <div className="prop-item">
              <Settings2 size={12} className="prop-icon" />
              <div className="prop-label">Name</div>
              <div className="prop-value">{selectedComp.name}</div>
            </div>
            <div className="prop-item">
              <Hash size={12} className="prop-icon" />
              <div className="prop-label">Value</div>
              <div className="prop-value">{selectedComp.value}</div>
            </div>
            <div className="prop-item">
              <MapPin size={12} className="prop-icon" />
              <div className="prop-label">Origin</div>
              <div className="prop-value">({selectedComp.ox}, {selectedComp.oy})</div>
            </div>

            <div className="pin-list-header">Pins ({selectedComp.pins.length})</div>
            <div className="pin-list">
              {selectedComp.pins.map((p, i) => (
                <div className="pin-row" key={i}>
                  <span className="pin-label" style={{ borderLeft: `2px solid ${netColor(p.net)}` }}>{p.lbl}</span>
                  <span className="pin-net">{p.net || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="ph" style={{ borderTop: '1px solid var(--border)' }}><Network size={14} style={{ marginRight: '8px' }} />Nets</div>
      <div id="netPanel" className="scroll-container">
        {Object.entries(nets).map(([name, pins]) => {
          const isMarked = activeNets.includes(name);
          return (
            <div
              key={name}
              className={`net-row ${hoveredNet === name ? 'hov' : ''} ${isMarked ? 'sel' : ''}`}
              style={{ '--net-color': netColor(name) }}
              onMouseEnter={() => setHoveredNet(name)}
              onMouseLeave={() => setHoveredNet(null)}
              onClick={() => setSelectedNet(selectedNet === name ? null : name)}
            >
              <div className="net-dot" style={{ background: netColor(name) }}></div>
              <span className="net-name">{name}</span>
              <span className="net-count">{pins.length}P</span>
            </div>
          );
        })}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        #rsb {
          width: var(--rsb-width);
          background: var(--bg2);
          border-left: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          z-index: 10;
        }
        .sgrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 12px;
        }
        .scard {
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 8px;
          text-align: center;
          transition: 0.2s;
        }
        .scard:hover {
          background: var(--bg4);
          transform: translateY(-1px);
          border-color: var(--border2);
        }
        .scard.w2 { grid-column: span 2; }
        .sv {
          font-family: 'Outfit', sans-serif;
          font-size: 1.1em;
          font-weight: 800;
          color: var(--txt0);
          letter-spacing: -0.02em;
        }
        .sl {
          font-size: .6em;
          color: var(--txt1);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 4px;
        }

        .progress-container {
          height: 20px;
           background: var(--bg0);
           border-radius: 4px;
           margin-bottom: 2px;
           position: relative;
           overflow: hidden;
           border: 1px solid var(--border);
        }
        .progress-bar {
          height: 100%;
          transition: width 0.3s ease;
          opacity: 0.8;
        }
        .progress-text {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7em;
          font-weight: 800;
          color: #fff;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }

        .prop-list {
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .prop-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          border-bottom: 1px solid var(--border);
        }
        .prop-icon { color: var(--txt2); }
        .prop-label { font-size: 0.7em; color: var(--txt1); font-weight: 600; width: 45px; }
        .prop-value { font-size: 0.8em; color: var(--txt0); font-family: 'Consolas', monospace; }

        .empty-selection {
          padding: 30px 20px;
          text-align: center;
          color: var(--txt2);
          font-size: 0.75em;
        }

        .pin-list-header {
           font-size: 0.65em;
           font-weight: 800;
           color: var(--txt1);
           margin-top: 12px;
           margin-bottom: 4px;
           text-transform: uppercase;
        }
        .pin-list {
           display: grid;
           grid-template-columns: 1fr;
           gap: 2px;
           max-height: 200px;
           overflow-y: auto;
        }
        .pin-row {
          display: flex;
          justify-content: space-between;
          padding: 4px 8px;
          background: rgba(255,255,255,0.02);
          border-radius: 4px;
          font-size: 0.75em;
        }
        .pin-label { color: var(--txt1); padding-left: 6px; }
        .pin-net { color: var(--txt0); font-family: 'Consolas', monospace; }

        #netPanel {
          padding: 8px 12px 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .net-row {
          display: flex;
          align-items: center;
          padding: 6px 10px;
          gap: 10px;
          border: 1px solid var(--border);
          border-left: 3px solid var(--net-color);
          background: var(--bg3);
          border-radius: 6px;
          transition: all 0.2s;
          cursor: pointer;
          user-select: none;
        }
        .net-row:hover { 
          background: var(--bg4); 
          border-color: var(--border2);
          border-left-color: var(--net-color);
        }
        .net-row.sel {
           background: var(--bg4);
           border-color: var(--net-color);
           box-shadow: 0 0 0 1px var(--net-color), 0 0 12px color-mix(in srgb, var(--net-color), transparent 60%);
        }
        
        .net-dot {
          display: none; 
        }
        .net-name { flex: 1; font-size: 0.8em; color: var(--txt0); font-family: 'Consolas', monospace; font-weight: 600; }
        .net-count { 
          font-size: 0.62em; 
          font-weight: 800; 
          color: var(--txt2); 
          background: var(--bg2);
          padding: 1px 5px;
          border-radius: 4px;
          border: 1px solid var(--border);
        }
      `}} />
    </aside>
  );
}
