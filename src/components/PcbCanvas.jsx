import React, { useRef, useState, useMemo, useCallback } from 'react';
import {
    generateWiresSVG,
    generateRatsnestSVG,
    renderCompSVG,
    SP,
    hitComp,
    generateBackgroundSVG
} from '../engine/render-utils.js';

export function PcbCanvas({
    components,
    wires,
    cols,
    rows,
    selectedId,
    onSelect,
    hoveredNet
}) {
    const svgRef = useRef(null);
    const [zoom, setZoom] = useState(1.0);
    const [pan, setPan] = useState({ x: 20, y: 20 });
    const [isPanning, setIsPanning] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });

    // Handle Wheel Zoom
    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(prev => Math.min(Math.max(prev * delta, 0.1), 5));
    }, []);

    const handlePointerDown = (e) => {
        // Middle click (1) or Right click (2) or Alt+Left (altKey)
        const isPanAction = e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey);

        if (isPanAction) {
            setIsPanning(true);
            lastPos.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
        } else if (e.button === 0) {
            // Selection logic
            const rect = svgRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left - pan.x) / zoom;
            const y = (e.clientY - rect.top - pan.y) / zoom;

            const gc = Math.floor(x / SP);
            const gr = Math.floor(y / SP);

            const hit = hitComp(gc, gr, components);
            onSelect?.(hit ? hit.id : null);
        }
    };

    const handlePointerMove = (e) => {
        if (isPanning) {
            const dx = e.clientX - lastPos.current.x;
            const dy = e.clientY - lastPos.current.y;
            setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            lastPos.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handlePointerUp = () => {
        setIsPanning(false);
    };

    // Memoize SVG parts for performance
    const background = useMemo(() => generateBackgroundSVG(cols, rows), [cols, rows]);
    const wiresSvg = useMemo(() => generateWiresSVG(wires, hoveredNet), [wires, hoveredNet]);
    const ratsnestSvg = useMemo(() => generateRatsnestSVG(components), [components]);
    const componentsSvg = useMemo(() =>
        components.map(c => renderCompSVG(c, c.id === selectedId)).join(''),
        [components, selectedId]
    );

    return (
        <div
            className="canvas-container"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
                cursor: isPanning ? 'grabbing' : 'crosshair',
                background: '#050706'
            }}
        >
            <svg
                ref={svgRef}
                width="100%"
                height="100%"
                style={{ display: 'block' }}
            >
                <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    <g dangerouslySetInnerHTML={{ __html: background }} />
                    <g dangerouslySetInnerHTML={{ __html: wiresSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: ratsnestSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: componentsSvg }} />
                </g>
            </svg>

            {/* Legacy Zoom Controls */}
            <div className="zbx">
                <button className="zbtn" onClick={() => setZoom(z => z * 1.15)}>+</button>
                <button className="zbtn" onClick={() => setZoom(z => z * 0.87)}>−</button>
                <button className="zbtn" onClick={() => { setPan({ x: 20, y: 20 }); setZoom(1.0); }}>⊞</button>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        .zbx {
          position: absolute;
          right: 10px;
          bottom: 34px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          z-index: 10;
        }
        .zbtn {
          width: 26px;
          height: 26px;
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--txt0);
          cursor: pointer;
          font-size: 1em;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: .14s;
        }
        .zbtn:hover { background: var(--bg4); }

        .pcb-comp {
            transition: filter 0.2s ease;
        }
        .pcb-comp:hover {
            filter: brightness(1.2);
        }
      `}} />
        </div>
    );
}
