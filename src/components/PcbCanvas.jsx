import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
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
    tick,
    isProcessing
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

    // We add a 'forceCenterToggle' state to allow manual recentering via button click or resize events
    const [forceCenterToggle, setForceCenterToggle] = useState(false);

    // Watch for actual container dimension changes (e.g. ProcessingBar sliding up/down)
    useEffect(() => {
        if (!svgRef.current) return;
        const resizeObs = new ResizeObserver(() => setForceCenterToggle(true));
        resizeObs.observe(svgRef.current);
        return () => resizeObs.disconnect();
    }, []);

    // Bounding box for tracking, background fading, and zooming
    const bounds = useMemo(() => {
        if (components.length === 0) return null;
        let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
        components.forEach(c => {
            minCol = Math.min(minCol, c.ox);
            maxCol = Math.max(maxCol, c.ox + c.w - 1);
            minRow = Math.min(minRow, c.oy);
            maxRow = Math.max(maxRow, c.oy + c.h - 1);
        });
        wires.forEach(w => w.path?.forEach(pt => {
            minCol = Math.min(minCol, pt.col);
            maxCol = Math.max(maxCol, pt.col);
            minRow = Math.min(minRow, pt.row);
            maxRow = Math.max(maxRow, pt.row);
        }));
        return { minCol, maxCol, minRow, maxRow };
    }, [components, wires, tick]);

    const zoomVelRef = useRef(0);
    const smoothCenterRef = useRef(null);

    // Continuous smooth camera tracking and auto-zoom during processing
    useEffect(() => {
        if (!bounds) return;

        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return;

        const cx = (bounds.minCol + bounds.maxCol + 1) / 2 * SP;
        const cy = (bounds.minRow + bounds.maxRow + 1) / 2 * SP;

        // Initialize smooth center if needed
        if (!smoothCenterRef.current) {
            smoothCenterRef.current = { x: cx, y: cy };
        }

        let curZoom = zoom;
        let zoomChanged = false;

        if (isProcessing) {
            // 1. Calculate the 'ideal' zoom that would make the BB exactly 85% of viewport
            const targetCoverage = 0.85;
            const bbW = (bounds.maxCol - bounds.minCol + 1) * SP;
            const bbH = (bounds.maxRow - bounds.minRow + 1) * SP;
            const fitZoom = Math.min(
                (rect.width * targetCoverage) / bbW,
                (rect.height * targetCoverage) / bbH,
                5.0
            );

            // 2. Identify current coverage percentage
            const currentCoverageX = (bbW * curZoom) / rect.width;
            const currentCoverageY = (bbH * curZoom) / rect.height;
            const maxCoverage = Math.max(currentCoverageX, currentCoverageY);

            // 3. Dual-Box Hysteresis Logic
            const outerLimit = 0.90; // If coverage > 90%, zoom out
            const innerLimit = 0.80; // If coverage < 80%, zoom in

            let zoomAcc = 0;
            if (maxCoverage > outerLimit) {
                // Accelerate OUT (fitZoom will be smaller than curZoom)
                zoomAcc = (fitZoom - curZoom) * 0.005;
            } else if (maxCoverage < innerLimit) {
                // Accelerate IN (fitZoom will be larger than curZoom)
                zoomAcc = (fitZoom - curZoom) * 0.005;
            }

            // 4. Physics: Integrate Acceleration -> Velocity -> Position
            // Apply damping (friction) for critical damping feel
            zoomVelRef.current = zoomVelRef.current * 0.85 + zoomAcc;

            // Apply velocity to zoom
            if (Math.abs(zoomVelRef.current) > 0.00001) {
                curZoom += zoomVelRef.current;
                zoomChanged = true;
            }

            // 5. Smooth Centering: EMA to follow the BB center without high-frequency jitter
            // 0.05 factor gives a nice "lazy" follow feel
            smoothCenterRef.current.x += (cx - smoothCenterRef.current.x) * 0.05;
            smoothCenterRef.current.y += (cy - smoothCenterRef.current.y) * 0.05;
        } else {
            // Reset physics when not processing
            zoomVelRef.current = 0;
            smoothCenterRef.current = { x: cx, y: cy };
        }

        const useCx = smoothCenterRef.current.x;
        const useCy = smoothCenterRef.current.y;

        const targetX = rect.width / 2 - useCx * curZoom;
        const targetY = rect.height / 2 - useCy * curZoom;

        // If 'pan' hasn't been initialized (0,0) or manual button triggered, instantly snap
        if ((pan.x === 0 && pan.y === 0) || forceCenterToggle) {
            setPan({ x: targetX, y: targetY });
            if (zoomChanged) setZoom(curZoom);
            if (forceCenterToggle) setForceCenterToggle(false);
        } else if (isProcessing) {
            // Always update pan/zoom during processing to follow the smooth center/physics
            setPan({ x: targetX, y: targetY });
            if (zoomChanged) setZoom(curZoom);
        }
    }, [isProcessing, tick, forceCenterToggle, bounds]);

    // Labels for the board
    const labelsSvg = useMemo(() => {
        if (!bounds) return '';
        let out = '';
        const pad = 15; // wide margin for labels
        const minC = bounds.minCol - pad, maxC = bounds.maxCol + pad;
        const minR = bounds.minRow - pad, maxR = bounds.maxRow + pad;

        // X labels
        for (let c = minC; c <= maxC; c++) {
            if (c % 5 !== 0) continue;
            out += `<text x="${c * SP + SP / 2}" y="${(bounds.minRow - 0.6) * SP}" fill="rgba(0,187,144,0.3)" font-family="monospace" font-size="9" text-anchor="middle">${c}</text>`;
        }
        // Y labels
        for (let r = minR; r <= maxR; r++) {
            if (r % 5 !== 0) continue;
            out += `<text x="${(bounds.minCol - 0.8) * SP}" y="${r * SP + SP / 2 + 3}" fill="rgba(0,187,144,0.3)" font-family="monospace" font-size="9" text-anchor="end">${r}</text>`;
        }
        return out;
    }, [bounds]);

    // Memoize SVG parts for performance
    const background = useMemo(() => generateBackgroundSVG(cols, rows, bounds), [cols, rows, bounds]);
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
                    <g dangerouslySetInnerHTML={{ __html: labelsSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: wiresSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: ratsnestSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: componentsSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: boundingBoxSvg }} />
                </g>
            </svg>

            {/* Zoom & Recenter Controls */}
            <div className="zbx">
                <button className="zbtn" onClick={() => setZoom(z => z * 1.15)}>+</button>
                <button className="zbtn" onClick={() => setZoom(z => z * 0.87)}>−</button>
                <button className="zbtn" onClick={() => setForceCenterToggle(true)}>⊞</button>
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
