import React, { useEffect } from 'react';

export function Overlay({ status, onCancel }) {
  // ESC key = "Good Enough"
  useEffect(() => {
    if (!status.title && !status.isProcessing) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, status.title, status.isProcessing]);

  if (!status.title && !status.isProcessing) return null;

  return (
    <div id="overlay" className="on">
      <div className="ot">{status.title || 'Processing…'}</div>
      <div className="osteps">
        <div className={`ostep ${status.progress < 50 ? 'act' : 'done'}`}>① Placement</div>
        <div className={`ostep ${status.progress >= 50 ? 'act' : ''}`}>② Routing</div>
      </div>
      <div className="otrack">
        <div className="ofill" style={{ width: `${status.progress}%` }}></div>
      </div>
      {status.best && <div className="obest">{status.best}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <button className="btn grn" style={{ width: 'auto', marginTop: 10 }} onClick={onCancel}>
          ✓ Good Enough
        </button>
        <span style={{ fontSize: '.65em', color: 'var(--txt2)' }}>or press <kbd style={{ background: 'var(--bg4)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border2)' }}>Esc</kbd></span>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        #overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, .8);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          z-index: 100;
        }
        .ot { font-size: 1em; font-weight: 700; color: var(--grn); }
        .osteps { display: flex; gap: 10px; }
        .ostep {
          font-size: .7em;
          color: var(--txt2);
          padding: 3px 10px;
          border-radius: 10px;
          border: 1px solid var(--border);
        }
        .ostep.act { color: var(--grn); border-color: var(--grn); background: rgba(0, 217, 126, .07); }
        .ostep.done { color: var(--txt1); }
        .otrack { width: 260px; height: 4px; background: var(--bg4); border-radius: 2px; overflow: hidden; }
        .ofill { height: 100%; background: var(--grn); transition: width .06s; }
        .obest { font-size: .78em; color: var(--txt0); max-width: 360px; text-align: center; font-weight: 800; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(0, 217, 126, .45); background: rgba(0, 217, 126, .08); }
      `}} />
    </div>
  );
}
