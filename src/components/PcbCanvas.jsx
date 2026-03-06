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
import { CAMERA_CONFIG } from "../engine/config";


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

    // --- CONTINUOUS PHYSICS ENGINE (rAF) ---
    const zoomVelRef = useRef(0);
    const panVelRef = useRef({ x: 0, y: 0 });
    const smoothCenterRef = useRef({ x: 0, y: 0 });
    const targetBoundsRef = useRef(null);
    const lastTimeRef = useRef(0);
    const rAFRef = useRef(null);

    // Keep simulation state in refs so the rAF loop can access 'live' values 
    // without closure staleness, while still syncing to React for rendering.
    const simZoom = useRef(zoom);
    const simPan = useRef(pan);

    // 1. Sync React state changes back to Simulation (e.g. from mouse wheel)
    useEffect(() => { simZoom.current = zoom; }, [zoom]);
    useEffect(() => { simPan.current = pan; }, [pan.x, pan.y]);

    // 2. Sync incoming board updates to the "Latest Target" Reference
    useEffect(() => {
        targetBoundsRef.current = bounds;
    }, [bounds]);

    // 3. The Continuous Physics Thread
    const updatePhysics = useCallback((time) => {
        if (!svgRef.current) return;

        // Calculate Delta Time (dt) in seconds, capped to prevent massive jumps on tab-back
        if (!lastTimeRef.current) lastTimeRef.current = time;
        let dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
        lastTimeRef.current = time;

        const rect = svgRef.current.getBoundingClientRect();
        const b = targetBoundsRef.current;

        if (isProcessing && b && rect.width > 0) {
            const targetCX = (b.minCol + b.maxCol + 1) / 2 * SP;
            const targetCY = (b.minRow + b.maxRow + 1) / 2 * SP;

            // --- 1. ZOOM PHYSICS (Relaxed Hysteresis) ---
            const bbW = (b.maxCol - b.minCol + 1) * SP;
            const bbH = (b.maxRow - b.minRow + 1) * SP;

            const fitZoom = Math.min(
                (rect.width * CAMERA_CONFIG.TARGET_COVERAGE) / bbW,
                (rect.height * CAMERA_CONFIG.TARGET_COVERAGE) / bbH,
                CAMERA_CONFIG.MAX_ZOOM_FIT
            );

            const curZ = simZoom.current;
            const currentCoverage = Math.max((bbW * curZ) / rect.width, (bbH * curZ) / rect.height);

            // Relaxed Zoom Hysteresis
            let zoomAcc = 0;
            if (currentCoverage > CAMERA_CONFIG.ZOOM_OUT_THRESHOLD || currentCoverage < CAMERA_CONFIG.ZOOM_IN_THRESHOLD) {
                zoomAcc = (fitZoom - curZ) * CAMERA_CONFIG.ZOOM_STRENGTH;
            }

            const zoomDamping = Math.pow(CAMERA_CONFIG.ZOOM_DAMPING, dt);
            zoomVelRef.current = (zoomVelRef.current + zoomAcc * dt) * zoomDamping;
            simZoom.current += zoomVelRef.current * dt;

            // --- 2. PAN PHYSICS (Translation Hysteresis) ---
            // Current screen coordinates of the BB center
            const screenCX = rect.width / 2 - simPan.current.x;
            const screenCY = rect.height / 2 - simPan.current.y;
            // Target screen coordinates (normalized by zoom)
            const worldCX = smoothCenterRef.current.x;
            const worldCY = smoothCenterRef.current.y;

            // We calculate the error in pixels on screen
            const errorX = rect.width / 2 - (worldCX * simZoom.current + simPan.current.x);
            const errorY = rect.height / 2 - (worldCY * simZoom.current + simPan.current.y);

            // Pan Hysteresis Deadzone
            const deadzoneX = rect.width * CAMERA_CONFIG.PAN_DEADZONE_X;
            const deadzoneY = rect.height * CAMERA_CONFIG.PAN_DEADZONE_Y;

            let panAccX = 0;
            let panAccY = 0;

            if (Math.abs(errorX) > deadzoneX) {
                panAccX = errorX * CAMERA_CONFIG.PAN_STRENGTH;
            }
            if (Math.abs(errorY) > deadzoneY) {
                panAccY = errorY * CAMERA_CONFIG.PAN_STRENGTH;
            }

            // Integrate Pan Physics
            const panDamping = Math.pow(CAMERA_CONFIG.PAN_DAMPING, dt);
            panVelRef.current.x = (panVelRef.current.x + panAccX * dt) * panDamping;
            panVelRef.current.y = (panVelRef.current.y + panAccY * dt) * panDamping;

            simPan.current.x += panVelRef.current.x * dt;
            simPan.current.y += panVelRef.current.y * dt;

            // Also slowly drift the 'target' center towards the actual BB center
            // to ignore micro-jitter but follow large trends.
            smoothCenterRef.current.x += (targetCX - smoothCenterRef.current.x) * CAMERA_CONFIG.CENTER_FOLLOW_STRENGTH * dt;
            smoothCenterRef.current.y += (targetCY - smoothCenterRef.current.y) * CAMERA_CONFIG.CENTER_FOLLOW_STRENGTH * dt;

            // Sync to React State for Rendering
            setZoom(simZoom.current);
            setPan({ x: simPan.current.x, y: simPan.current.y });
        }

        rAFRef.current = requestAnimationFrame(updatePhysics);
    }, [isProcessing]);

    useEffect(() => {
        if (isProcessing) {
            lastTimeRef.current = performance.now();
            rAFRef.current = requestAnimationFrame(updatePhysics);
        } else {
            if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
            zoomVelRef.current = 0;
            lastTimeRef.current = 0;
        }
        return () => { if (rAFRef.current) cancelAnimationFrame(rAFRef.current); };
    }, [isProcessing, updatePhysics]);

    useEffect(() => {
        if (forceCenterToggle && bounds && svgRef.current) {
            const rect = svgRef.current.getBoundingClientRect();
            const cx = (bounds.minCol + bounds.maxCol + 1) / 2 * SP;
            const cy = (bounds.minRow + bounds.maxRow + 1) / 2 * SP;
            smoothCenterRef.current = { x: cx, y: cy };

            const bbW = (bounds.maxCol - bounds.minCol + 1) * SP;
            const bbH = (bounds.maxRow - bounds.minRow + 1) * SP;
            const fitZoom = Math.min((rect.width * 0.85) / bbW, (rect.height * 0.85) / bbH, 2.0);

            setZoom(fitZoom);
            setPan({ x: rect.width / 2 - cx * fitZoom, y: rect.height / 2 - cy * fitZoom });
            setForceCenterToggle(false);
        }
    }, [forceCenterToggle, bounds]);

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
