// src/engine/colors.js

export const NET_PAL = {
    VCC: '#ff5252', '+5V': '#ff5252', '+3V3': '#ff5252', 'VCC_BAR': '#ff5252',
    GND: '#40c4ff', '0V': '#40c4ff',
    GATE: '#00e676', DRAIN: '#e040fb', SOURCE: '#ff9800',
    CLK: '#ffea00', DATA: '#9c27b0', ADDR: '#00bcd4', CTRL: '#4caf50',
    RESET: '#ff0a99ff', EN: '#795548'
};

// Generates an equidistantly subdivided color sequence
// Level 0: Red(0), Green(120), Blue(240)
// Level 1: Yellow(60), Cyan(180), Magenta(300)
// Level 2: Orange(30), Chartreuse(90), ...
export const HUE_SUBDIVISIONS = [
    0, 120, 240,
    60, 180, 300,
    30, 90, 150, 210, 270, 330,
    15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345
];

/**
 * Maps an alphabetical namespace (e.g. "esp") to a continuous "color vector" [0..360].
 * Similar prefixes yield similar float values.
 */
function getNamespaceVector(namespace) {
    let val = 0;
    let weight = 1;
    const s = String(namespace).toLowerCase();
    for (let i = 0; i < Math.min(s.length, 6); i++) {
        weight /= 36;
        let code = s.charCodeAt(i);
        let v = 0;
        if (code >= 48 && code <= 57) v = code - 48; // 0-9
        else if (code >= 97 && code <= 122) v = code - 97 + 10; // a-z
        else v = 18;
        val += v * weight;
    }
    return val * 360;
}

/**
 * Extracts the base namespace of a component (e.g., "esp32" -> "esp").
 */
function extractNamespace(name) {
    const m = String(name).toLowerCase().match(/^[a-z]+/);
    return m ? m[0] : String(name);
}

/**
 * A fast hash function for generating slight variances.
 */
function tinyHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) + str.charCodeAt(i);
    }
    return Math.abs(h);
}

// Keep a persistent mapping of exactly which Hue slots have been claimed
// by which base namespace during the session. This guarantees we use our
// subdivided hierarchy (Red, Yellow, Blue -> Orange, Green...) in order,
// but similar namespaces always snap back to their established slot!
const namespaceSlotMap = new Map();

// Cache individual component colors to ensure computation happens exactly once per name
const colorCache = new Map();

/**
 * Deterministically assigns a color by matching a component's namespace to
 * the finest available subdivision of the color wheel.
 */
export function compColor(c) {
    if (!c) return '#555';
    if (c.color) return c.color;

    const name = c.name || c.id || 'Unknown';
    if (colorCache.has(name)) return colorCache.get(name);

    const namespace = extractNamespace(name);

    // If this namespace already claimed a slot, reuse it!
    let assignedHue;
    if (namespaceSlotMap.has(namespace)) {
        assignedHue = namespaceSlotMap.get(namespace);
    } else {
        // We need to claim a new slot for this namespace.
        // How many distinct namespaces have we seen? We will unlock that many slots
        // from our equidistant sequence.
        const slotsUnlocked = Math.min(namespaceSlotMap.size + 1, HUE_SUBDIVISIONS.length);
        const availableHues = HUE_SUBDIVISIONS.slice(0, slotsUnlocked);

        // Filter out hues already claimed by other namespaces
        const usedHues = new Set([...namespaceSlotMap.values()]);
        let freeHues = availableHues.filter(h => !usedHues.has(h));

        // If we've exhausted our exact sub-divisions (unlikely), just pick the next sequence item
        if (freeHues.length === 0) {
            freeHues = [HUE_SUBDIVISIONS[namespaceSlotMap.size % HUE_SUBDIVISIONS.length]];
        }

        // Which free hue best matches this namespace's mathematical color vector?
        const targetVector = getNamespaceVector(namespace);
        let bestFreeHue = freeHues[0];
        let minDiff = Infinity;

        for (const h of freeHues) {
            // shortest distance on a 360 degree circle
            let diff = Math.abs(targetVector - h) % 360;
            if (diff > 180) diff = 360 - diff;
            if (diff < minDiff) {
                minDiff = diff;
                bestFreeHue = h;
            }
        }

        assignedHue = bestFreeHue;
        namespaceSlotMap.set(namespace, assignedHue);
    }

    // Add a tiny bit of variance (+/- 8 degrees) based on the trailing numbers (e.g., 32 vs 8266)
    // so ESP32 and ESP8266 are VERY similar (both Orange), but perceptibly distinct geometries.
    const hash = tinyHash(name);
    const variance = (hash % 16) - 8;
    const finalHue = (assignedHue + variance + 360) % 360;

    const color = `hsl(${finalHue}, 50%, 40%)`;
    colorCache.set(name, color);
    return color;
}
