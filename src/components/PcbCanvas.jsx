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
    activeNets,
    onMove,
    onRotate,
    onMoveEnd,
    tick,
    isProcessing,
    isInitialProcessing,
    workflowStep,
    snapCounter
}) {
    const svgRef = useRef(null);
    const viewportSizeRef = useRef({ width: 0, height: 0 });
    const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 });
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

        const curZ = simZoom.current;
        const curP = simPan.current;
        const newZ = curZ * delta;
        const newP = {
            x: pos.x - (pos.x - curP.x) * delta,
            y: pos.y - (pos.y - curP.y) * delta
        };

        setCamera({ x: newP.x, y: newP.y, z: newZ });
        simPan.current = { ...newP };
        simZoom.current = newZ;
    };

    const handlePointerDown = (e) => {
        const pos = getMousePos(e);
        const worldX = (pos.x - camera.x) / camera.z;
        const worldY = (pos.y - camera.y) / camera.z;
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
            const worldX = (pos.x - camera.x) / camera.z;
            const worldY = (pos.y - camera.y) / camera.z;
            const nx = Math.round((worldX - dragOffset.x) / SP);
            const ny = Math.round((worldY - dragOffset.y) / SP);
            onMove?.(draggingId, nx, ny);
        } else if (isPanning) {
            const newP = {
                x: camera.x + (pos.x - lastPos.x),
                y: camera.y + (pos.y - lastPos.y)
            };
            setCamera(prev => ({ ...prev, x: newP.x, y: newP.y }));
            setLastPos(pos);
            simPan.current = { ...newP };
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

    const TRACKING_MODES = { NONE: 'none', SNAP: 'snap', LIVE: 'live' };
    const [trackingMode, setTrackingMode] = useState(TRACKING_MODES.NONE);
    const [isAutoTracking, setIsAutoTracking] = useState(true);
    const hasInitializedFit = useRef(false);

    useEffect(() => {
        if (!svgRef.current) return;
        const resizeObs = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                // Rounding to avoid sub-pixel jitter
                viewportSizeRef.current = {
                    width: Math.round(entry.contentRect.width),
                    height: Math.round(entry.contentRect.height)
                };
            }
        });
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

    const snapLockRef = useRef(null);
    const lastSnapStep = useRef(0);
    const lastSnapCounter = useRef(0);
    const wasProcessing = useRef(false);

    const startSnap = useCallback(() => {
        if (!bounds) return;
        const targetCX = (bounds.minCol + bounds.maxCol + 1) / 2 * SP;
        const targetCY = (bounds.minRow + bounds.maxRow + 1) / 2 * SP;
        const bbW = (bounds.maxCol - bounds.minCol + 1) * SP;
        const bbH = (bounds.maxRow - bounds.minRow + 1) * SP;

        const viewport = viewportSizeRef.current;
        // Normalize: Match updatePhysics behavior by using full height for consistent centering
        const fitZoom = Math.min(
            (viewport.width * CAMERA_CONFIG.TARGET_COVERAGE) / bbW,
            (viewport.height * CAMERA_CONFIG.TARGET_COVERAGE) / bbH,
            CAMERA_CONFIG.MAX_ZOOM_FIT
        );

        snapLockRef.current = { targetCX, targetCY, fitZoom };
        setTrackingMode(TRACKING_MODES.SNAP);
    }, [bounds]);

    useEffect(() => {
        const isMilestone = (workflowStep === 1 || workflowStep === 2) && workflowStep !== lastSnapStep.current;
        const isCounterJump = snapCounter !== lastSnapCounter.current;
        const isAiphase = workflowStep === 3 || workflowStep === 4;
        const shouldBeLive = isAiphase && isProcessing && isAutoTracking;

        if (isMilestone || isCounterJump || isInitialProcessing) {
            startSnap();
            hasInitializedFit.current = true;
            lastSnapStep.current = workflowStep;
            lastSnapCounter.current = snapCounter;
        } else if (shouldBeLive && trackingMode !== TRACKING_MODES.LIVE && !draggingId) {
            setTrackingMode(TRACKING_MODES.LIVE);
        } else if (!shouldBeLive && trackingMode === TRACKING_MODES.LIVE) {
            setTrackingMode(TRACKING_MODES.NONE);
        }

        wasProcessing.current = isProcessing;
        if (workflowStep === 0) {
            lastSnapStep.current = 0;
            lastSnapCounter.current = snapCounter;
        }
    }, [workflowStep, snapCounter, isInitialProcessing, draggingId, isProcessing, isAutoTracking, startSnap, trackingMode]);

    const zoomVelRef = useRef(0);
    const panVelRef = useRef({ x: 0, y: 0 });
    const smoothCenterRef = useRef({ x: 0, y: 0 });
    const targetBoundsRef = useRef(null);
    const lastTimeRef = useRef(0);
    const rAFRef = useRef(null);
    const simPan = useRef({ x: 0, y: 0 });
    const simZoom = useRef(1);

    const lastUpdateKeyRef = useRef("");
    const zoomCountRef = useRef(0);
    const panCountRef = useRef(0);

    useEffect(() => { targetBoundsRef.current = bounds; }, [bounds]);

    const updatePhysics = useCallback((time) => {
        if (!svgRef.current) return;
        if (!lastTimeRef.current) lastTimeRef.current = time;
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
        lastTimeRef.current = time;

        const viewport = viewportSizeRef.current;
        if (viewport.width === 0) {
            rAFRef.current = requestAnimationFrame(updatePhysics);
            return;
        }

        const isSnap = trackingMode === TRACKING_MODES.SNAP;
        const isLive = trackingMode === TRACKING_MODES.LIVE;
        const shouldApplyPhysics = isAutoTracking && (isSnap || isLive) && !isPanning && !draggingId;

        if (shouldApplyPhysics) {
            let targetCX, targetCY, fitZoom;
            const b = targetBoundsRef.current;

            if (isSnap && snapLockRef.current) {
                targetCX = snapLockRef.current.targetCX;
                targetCY = snapLockRef.current.targetCY;
                fitZoom = snapLockRef.current.fitZoom;
            } else if (b) {
                targetCX = (b.minCol + b.maxCol + 1) / 2 * SP;
                targetCY = (b.minRow + b.maxRow + 1) / 2 * SP;
                const bbW = (b.maxCol - b.minCol + 1) * SP;
                const bbH = (b.maxRow - b.minRow + 1) * SP;
                // Normalize: Always use full viewport height for camera math to keep LOAD/ROUTE identical
                fitZoom = Math.min(
                    (viewport.width * CAMERA_CONFIG.TARGET_COVERAGE) / bbW,
                    (viewport.height * CAMERA_CONFIG.TARGET_COVERAGE) / bbH,
                    CAMERA_CONFIG.MAX_ZOOM_FIT
                );
            } else {
                rAFRef.current = requestAnimationFrame(updatePhysics);
                return;
            }

            const curZ = simZoom.current;
            let nextZ = curZ;

            // 1. DERIVE NEXT ZOOM
            let zoomAcc = 0;
            if (isSnap || zoomCountRef.current > CAMERA_CONFIG.ZOOM_VIOLATION_THRESHOLD) {
                zoomAcc = (fitZoom - curZ) * CAMERA_CONFIG.ZOOM_STRENGTH;
            }
            const zoomDamping = Math.pow(CAMERA_CONFIG.ZOOM_DAMPING, dt);
            zoomVelRef.current = (zoomVelRef.current + zoomAcc * dt) * zoomDamping;
            nextZ = curZ + zoomVelRef.current * dt;

            // 2. DERIVE NEXT PAN (Using nextZ for Snap to prevent wobble)
            if (isSnap) {
                simPan.current.x = viewport.width / 2 - targetCX * nextZ;
                simPan.current.y = viewport.height / 2 - targetCY * nextZ;
                smoothCenterRef.current = { x: targetCX, y: targetCY };
            } else {
                const worldCX = smoothCenterRef.current.x;
                const worldCY = smoothCenterRef.current.y;
                const targetViewportCX = viewport.width / 2;
                const targetViewportCY = viewport.height / 2;

                const bbW = (b.maxCol - b.minCol + 1) * SP;
                const bbH = (b.maxRow - b.minRow + 1) * SP;
                const currentCoverage = Math.max((bbW * curZ) / viewport.width, (bbH * curZ) / viewport.height);
                const errorX = targetViewportCX - (worldCX * curZ + simPan.current.x);
                const errorY = targetViewportCY - (worldCY * curZ + simPan.current.y);
                const deadzoneX = viewport.width * CAMERA_CONFIG.PAN_DEADZONE_X;
                const deadzoneY = viewport.height * CAMERA_CONFIG.PAN_DEADZONE_Y;

                const isZoomViolated = currentCoverage > CAMERA_CONFIG.ZOOM_OUT_THRESHOLD || currentCoverage < CAMERA_CONFIG.ZOOM_IN_THRESHOLD;
                const isPanViolated = Math.abs(errorX) > deadzoneX || Math.abs(errorY) > deadzoneY;

                const updateKey = `zV:${isZoomViolated}-pV:${isPanViolated}-b:${b.minCol},${b.minRow}`;
                if (updateKey !== lastUpdateKeyRef.current) {
                    zoomCountRef.current = isZoomViolated ? zoomCountRef.current + 1 : 0;
                    panCountRef.current = isPanViolated ? panCountRef.current + 1 : 0;
                    lastUpdateKeyRef.current = updateKey;
                }

                let panAccX = 0, panAccY = 0;
                if (panCountRef.current > CAMERA_CONFIG.PAN_VIOLATION_THRESHOLD) {
                    panAccX = errorX * CAMERA_CONFIG.PAN_STRENGTH;
                    panAccY = errorY * CAMERA_CONFIG.PAN_STRENGTH;
                }

                const panDamping = Math.pow(CAMERA_CONFIG.PAN_DAMPING, dt);
                panVelRef.current.x = (panVelRef.current.x + panAccX * dt) * panDamping;
                panVelRef.current.y = (panVelRef.current.y + panAccY * dt) * panDamping;

                simPan.current.x += panVelRef.current.x * dt;
                simPan.current.y += panVelRef.current.y * dt;
                smoothCenterRef.current.x += (targetCX - smoothCenterRef.current.x) * CAMERA_CONFIG.CENTER_FOLLOW_STRENGTH * dt;
                smoothCenterRef.current.y += (targetCY - smoothCenterRef.current.y) * CAMERA_CONFIG.CENTER_FOLLOW_STRENGTH * dt;
            }

            // 3. COMMIT ATOMIC STATE
            simZoom.current = nextZ;
            setCamera({ x: simPan.current.x, y: simPan.current.y, z: simZoom.current });

            if (isSnap && Math.abs(fitZoom - simZoom.current) < 0.001) {
                setTrackingMode(TRACKING_MODES.NONE);
                snapLockRef.current = null;
            }
        }
        rAFRef.current = requestAnimationFrame(updatePhysics);
    }, [trackingMode, isAutoTracking, isPanning, draggingId, SP]);


    useEffect(() => {
        if (isAutoTracking && (trackingMode !== TRACKING_MODES.NONE)) {
            lastTimeRef.current = performance.now();
            rAFRef.current = requestAnimationFrame(updatePhysics);
        } else {
            if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
            zoomVelRef.current = 0;
            panVelRef.current = { x: 0, y: 0 };
            lastTimeRef.current = 0;
        }
        return () => {
            if (rAFRef.current) {
                cancelAnimationFrame(rAFRef.current);
            }
        };
    }, [isAutoTracking, trackingMode, updatePhysics]);

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
    const wiresSvg = useMemo(() => generateWiresSVG(wires, activeNets), [wires, activeNets, tick]);
    const ratsnestSvg = useMemo(() => generateRatsnestSVG(components, wires, !!draggingId), [components, wires, draggingId, tick]);
    const componentsSvg = useMemo(() => components.map(c => renderCompSVG(c, c.id === selectedId)).join(''), [components, selectedId, tick]);
    const boundingBoxSvg = useMemo(() => generateBoundingBoxSVG(components, wires), [components, wires, tick]);

    return (
        <div className={`canvas-container ${isProcessing ? 'pb-active' : ''}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onMouseDown={handleMouseDown} onWheel={handleWheel} onContextMenu={(e) => e.preventDefault()} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor: (isPanning || draggingId) ? 'grabbing' : 'crosshair', background: '#050706', '--pb-height': '240px' }}>
            <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block' }}>
                <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.z})`}>
                    <g dangerouslySetInnerHTML={{ __html: background }} />
                    <g dangerouslySetInnerHTML={{ __html: labelsSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: wiresSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: ratsnestSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: componentsSvg }} />
                    <g dangerouslySetInnerHTML={{ __html: boundingBoxSvg }} />
                </g>
            </svg>

            <div className="canvas-controls">
                <button className="cbtn" onClick={() => {
                    const z = camera.z * 1.15;
                    const newCamera = { ...camera, z };
                    setCamera(newCamera);
                    simZoom.current = z;
                }} title="Zoom In">
                    <Plus size={18} />
                </button>
                <button className="cbtn" onClick={() => {
                    const z = camera.z * 0.87;
                    const newCamera = { ...camera, z };
                    setCamera(newCamera);
                    simZoom.current = z;
                }} title="Zoom Out">
                    <Minus size={18} />
                </button>
                <button className="cbtn" onClick={() => setTrackingMode(TRACKING_MODES.SNAP)} title="Center Board">
                    <Maximize size={18} />
                </button>
                <button className="cbtn" onClick={() => {
                    const next = !isAutoTracking;
                    setIsAutoTracking(next);
                    if (!next) setTrackingMode(TRACKING_MODES.NONE);
                }} title={isAutoTracking ? "Disable Auto-Tracking" : "Enable Auto-Tracking"} style={{ color: isAutoTracking ? 'var(--grn-bright)' : 'inherit' }}>
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
