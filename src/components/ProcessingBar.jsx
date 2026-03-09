import React, { useMemo, useEffect } from 'react';
import { SP, netColor, renderCompSVG } from '../engine/render-utils.js';

export function ProcessingBar({ status, bestSnapshot, onGoodEnough }) {
  const active = !!status.isProcessing || !!status.results;
  const results = status.results;

  // Hooks must always run before any early return
  useEffect(() => {
    if (!active || results) return;
    const onKey = (e) => { if (e.key === 'Escape') onGoodEnough(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onGoodEnough, active, results]);

  // Compute bounding box of current best board
  const preview = useMemo(() => {
    const comps = bestSnapshot?.components;
    const wires = bestSnapshot?.wires ?? [];
    if (!comps?.length) return null;

    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    comps.forEach(c => {
      if (!isFinite(c.ox) || !isFinite(c.oy)) return;
      minC = Math.min(minC, c.ox);
      maxC = Math.max(maxC, c.ox + c.w);
      minR = Math.min(minR, c.oy);
      maxR = Math.max(maxR, c.oy + c.h);
    });
    if (!isFinite(minC)) return null;

    wires.forEach(w => w.path?.forEach(pt => {
      minC = Math.min(minC, pt.col);
      maxC = Math.max(maxC, pt.col + 1);
      minR = Math.min(minR, pt.row);
      maxR = Math.max(maxR, pt.row + 1);
    }));

    const strokeWidth = 2;
    const padPx = 3;
    const pad = padPx / SP;
    minC -= pad; minR -= pad;
    maxC += pad; maxR += pad;

    // Ensure all metrics are valid numbers
    if (![minC, maxC, minR, maxR].every(isFinite)) return null;

    const W = Math.round((maxC - minC) * SP);
    const H = Math.round((maxR - minR) * SP);
    if (W <= 0 || H <= 0) return null;

    let inner = '';
    // PCB Background color
    inner += `<rect width="${W}" height="${H}" fill="#1a1208" rx="7"/>`;

    // Background drill holes
    for (let c = Math.ceil(minC); c < Math.floor(maxC); c++) {
      for (let r = Math.ceil(minR); r < Math.floor(maxR); r++) {
        const cx = Math.round((c - minC) * SP + SP / 2);
        const cy = Math.round((r - minR) * SP + SP / 2);
        inner += `<circle cx="${cx}" cy="${cy}" r="${Math.round(SP * .22)}" fill="#b87333"/><circle cx="${cx}" cy="${cy}" r="${Math.round(SP * .09)}" fill="#0d0a06"/>`;
      }
    }
    // Wires
    wires.forEach(w => {
      if (!w.path?.length || w.failed) return;
      const pts = w.path.map(pt => `${Math.round((pt.col - minC) * SP + SP / 2)},${Math.round((pt.row - minR) * SP + SP / 2)}`).join(' ');
      inner += `<polyline points="${pts}" fill="none" stroke="${netColor(w.net)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    // Components
    comps.forEach(c => {
      // Shift component origin and pins by minC/minR
      const sc = {
        ...c,
        ox: c.ox - minC,
        oy: c.oy - minR,
        pins: c.pins.map(p => ({ ...p, col: p.col - minC, row: p.row - minR }))
      };
      inner += renderCompSVG(sc, false);
    });

    // Outer border matching generateBoundingBoxSVG
    inner += `<rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="${W - strokeWidth}" height="${H - strokeWidth}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="${strokeWidth}" stroke-dasharray="8 6" rx="7"/>`;

    return { W, H, inner };
  }, [bestSnapshot]);

  // Determine content type
  let barContent = null;
  const isResults = !!results;
  const isShown = active || isResults;

  if (isResults) {
    const s = results.startScore;
    const f = results.score;
    const areaGain = s.area > 0 ? Math.round((s.area - f.area) / s.area * 100) : 0;
    const wlGain = s.wl > 0 ? Math.round((s.wl - f.wl) / s.wl * 100) : 0;

    barContent = (
      <>
        <div className="pb-left">
          <div className="pb-title success">Optimization Successful</div>
          <div className="res-grid">
            <div className="res-item">
              <div className="res-label">Footprint</div>
              <div className="res-val">{areaGain > 0 ? `-${areaGain}%` : 'Optimal'}</div>
              <div className="res-sub">{s.width}×{s.height} → {f.width}×{f.height} holes</div>
            </div>
            <div className="res-item">
              <div className="res-label">Wire Length</div>
              <div className="res-val">{wlGain > 0 ? `-${wlGain}%` : 'Optimal'}</div>
              <div className="res-sub">{s.wl} → {f.wl} holes</div>
            </div>
          </div>
        </div>
        {preview && (
          <div className="pb-preview">
            <div className="pb-preview-label">final design</div>
            <div className="pb-preview-wrap success">
              <svg viewBox={`-30 0 ${preview.W + 60} ${preview.H}`} style={{ height: '100%', maxWidth: '100%', display: 'block', overflow: 'visible' }}>
                <g dangerouslySetInnerHTML={{ __html: preview.inner }} />
              </svg>
            </div>
          </div>
        )}
      </>
    );
  } else if (active) {
    barContent = (
      <>
        <div className="pb-left">
          <div className="pb-title">{status.title || '…'}</div>
          {status.best && <div className="pb-best">{status.best}</div>}
          <div className="pb-track">
            <div className="pb-fill" style={{ width: `${status.progress}%` }} />
          </div>
          <button className="btn grn pb-btn" onClick={onGoodEnough}>
            ✓ Good Enough <span className="pb-esc">Esc</span>
          </button>
        </div>

        {preview && !status.title?.includes('Attempt') && (
          <div className="pb-preview">
            <div className="pb-preview-label">current best</div>
            <div className="pb-preview-wrap">
              <svg
                viewBox={`-30 0 ${preview.W + 60} ${preview.H}`}
                style={{ height: '100%', maxWidth: '100%', display: 'block', overflow: 'visible' }}
              >
                <g dangerouslySetInnerHTML={{ __html: preview.inner }} />
              </svg>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div id="proc-bar" className={`${isResults ? "results" : ""} ${isShown ? "shown" : ""}`}>
      <div className="pb-content-wrap">
        {barContent}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        #proc-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          padding: 0 32px;
          background: var(--glass-bg);
          backdrop-filter: blur(16px);
          border-top: 2px solid var(--grn-bright);
          height: 240px;
          box-shadow: var(--shadow-premium), 0 -4px 32px rgba(35, 134, 54, 0.2);
          z-index: 100;
          transition: opacity 0.3s ease;
          transform: none;
          opacity: 0;
          pointer-events: none;
        }
        #proc-bar.shown {
          opacity: 1;
          pointer-events: auto;
        }
        .pb-content-wrap {
          display: flex;
          align-items: center;
          gap: 32px;
          width: 100%;
          height: 100%;
        }
        .pb-left {
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex: 1;
          min-width: 0;
        }
        .pb-title {
          font-family: 'Outfit', sans-serif;
          font-size: 1.1em;
          color: var(--grn-bright);
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: -0.01em;
        }
        .pb-best {
          font-size: .85em;
          color: var(--txt1);
          white-space: nowrap;
          font-family: 'Consolas', monospace;
          background: rgba(255,255,255,0.03);
          padding: 4px 8px;
          border-radius: 4px;
          width: fit-content;
        }
        .pb-track {
          height: 8px;
          background: var(--bg4);
          border-radius: 100px;
          overflow: hidden;
          border: 1px solid var(--border);
        }
        .pb-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--grn), var(--grn-bright));
          transition: width .06s linear;
          box-shadow: 0 0 12px var(--grn);
        }
        .pb-btn {
          width: fit-content;
          padding: 10px 24px;
          font-size: .9em;
          border-radius: 10px;
        }
        .pb-esc {
          font-size: .75em;
          opacity: .8;
          margin-left: 10px;
          background: rgba(0,0,0,.4);
          padding: 2px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,.1);
          font-family: 'Inter', sans-serif;
          font-weight: 600;
        }
        .pb-preview {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
          height: 100%;
          justify-content: center;
          width: 220px;
          min-width: 220px;
        }
        .pb-preview-label {
          font-family: 'Inter', sans-serif;
          font-size: .65em;
          color: var(--txt1);
          text-transform: uppercase;
          letter-spacing: .15em;
          font-weight: 800;
        }
        .pb-preview-wrap {
          height: 180px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .pb-title.success { color: var(--grn-bright); font-size: 1.4em; }
        .res-grid { display: flex; gap: 40px; margin-top: 8px; }
        .res-item { display: flex; flex-direction: column; gap: 4px; }
        .res-label { font-size: 0.7em; text-transform: uppercase; color: var(--txt2); letter-spacing: 0.1em; font-weight: 700; }
        .res-val { font-size: 1.8em; font-weight: 800; color: #fff; font-family: 'Outfit', sans-serif; line-height: 1; }
        .res-sub { font-size: 0.75em; color: var(--txt1); font-family: 'Consolas', monospace; opacity: 0.8; }
        .pb-preview-wrap.success {  }
        #proc-bar.results { border-top-color: var(--grn-bright); background: linear-gradient(180deg, rgba(5,7,6,0.95) 0%, rgba(10,25,20,0.98) 100%); }
      `}} />
    </div>
  );
}
