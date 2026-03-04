import React, { useRef, useState, useEffect, useCallback } from 'react';
import { renderCompSVG, generateWiresSVG, generateRatsnestSVG } from '../engine/render-utils.js';

const SP = 1.0; // Standard pitch

export function PcbCanvas({ components = [], wires = [], cols = 22, rows = 16, selectedId = null, onSelect }) {
    const containerRef = useRef(null);
    const [view, setView] = useState({ x: 0, y: 0, zoom: 35 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.1 : 0.9;
        const newZoom = Math.min(Math.max(view.zoom * factor, 5), 200);

        // Zoom toward cursor (bonus polish!)
        const rect = containerRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const wx = (mx - view.x) / view.zoom;
        const wy = (my - view.y) / view.zoom;

        const nx = mx - wx * newZoom;
        const ny = my - wy * newZoom;

        setView(prev => ({ ...prev, zoom: newZoom, x: nx, y: ny }));
    }, [view]);

    const handleMouseDown = (e) => {
        if (e.button === 1 || (e.button === 0 && e.altKey)) { // Middle click or Alt+Left for pan
            setIsPanning(true);
            setLastPos({ x: e.clientX, y: e.clientY });
            e.preventDefault();
        }
    };

    const handleMouseMove = (e) => {
        if (isPanning) {
            const dx = e.clientX - lastPos.x;
            const dy = e.clientY - lastPos.y;
            setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            setLastPos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUp = () => setIsPanning(false);

    // Initial centering of the board
    useEffect(() => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const bw = cols * view.zoom;
            const bh = rows * view.zoom;
            setView(prev => ({
                ...prev,
                x: (rect.width - bw) / 2,
                y: (rect.height - bh) / 2
            }));
        }
    }, []); // Only on mount

    const gridLines = [];
    for (let c = 0; c <= cols; c++) {
        gridLines.push(<line key={`vc-${c}`} x1={c} y1={0} x2={c} y2={rows} stroke="#222" strokeWidth="0.02" />);
    }
    for (let r = 0; r <= rows; r++) {
        gridLines.push(<line key={`hr-${r}`} x1={0} y1={r} x2={cols} y2={r} stroke="#222" strokeWidth="0.02" />);
    }

    return (
        <div
            ref={containerRef}
            className="canvas-area"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: isPanning ? 'grabbing' : 'default' }}
        >
            <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ position: 'absolute', pointerEvents: 'none' }}
            >
                {/* Board Boundary Shadow/Glow */}
                <rect
                    x={view.x / view.zoom - 0.5}
                    y={view.y / view.zoom - 0.5}
                    width={cols + 1}
                    height={rows + 1}
                    fill="none"
                    stroke="rgba(0, 217, 126, 0.1)"
                    strokeWidth="0.2"
                    transform={`translate(${view.x}, ${view.y}) scale(${view.zoom})`}
                />
            </svg>

            <svg
                width="100%"
                height="100%"
                style={{ overflow: 'visible' }}
            >
                <g transform={`translate(${view.x}, ${view.y}) scale(${view.zoom})`}>
                    {/* 1. Board Background */}
                    <rect x={0} y={0} width={cols} height={rows} fill="#0d0e10" />

                    {/* 2. Grid Lines */}
                    {gridLines}

                    {/* 3. Ratsnest (Airwires) */}
                    <g dangerouslySetInnerHTML={{ __html: generateRatsnestSVG(components) }} />

                    {/* 4. Routed Wires */}
                    <g dangerouslySetInnerHTML={{ __html: generateWiresSVG(wires) }} />

                    {/* 5. Components */}
                    {components.map(c => (
                        <g
                            key={c.id}
                            onClick={(e) => { e.stopPropagation(); onSelect?.(c.id); }}
                            className="pcb-comp"
                            style={{ cursor: 'pointer', transition: 'filter 0.1s ease' }}
                            dangerouslySetInnerHTML={{ __html: renderCompSVG(c, selectedId === c.id) }}
                        />
                    ))}
                </g>
            </svg>

            {/* View Stats Overlays */}
            <div style={{
                position: 'absolute', bottom: 12, right: 12,
                fontSize: 10, color: 'var(--text-dim)',
                background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: 4
            }}>
                {cols}×{rows} | Zoom: {Math.round(view.zoom)}%
            </div>
        </div>
    );
}
