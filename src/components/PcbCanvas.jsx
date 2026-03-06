import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
    SP,
    generateBackgroundSVG,
    generateWiresSVG,
    generateRatsnestSVG,
    renderCompSVG,
    generateBoundingBoxSVG,
    hitComp
} from "../engine/render-utils.js";
import { CAMERA_CONFIG } from "../engine/config";
import {
    Plus,
    Minus,
    Maximize,
    Crosshair,
    Grid3X3
} from 'lucide-react';

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
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
    const [draggingId, setDraggingId] = useState(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    const getMousePos = (e) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const rect = svgRef.current.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleWheel = (e) => {
        e.preventDefault();
        const pos = getMousePos(e);
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = zoom * delta;

        setPan({
            x: pos.x - (pos.x - pan.x) * delta,
            y: pos.y - (pos.y - pan.y) * delta
        });
        setZoom(newZoom);
    };

    const handlePointerDown = (e) => {
        const pos = getMousePos(e);
        const worldX = (pos.x - pan.x) / zoom;
        const worldY = (pos.y - pan.y) / zoom;
        const col = Math.floor(worldX / SP);
        const row = Math.floor(worldY / SP);

        const hit = hitComp(col, row, components);
        if (hit) {
            setDraggingId(hit.id);
            setDragOffset({ x: worldX - hit.ox * SP, y: worldY - hit.oy * SP });
            onSelect?.(hit.id);
        } else {
            setIsPanning(true);
            setLastPos(pos);
            onSelect?.(null);
        }
        e.target.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
        const pos = getMousePos(e);
        if (draggingId) {
            const worldX = (pos.x - pan.x) / zoom;
            const worldY = (pos.y - pan.y) / zoom;
            const nx = Math.round((worldX - dragOffset.x) / SP);
            const ny = Math.round((worldY - dragOffset.y) / SP);
            onMove?.(draggingId, nx, ny);
        } else if (isPanning) {
            setPan({
                x: pan.x + (pos.x - lastPos.x),
                y: pan.y + (pos.y - lastPos.y)
            });
            setLastPos(pos);
        }
    };

    const handlePointerUp = (e) => {
        if (draggingId) onMoveEnd?.();
        setDraggingId(null);
        setIsPanning(false);
        e.target.releasePointerCapture(e.pointerId);
    };

    const handleMouseDown = (e) => {
        if (e.button === 2 && draggingId) {
            onRotate?.(draggingId);
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const [forceCenterToggle, setForceCenterToggle] = useState(false);
    const [isAutoTracking, setIsAutoTracking] = useState(true);
    const hasInitializedFit = useRef(false);

    useEffect(() => {
        if (!svgRef.current) return;
        const resizeObs = new ResizeObserver(() => setForceCenterToggle(true));
        resizeObs.observe(svgRef.current);
        return () => resizeObs.disconnect();
    }, []);

    const bounds = useMemo(() => {
        if (components.length === 0 && wires.length === 0) {
            return { minCol: 0, minRow: 0, maxCol: cols, maxRow: rows };
        }
        let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
        for (const c of components) {
            minCol = Math.min(minCol, c.ox);
            minRow = Math.min(minRow, c.oy);
            maxCol = Math.max(maxCol, c.ox + c.w);
            maxRow = Math.max(maxRow, c.oy + c.h);
        }
        for (const w of wires) {
            for (const p of w.path) {
                minCol = Math.min(minCol, p.col);
                minRow = Math.min(minRow, p.row);
                maxCol = Math.max(maxCol, p.col);
                maxRow = Math.max(maxRow, p.row);
            }
        }
        if (minCol === maxCol) maxCol += 1;
        if (minRow === maxRow) maxRow += 1;
        return { minCol, minRow, maxCol, maxRow };
    }, [components, wires, cols, rows]);

    useEffect(() => {
        if (bounds && !hasInitializedFit.current) {
            setForceCenterToggle(true);
            hasInitializedFit.current = true;
        }
    }, [bounds]);

    const zoomVelRef = useRef(0);
    const panVelRef = useRef({ x: 0, y: 0 });
    const smoothCenterRef = useRef({ x: 0, y: 0 });
    const targetBoundsRef = useRef(null);
    const lastTimeRef = useRef(0);
    const rAFRef = useRef(null);
    const simZoom = useRef(zoom);
    const simPan = useRef(pan);

    useEffect(() => { simZoom.current = zoom; }, [zoom]);
    useEffect(() => { simPan.current = pan; }, [pan.x, pan.y]);
    useEffect(() => { targetBoundsRef.current = bounds; }, [bounds]);

    const updatePhysics = useCallback((time) => {
        if (!svgRef.current) return;
        if (!lastTimeRef.current) lastTimeRef.current = time;
        let dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
        lastTimeRef.current = time;

        const rect = svgRef.current.getBoundingClientRect();
        const b = targetBoundsRef.current;
        const shouldApplyPhysics = isAutoTracking && isProcessing && b && rect.width > 0;

        if (shouldApplyPhysics) {
            const targetCX = (b.minCol + b.maxCol + 1) / 2 * SP;
            const targetCY = (b.minRow + b.maxRow + 1) / 2 * SP;
            const bbW = (b.maxCol - b.minCol + 1) * SP;
            const bbH = (b.maxRow - b.minRow + 1) * SP;

            const fitZoom = Math.min(
                (rect.width * CAMERA_CONFIG.TARGET_COVERAGE) / bbW,
                (rect.height * CAMERA_CONFIG.TARGET_COVERAGE) / bbH,
                CAMERA_CONFIG.MAX_ZOOM_FIT
            );

            const curZ = simZoom.current;
            const currentCoverage = Math.max((bbW * curZ) / rect.width, (bbH * curZ) / rect.height);

            let zoomAcc = 0;
            if (currentCoverage > CAMERA_CONFIG.ZOOM_OUT_THRESHOLD || currentCoverage < CAMERA_CONFIG.ZOOM_IN_THRESHOLD) {
                zoomAcc = (fitZoom - curZ) * CAMERA_CONFIG.ZOOM_STRENGTH;
            }

            const zoomDamping = Math.pow(CAMERA_CONFIG.ZOOM_DAMPING, dt);
            zoomVelRef.current = (zoomVelRef.current + zoomAcc * dt) * zoomDamping;
            simZoom.current += zoomVelRef.current * dt;

            const worldCX = smoothCenterRef.current.x;
            const worldCY = smoothCenterRef.current.y;
            const errorX = rect.width / 2 - (worldCX * simZoom.current + simPan.current.x);
            const errorY = rect.height / 2 - (worldCY * simZoom.current + simPan.current.y);
            const deadzoneX = rect.width * CAMERA_CONFIG.PAN_DEADZONE_X;
            const deadzoneY = rect.height * CAMERA_CONFIG.PAN_DEADZONE_Y;

            let panAccX = 0, panAccY = 0;
            if (Math.abs(errorX) > deadzoneX) panAccX = errorX * CAMERA_CONFIG.PAN_STRENGTH;
            if (Math.abs(errorY) > deadzoneY) panAccY = errorY * CAMERA_CONFIG.PAN_STRENGTH;

            const panDamping = Math.pow(CAMERA_CONFIG.PAN_DAMPING, dt);
            panVelRef.current.x = (panVelRef.current.x + panAccX * dt) * panDamping;
            panVelRef.current.y = (panVelRef.current.y + panAccY * dt) * panDamping;

            simPan.current.x += panVelRef.current.x * dt;
            simPan.current.y += panVelRef.current.y * dt;

            smoothCenterRef.current.x += (targetCX - smoothCenterRef.current.x) * CAMERA_CONFIG.CENTER_FOLLOW_STRENGTH * dt;
            smoothCenterRef.current.y += (targetCY - smoothCenterRef.current.y) * CAMERA_CONFIG.CENTER_FOLLOW_STRENGTH * dt;

            setZoom(simZoom.current);
            setPan({ x: simPan.current.x, y: simPan.current.y });
        }
        rAFRef.current = requestAnimationFrame(updatePhysics);
    }, [isProcessing, isAutoTracking]);

    useEffect(() => {
        if (isProcessing) {
            lastTimeRef.current = performance.now();
            rAFRef.current = requestAnimationFrame(updatePhysics);
        } else {
            if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
            zoomVelRef.current = 0;
            panVelRef.current = { x: 0, y: 0 };
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
            const fitZoom = Math.min(
                (rect.width * CAMERA_CONFIG.TARGET_COVERAGE) / bbW,
                (rect.height * CAMERA_CONFIG.TARGET_COVERAGE) / bbH,
                CAMERA_CONFIG.MAX_ZOOM_FIT
            );
            setZoom(fitZoom);
            setPan({ x: rect.width / 2 - cx * fitZoom, y: rect.height / 2 - cy * fitZoom });
            setForceCenterToggle(false);
        }
    }, [forceCenterToggle, bounds]);

    const labelsSvg = useMemo(() => {
        if (!bounds) return '';
        let out = '';
        const pad = 15;
        const minC = bounds.minCol - pad, maxC = bounds.maxCol + pad;
        const minR = bounds.minRow - pad, maxR = bounds.maxRow + pad;
        for (let c = minC; c <= maxC; c++) {
            if (c % 5 !== 0) continue;
            out += `<text x="${c * SP + SP / 2}" y="${(bounds.minRow - 0.6) * SP}" fill="rgba(0,187,144,0.3)" font-family="monospace" font-size="9" text-anchor="middle">${c}</text>`;
        }
        for (let r = minR; r <= maxR; r++) {
            if (r % 5 !== 0) continue;
            out += `<text x="${(bounds.minCol - 0.8) * SP}" y="${r * SP + SP / 2 + 3}" fill="rgba(0,187,144,0.3)" font-family="monospace" font-size="9" text-anchor="end">${r}</text>`;
        }
        return out;
    }, [bounds]);

    const background = useMemo(() => generateBackgroundSVG(cols, rows, bounds), [cols, rows, bounds]);
    const wiresSvg = useMemo(() => generateWiresSVG(wires, hoveredNet), [wires, hoveredNet, tick]);
    const ratsnestSvg = useMemo(() => generateRatsnestSVG(components, wires, !!draggingId), [components, wires, draggingId, tick]);
    const componentsSvg = useMemo(() => components.map(c => renderCompSVG(c, c.id === selectedId)).join(''), [components, selectedId, tick]);
    const boundingBoxSvg = useMemo(() => generateBoundingBoxSVG(components, wires), [components, wires, tick]);

    return (
        <div className={`canvas-container ${isProcessing ? 'pb-active' : ''}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onMouseDown={handleMouseDown} onWheel={handleWheel} onContextMenu={(e) => e.preventDefault()} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor: (isPanning || draggingId) ? 'grabbing' : 'crosshair', background: '#050706', '--pb-height': '240px' }}>
            <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block' }}>
                <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    <g dangerouslySetInnerHTML={{ __html: background }} />
                    <g dangerouslySetInnerHTML={{ __html: labelsSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: wiresSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: ratsnestSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: componentsSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: boundingBoxSvg }} />
                </g>
            </svg>

            <div className="canvas-controls">
                <button className="cbtn" onClick={() => setZoom(z => z * 1.15)} title="Zoom In">
                    <Plus size={18} />
                </button>
                <button className="cbtn" onClick={() => setZoom(z => z * 0.87)} title="Zoom Out">
                    <Minus size={18} />
                </button>
                <button className="cbtn" onClick={() => setForceCenterToggle(true)} title="Center Board">
                    <Maximize size={18} />
                </button>
                <button className="cbtn" onClick={() => setIsAutoTracking(v => !v)} title={isAutoTracking ? "Disable Auto-Tracking" : "Enable Auto-Tracking"} style={{ color: isAutoTracking ? 'var(--grn-bright)' : 'inherit' }}>
                    <Crosshair size={18} />
                </button>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .canvas-container { user-select: none; -webkit-user-select: none; }
                .canvas-controls { position: absolute; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 10; transition: bottom 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
                .canvas-container.pb-active .canvas-controls { bottom: calc(20px + var(--pb-height)); }
                .cbtn { 
                  width: 38px; 
                  height: 38px; 
                  background: var(--glass-bg); 
                  backdrop-filter: blur(8px);
                  border: 1px solid var(--border); 
                  border-radius: 10px; 
                  color: var(--txt1); 
                  cursor: pointer; 
                  display: flex; 
                  align-items: center; 
                  justify-content: center; 
                  transition: all 0.2s; 
                  box-shadow: var(--shadow-premium);
                }
                .cbtn:hover { 
                  background: var(--bg4); 
                  color: var(--txt0);
                  transform: scale(1.05);
                  border-color: var(--border2);
                }
                .cbtn:active { transform: scale(0.95); }
                .pcb-comp { transition: filter 0.2s ease; }
                .pcb-comp:hover { filter: brightness(1.2); }
            `}} />
        </div>
    );
}
