import React, { useEffect, useState } from 'react';

export function Toast({ msg, type, onClear }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (msg) {
            const timer1 = setTimeout(() => setVisible(true), 0);
            const timer2 = setTimeout(() => {
                setVisible(false);
                setTimeout(onClear, 300); // Allow fade out
            }, 3000);
            return () => { clearTimeout(timer1); clearTimeout(timer2); };
        }
    }, [msg, onClear]);

    if (!msg && !visible) return null;

    return (
        <div id="toast" className={`${visible ? 'on' : ''} ${type || 'ok'}`}>
            {msg}
            <style dangerouslySetInnerHTML={{
                __html: `
        #toast {
          position: absolute;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          padding: 6px 14px;
          border-radius: 6px;
          font-size: .76em;
          z-index: 200;
          opacity: 0;
          transition: opacity .22s;
          pointer-events: none;
          background: var(--bg3);
          border: 1px solid var(--border2);
          white-space: nowrap;
        }
        #toast.on { opacity: 1; }
        #toast.ok { border-color: var(--grn); color: var(--grn); }
        #toast.inf { border-color: var(--blu); color: var(--blu); }
        #toast.warn { border-color: var(--org); color: var(--org); }
        #toast.err { border-color: var(--red); color: var(--red); }
      `}} />
        </div>
    );
}
