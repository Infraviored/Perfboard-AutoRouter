import React, { useRef, useState, useMemo, useCallback } from 'react';
import {
    generateWiresSVG,
    generateRatsnestSVG,
    renderCompSVG,
    SP,
    hitComp,
    generateBackgroundSVG,
    generateBoundingBoxSVG
} from '../engine/render-utils.js';

export function PcbCanvas({
    components,
    wires,
    cols,
    rows,
    selectedId,
    onSelect,
    hoveredNet,
    onMove,
    onRotate,
    onMoveEnd,
    tick
}) {
    const svgRef = useRef(null);
    const [zoom, setZoom] = useState(1.0);
    const [pan, setPan] = useState({ x: 20, y: 20 });
    const [isPanning, setIsPanning] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });

    const [draggingId, setDraggingId] = useState(null);
    const [dragOffset, setDragOffset] = useState({ dc: 0, dr: 0 });
    const moveRaf = useRef(null);

    // Handle Wheel Zoom
    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(prev => Math.min(Math.max(prev * delta, 0.1), 5));
    }, []);

    const handlePointerDown = (e) => {
        const isRight = e.button === 2;
        const isPanAction = e.button === 1 || isRight || (e.button === 0 && e.altKey);

        const rect = svgRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left - pan.x) / zoom;
        const y = (e.clientY - rect.top - pan.y) / zoom;
        const gc = Math.floor(x / SP);
        const gr = Math.floor(y / SP);

        if (isRight && draggingId) {
            onRotate?.(draggingId);
            e.preventDefault();
            return;
        }

        if (isPanAction) {
            setIsPanning(true);
            lastPos.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
        } else if (e.button === 0) {
            const hit = hitComp(gc, gr, components);
            if (hit) {
                onSelect?.(hit.id);
                setDraggingId(hit.id);
                setDragOffset({ dc: gc - hit.ox, dr: gr - hit.oy });
                e.target.setPointerCapture(e.pointerId);
            } else {
                onSelect?.(null);
            }
        }
    };

    const handlePointerMove = (e) => {
        if (isPanning) {
            const dx = e.clientX - lastPos.current.x;
            const dy = e.clientY - lastPos.current.y;
            setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            lastPos.current = { x: e.clientX, y: e.clientY };
        } else if (draggingId) {
            const rect = svgRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left - pan.x) / zoom;
            const y = (e.clientY - rect.top - pan.y) / zoom;
            const gc = Math.floor(x / SP);
            const gr = Math.floor(y / SP);

            if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
            moveRaf.current = requestAnimationFrame(() => {
                onMove?.(draggingId, gc - dragOffset.dc, gr - dragOffset.dr);
            });
        }
    };

    const handlePointerUp = (e) => {
        if (draggingId) {
            if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
            onMoveEnd?.();
            setDraggingId(null);
        }
        setIsPanning(false);
    };

    // Right-click rotation during drag often needs mousedown for multi-button mouse reliability
    const handleMouseDown = (e) => {
        if (e.button === 2 && draggingId) {
            onRotate?.(draggingId);
            e.preventDefault();
            e.stopPropagation();
        }
    };

    // Memoize SVG parts for performance
    const background = useMemo(() => generateBackgroundSVG(cols, rows), [cols, rows]);
    const wiresSvg = useMemo(() => generateWiresSVG(wires, hoveredNet), [wires, hoveredNet, tick]);
    const ratsnestSvg = useMemo(() => generateRatsnestSVG(components, wires, !!draggingId), [components, wires, draggingId, tick]);
    const componentsSvg = useMemo(() =>
        components.map(c => renderCompSVG(c, c.id === selectedId)).join(''),
        [components, selectedId, tick]
    );
    const boundingBoxSvg = useMemo(() => generateBoundingBoxSVG(components, wires), [components, wires, tick]);

    return (
        <div
            className="canvas-container"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
                cursor: (isPanning || draggingId) ? 'grabbing' : 'crosshair',
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
                    <g dangerouslySetInnerHTML={{ __html: boundingBoxSvg }} />
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
        .canvas-container {
            user-select: none;
            -webkit-user-select: none;
        }
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
