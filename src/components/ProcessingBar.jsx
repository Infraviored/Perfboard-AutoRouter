import React, { useMemo, useEffect } from 'react';
import { SP, netColor, renderCompSVG } from '../engine/render-utils.js';

export function ProcessingBar({ status, bestSnapshot, onGoodEnough }) {
  const active = status.isProcessing || !!status.title;

  // Hooks must always run before any early return
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => { if (e.key === 'Escape') onGoodEnough(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onGoodEnough, active]);

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

    const pad = 1;
    minC -= pad; minR -= pad;
    maxC += pad; maxR += pad;

    // Ensure all metrics are valid numbers
    if (![minC, maxC, minR, maxR].every(isFinite)) return null;

    const W = Math.round((maxC - minC) * SP);
    const H = Math.round((maxR - minR) * SP);
    if (W <= 0 || H <= 0) return null;

    let inner = '';
    // Background drill holes
    for (let c = minC; c < maxC; c++) {
      for (let r = minR; r < maxR; r++) {
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

    return { W, H, inner };
  }, [bestSnapshot]);

  if (!active) return null;

  return (
    <div id="proc-bar">
      {/* LEFT: progress info */}
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

      {/* RIGHT: bounding-box SVG cutout of current best */}
      {preview && !status.title?.includes('Attempt') && (
        <div className="pb-preview">
          <div className="pb-preview-label">current best</div>
          <div className="pb-preview-wrap">
            <svg
              viewBox={`0 0 ${preview.W} ${preview.H}`}
              style={{ height: '100%', maxWidth: '100%', display: 'block' }}
            >
              <rect width={preview.W} height={preview.H} fill="#1a1208" />
              <g dangerouslySetInnerHTML={{ __html: preview.inner }} />
            </svg>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
        #proc-bar {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 12px 24px;
          background: #0d1117;
          border-top: 2px solid var(--grn);
          flex-shrink: 0;
          height: 220px;
          box-shadow: 0 -8px 32px rgba(0,217,126,.15);
        }
        .pb-left {
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 1;
          min-width: 0;
        }
        .pb-title {
          font-size: .9em;
          color: var(--grn);
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pb-best {
          font-size: .8em;
          color: var(--txt1);
          white-space: nowrap;
        }
        .pb-track {
          height: 6px;
          background: var(--bg4);
          border-radius: 3px;
          overflow: hidden;
        }
        .pb-fill {
          height: 100%;
          background: var(--grn);
          transition: width .06s linear;
        }
        .pb-btn {
          width: fit-content;
          padding: 6px 20px;
          font-size: .85em;
        }
        .pb-esc {
          font-size: .8em;
          opacity: .6;
          margin-left: 8px;
          background: rgba(0,0,0,.3);
          padding: 2px 6px;
          border-radius: 3px;
          border: 1px solid rgba(255,255,255,.2);
        }
        .pb-preview {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          flex-shrink: 0;
          height: 100%;
          justify-content: center;
        }
        .pb-preview-label {
          font-size: .7em;
          color: var(--txt1);
          text-transform: uppercase;
          letter-spacing: .1em;
          font-weight: 700;
        }
        .pb-preview-wrap {
          border: 1px solid var(--border2);
          border-radius: 6px;
          overflow: hidden;
          height: 180px;
          min-width: 180px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1a1208;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
      `}} />
    </div>
  );
}
