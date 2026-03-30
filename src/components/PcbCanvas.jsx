import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
    SP,
    generateBackgroundSVG,
    generateWiresSVG,
    generateRatsnestSVG,
    renderCompSVG,
    generateBoundingBoxSVG,
    hitComp,
    hitPin,
    hitWire,
    netColor
} from "../engine/render-utils.js";
import { CAMERA_CONFIG } from "../engine/config.js";
import {
    Plus,
    Minus,
    Maximize,
    Crosshair
} from 'lucide-react';
const TRACKING_MODES = { NONE: 'none', SNAP: 'snap', LIVE: 'live' };
const { SNAP } = TRACKING_MODES;

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
    snapCounter,
    onManualRoute,
    onPreviewRoute,
    previewPath,
    onSelectNet,
    activePin,
    customComponentsSvg // Optional prop if we want to override
}) {
    const svgRef = useRef(null);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [camera, setCamera] = useState(() => {
        const saved = localStorage.getItem('pcb_camera_state');
        if (saved) {
            try {
                const s = JSON.parse(saved);
                s.z = Math.min(Math.max(s.z || 1, 0.1), 10.0);
                return s;
            } catch (e) {
                console.warn("Failed to parse camera state:", e);
            }
        }
        return { x: 0, y: 0, z: 1 };
    });
    const [isPanning, setIsPanning] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });
    const [draggingId, setDraggingId] = useState(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [routingMode, setRoutingMode] = useState(null); // { startPin, currentPos }

    // Sink routing mode if preview is cleared externally
    useEffect(() => {
        if (!previewPath && routingMode) {
            setRoutingMode(null);
        }
    }, [previewPath, routingMode]);

    const hasInitializedFit = useRef(!!localStorage.getItem('pcb_camera_state'));

    // Persist camera
    useEffect(() => {
        const timer = setTimeout(() => {
            localStorage.setItem('pcb_camera_state', JSON.stringify(camera));
        }, 500);
        return () => clearTimeout(timer);
    }, [camera]);

    const getMousePos = (e) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const rect = svgRef.current.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleWheel = (e) => {
        e.preventDefault();
        const pos = getMousePos(e);
        const delta = e.deltaY > 0 ? 0.9 : 1.1;

        const curZ = simZoom.current || 1; // Ensure simZoom.current is initialized
        const curP = simPan.current;
        const newZ = Math.min(Math.max(curZ * delta, 0.1), 10.0);
        const newP = {
            x: pos.x - (pos.x - curP.x) * (newZ / curZ),
            y: pos.y - (pos.y - curP.y) * (newZ / curZ)
        };

        setCamera({ x: newP.x, y: newP.y, z: newZ });
        simPan.current = { ...newP };
        simZoom.current = newZ;
    };

    const handlePointerDown = (e) => {
        const pos = getMousePos(e);
        const worldY = (pos.y - camera.y) / camera.z;
        const worldX = (pos.x - camera.x) / camera.z;
        const col = Math.floor(worldX / SP);
        const row = Math.floor(worldY / SP);

        const pinHit = hitPin(col, row, components);
        const wireHit = hitWire(col, row, wires);
        const compHit = hitComp(col, row, components);

        // 1. If in routing mode and hit a pin OR a wire, commit the route
        if (routingMode && (pinHit || wireHit)) {
            if (pinHit) {
                if (pinHit.compId !== routingMode.startPin.compId || pinHit.pinIdx !== routingMode.startPin.pinIdx) {
                    onManualRoute?.(routingMode.startPin, pinHit, previewPath);
                    setRoutingMode(null);
                    onPreviewRoute?.(null);
                } else {
                    setRoutingMode(null);
                    onPreviewRoute?.(null);
                }
            } else if (wireHit) {
                onManualRoute?.(routingMode.startPin, wireHit.net, previewPath);
                setRoutingMode(null);
                onPreviewRoute?.(null);
            }
            return;
        }

        // 2. Clicked while NOT in routing mode
        if (pinHit && pinHit.compId === selectedId) {
            // Started routing IMMEDIATELY because it's already selected and we hit a pin
            setRoutingMode({ startPin: pinHit, currentPos: { col, row } });
            setDraggingId(null);
            onPreviewRoute?.(pinHit, { col, row });
        } else if (compHit) {
            // Standard selection and dragging
            setDraggingId(compHit.id);
            setDragOffset({ x: worldX - compHit.ox * SP, y: worldY - compHit.oy * SP });
            onSelect?.(compHit.id);
        } else if (wireHit) {
            // Wire selection
            onSelectNet?.(wireHit.net);
            onSelect?.(null);
        } else {
            // Pan or Reset
            setIsPanning(true);
            lastPos.current = pos;
            onSelect?.(null);
            onSelectNet?.(null);
            if (routingMode) {
                setRoutingMode(null);
                onPreviewRoute?.(null);
            }
        }
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
        const pos = getMousePos(e);
        const worldY = (pos.y - camera.y) / camera.z;
        const worldX = (pos.x - camera.x) / camera.z;
        const col = Math.floor(worldX / SP);
        const row = Math.floor(worldY / SP);

        if (routingMode) {
            if (routingMode.currentPos.col !== col || routingMode.currentPos.row !== row) {
                setRoutingMode(prev => ({ ...prev, currentPos: { col, row } }));
                const targetWire = hitWire(col, row, wires);
                onPreviewRoute?.(routingMode.startPin, { col, row }, targetWire?.net);
            }
        } else if (draggingId) {
            const nx = Math.round((worldX - dragOffset.x) / SP);
            const ny = Math.round((worldY - dragOffset.y) / SP);
            onMove?.(draggingId, nx, ny);
        } else if (isPanning) {
            const newP = {
                x: camera.x + (pos.x - lastPos.current.x),
                y: camera.y + (pos.y - lastPos.current.y)
            };
            setCamera(prev => ({ ...prev, x: newP.x, y: newP.y }));
            lastPos.current = pos;
            simPan.current = { ...newP };
        }
    };

    const handlePointerUp = (e) => {
        if (draggingId) onMoveEnd?.();
        setDraggingId(null);
        setIsPanning(false);
        const target = e.currentTarget;
        if (target && target.hasPointerCapture && target.hasPointerCapture(e.pointerId)) {
            target.releasePointerCapture(e.pointerId);
        }
    };

    // Keyboard ESC to cancel routing
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape' && routingMode) {
                setRoutingMode(null);
                onPreviewRoute?.(null);
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [routingMode, onPreviewRoute]);

    const handleMouseDown = (e) => {
        if (e.button === 2 && draggingId) {
            onRotate?.(draggingId);
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const [trackingMode, setTrackingMode] = useState(TRACKING_MODES.NONE);
    const [isAutoTracking, setIsAutoTracking] = useState(true);

    useEffect(() => {
        if (!svgRef.current) return;
        const resizeObs = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                setViewportSize({
                    width: Math.round(entry.contentRect.width),
                    height: Math.round(entry.contentRect.height)
                });
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
            if (!w.path) continue;
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

        const viewport = viewportSize;
        if (viewport.width === 0) return; // Prevent infinity zoom on initial load

        // Normalize: Match updatePhysics behavior by using full height for consistent centering
        const fitZoom = Math.min(
            (viewport.width * CAMERA_CONFIG.TARGET_COVERAGE) / bbW,
            (viewport.height * CAMERA_CONFIG.TARGET_COVERAGE) / bbH,
            CAMERA_CONFIG.MAX_ZOOM_FIT
        );

        snapLockRef.current = { targetCX, targetCY, fitZoom };
        setTrackingMode(SNAP);
    }, [bounds, viewportSize]);

    useEffect(() => {
        const isMilestone = (workflowStep === 1 || workflowStep === 2) && workflowStep !== lastSnapStep.current;
        const isCounterJump = snapCounter !== lastSnapCounter.current;
        const justFinished = wasProcessing.current && !isProcessing;

        // Conditions for an automatic snap
        const shouldSnap = isMilestone || isCounterJump || justFinished || isInitialProcessing || (!hasInitializedFit.current && bounds);

        if (shouldSnap && viewportSize.width > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            startSnap();
            hasInitializedFit.current = true;
            lastSnapStep.current = workflowStep;
            lastSnapCounter.current = snapCounter;
        }

        // Live Mode Detection
        const isAiphase = (workflowStep === 3 || workflowStep === 4) || (isProcessing && !isInitialProcessing);
        const shouldBeLive = isAiphase && isProcessing && isAutoTracking;

        if (shouldBeLive && trackingMode !== TRACKING_MODES.LIVE && !draggingId && trackingMode !== TRACKING_MODES.SNAP) {
            setTrackingMode(TRACKING_MODES.LIVE);
        } else if (!shouldBeLive && trackingMode === TRACKING_MODES.LIVE) {
            setTrackingMode(TRACKING_MODES.NONE);
        }

        wasProcessing.current = isProcessing;
        if (workflowStep === 0) {
            lastSnapStep.current = 0;
            lastSnapCounter.current = 0;
            hasInitializedFit.current = false;
            localStorage.removeItem('pcb_camera_state');
        }
    }, [workflowStep, snapCounter, isInitialProcessing, isProcessing, isAutoTracking, draggingId, bounds, viewportSize, startSnap, trackingMode, TRACKING_MODES.LIVE, TRACKING_MODES.SNAP, TRACKING_MODES.NONE]); // Added TRACKING_MODES to deps

    const zoomVelRef = useRef(0);
    const panVelRef = useRef({ x: 0, y: 0 });
    const smoothCenterRef = useRef({ x: 0, y: 0 });
    const targetBoundsRef = useRef(null);
    const lastTimeRef = useRef(0);
    const simPan = useRef({ x: camera.x, y: camera.y });
    const simZoom = useRef(camera.z);

    const lastUpdateKeyRef = useRef("");
    const zoomCountRef = useRef(0);
    const panCountRef = useRef(0);

    useEffect(() => { targetBoundsRef.current = bounds; }, [bounds]);

    const updatePhysics = useCallback((time) => {
        if (!svgRef.current) return;
        if (!lastTimeRef.current) lastTimeRef.current = time;
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
        lastTimeRef.current = time;

        const viewport = viewportSize;
        if (viewport.width === 0) {
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
                // Snap mode: Use full viewport for initial placement consistency across Load/Route
                simPan.current.x = viewport.width / 2 - targetCX * nextZ;
                simPan.current.y = viewport.height / 2 - targetCY * nextZ;
                smoothCenterRef.current = { x: targetCX, y: targetCY };
            } else {
                const worldCX = smoothCenterRef.current.x;
                const worldCY = smoothCenterRef.current.y;

                // Adaptive Viewport: Dodge the bottom bar if it's there
                const pbHeight = isProcessing ? 240 : 0;
                const targetAvailableHeight = viewport.height - pbHeight;

                const targetViewportCX = viewport.width / 2;
                const targetViewportCY = targetAvailableHeight / 2;

                const bbW = (b.maxCol - b.minCol + 1) * SP;
                const bbH = (b.maxRow - b.minRow + 1) * SP;

                // Track against the current available area
                const currentCoverage = Math.max((bbW * curZ) / viewport.width, (bbH * curZ) / targetAvailableHeight);
                const errorX = targetViewportCX - (worldCX * curZ + simPan.current.x);
                const errorY = targetViewportCY - (worldCY * curZ + simPan.current.y);

                const deadzoneX = viewport.width * CAMERA_CONFIG.PAN_DEADZONE_X;
                const deadzoneY = targetAvailableHeight * CAMERA_CONFIG.PAN_DEADZONE_Y;

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
    }, [trackingMode, isAutoTracking, isPanning, draggingId, viewportSize, isProcessing, TRACKING_MODES.SNAP, TRACKING_MODES.LIVE, TRACKING_MODES.NONE]);


    useEffect(() => {
        let rAF;
        const loop = (time) => {
            if (isAutoTracking && (trackingMode !== TRACKING_MODES.NONE)) {
                updatePhysics(time);
                rAF = requestAnimationFrame(loop);
            }
        };

        if (isAutoTracking && (trackingMode !== TRACKING_MODES.NONE)) {
            lastTimeRef.current = performance.now();
            rAF = requestAnimationFrame(loop);
        } else {
            zoomVelRef.current = 0;
            panVelRef.current = { x: 0, y: 0 };
            lastTimeRef.current = 0;
        }
        return () => {
            if (rAF) cancelAnimationFrame(rAF);
        };
    }, [isAutoTracking, trackingMode, updatePhysics, TRACKING_MODES.NONE]);


    const background = useMemo(() => generateBackgroundSVG(cols, rows, bounds), [cols, rows, bounds]);
    const wiresSvg = useMemo(() => generateWiresSVG(wires, activeNets), [wires, activeNets, tick]);
    const ratsnestSvg = useMemo(() => generateRatsnestSVG(components, wires), [components, wires, tick]);
    const renderedComponentsSvg = useMemo(() => customComponentsSvg || components.map(c => renderCompSVG(c, c.id === selectedId, activePin || routingMode?.startPin)).join(''), [components, selectedId, routingMode, activePin, tick, customComponentsSvg]);
    const boundingBoxSvg = useMemo(() => generateBoundingBoxSVG(components, wires), [components, wires, tick]);

    // Removal of failing simZoom useEffect

    return (
        <div className={`canvas-container ${isProcessing ? 'pb-active' : ''}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onMouseDown={handleMouseDown} onWheel={handleWheel} onContextMenu={(e) => e.preventDefault()} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor: routingMode ? 'crosshair' : (isPanning || draggingId ? 'grabbing' : 'crosshair'), background: '#050706', '--pb-height': '240px' }}>
            <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block' }}>
                <g transform={`translate(${camera.x}, ${camera.y}) scale(${camera.z})`}>
                    <g id="main-content">
                        <g dangerouslySetInnerHTML={{ __html: background }} />
                        <g dangerouslySetInnerHTML={{ __html: wiresSvg }} />
                        <g dangerouslySetInnerHTML={{ __html: ratsnestSvg }} />
                        <g dangerouslySetInnerHTML={{ __html: renderedComponentsSvg }} />
                        <g dangerouslySetInnerHTML={{ __html: boundingBoxSvg }} />

                        {routingMode && (
                            <g className="routing-preview-layer">
                                {(() => {
                                    const segments = [];
                                    let current = [];
                                    let currentCrossing = false;

                                    // Start point
                                    if (previewPath && previewPath.length > 0) {
                                        current.push(previewPath[0]);
                                        currentCrossing = false; // Initial segment is from pin, usually clean
                                    }

                                    for (let i = 1; previewPath && i < previewPath.length; i++) {
                                        const pt = previewPath[i];
                                        const prev = previewPath[i - 1];
                                        const isCross = pt.isCrossing;

                                        if (isCross !== currentCrossing) {
                                            // Close current, start new
                                            segments.push({ path: current, isCrossing: currentCrossing });
                                            current = [prev, pt];
                                            currentCrossing = isCross;
                                        } else {
                                            current.push(pt);
                                        }
                                    }
                                    segments.push({ path: current, isCrossing: currentCrossing });

                                    return segments.map((seg, i) => (
                                        <polyline
                                            key={i}
                                            points={seg.path.map(pt => `${pt.col * SP + SP / 2},${pt.row * SP + SP / 2}`).join(' ')}
                                            fill="none"
                                            stroke={seg.isCrossing ? '#ff2222' : netColor(routingMode.startPin.pin.net)}
                                            strokeWidth="5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeDasharray={seg.isCrossing ? "5 5" : ""}
                                            style={{
                                                pointerEvents: 'none',
                                                filter: `drop-shadow(0 0 8px ${seg.isCrossing ? '#ff2222' : netColor(routingMode.startPin.pin.net)})`
                                            }}
                                        />
                                    ));
                                })()}
                            </g>
                        )}
                    </g>
                </g>
            </svg>

            <div className="canvas-controls">
                <button className="cbtn" onClick={() => {
                    const nextZ = Math.min(Math.max(simZoom.current * 1.15, 0.1), 10.0);
                    const rect = svgRef.current.getBoundingClientRect();
                    const cx = rect.width / 2;
                    const cy = rect.height / 2;
                    const curZ = simZoom.current;
                    const curP = simPan.current;
                    // eslint-disable-next-line react-hooks/immutability
                    simPan.current = {
                        x: cx - (cx - curP.x) * (nextZ / curZ),
                        y: cy - (cy - curP.y) * (nextZ / curZ)
                    };
                    // eslint-disable-next-line react-hooks/immutability
                    simZoom.current = nextZ;
                    setCamera({ ...simPan.current, z: nextZ });
                }} title="Zoom In">
                    <Plus size={18} />
                </button>
                <button className="cbtn" onClick={() => {
                    const nextZ = Math.min(Math.max(simZoom.current * 0.87, 0.1), 10.0);
                    const rect = svgRef.current.getBoundingClientRect();
                    const cx = rect.width / 2;
                    const cy = rect.height / 2;
                    const curZ = simZoom.current;
                    const curP = simPan.current;
                    // eslint-disable-next-line react-hooks/immutability
                    simPan.current = {
                        x: cx - (cx - curP.x) * (nextZ / curZ),
                        y: cy - (cy - curP.y) * (nextZ / curZ)
                    };
                    // eslint-disable-next-line react-hooks/immutability
                    simZoom.current = nextZ;
                    setCamera({ ...simPan.current, z: nextZ });
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
