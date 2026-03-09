/**
 * CAMERA PHYSICS CONFIGURATION
 * 
 * Tuning these values will change how the camera reacts during optimization.
 */
export const CAMERA_CONFIG = {
    // How much of the viewport the PCB bounding box should attempt to fill.
    // 0.6 = 60% of the screen.
    TARGET_COVERAGE: 0.6,

    // The maximum zoom level the 'auto-zoom-to-fit' logic will allow.
    MAX_ZOOM_FIT: 5.0,

    // DEADZONES (HYSTERESIS)
    // The camera will stay perfectly still as long as the PCB is within these bounds.

    // ZOOM: Only act if board is larger than 75% or smaller than 45% of viewport.
    ZOOM_OUT_THRESHOLD: 0.75,
    ZOOM_IN_THRESHOLD: 0.45,

    // PAN: Only act if the PCB center drifts more than 5% away from the screen center.
    PAN_DEADZONE_X: 0.05, // 5% of width
    PAN_DEADZONE_Y: 0.05, // 5% of height

    // PHYSICS STRENGTH
    // Higher values make the camera "snappier" and faster.
    ZOOM_STRENGTH: 3.0,
    PAN_STRENGTH: 10.0,

    // DAMPING (FRICTION)
    // Values between 0 and 1. Lower means more friction (heavier feel).
    // 0.12 means it loses speed very quickly (critically damped).
    ZOOM_DAMPING: 0.10,
    PAN_DAMPING: 0.10,

    // SMOOTHING
    // How fast the 'target' center follows the actual PCB center (low-pass filter).
    // Used to ignore micro-jitter during footprint updates.
    CENTER_FOLLOW_STRENGTH: 2.0,

    // VIOLATION THRESHOLDS
    // How many consecutive layout updates must violate bounds before physics kick in.
    ZOOM_VIOLATION_THRESHOLD: 1,
    PAN_VIOLATION_THRESHOLD: 1,
};
