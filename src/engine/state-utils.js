export function saveComps(components) {
    return components.map(c => ({
        id: c.id, ox: c.ox, oy: c.oy, w: c.w, h: c.h,
        pins: c.pins.map(p => ({ dCol: p.dCol, dRow: p.dRow }))
    }));
}

export function restoreComps(components, saved) {
    saved.forEach(s => {
        const comp = components.find(c => c.id === s.id);
        if (comp) {
            comp.ox = s.ox; comp.oy = s.oy;
            comp.w = s.w; comp.h = s.h;

            comp.pins.forEach((p, idx) => {
                p.dCol = s.pins[idx].dCol;
                p.dRow = s.pins[idx].dRow;
                p.col = comp.ox + p.dCol;
                p.row = comp.oy + p.dRow;
            });
        }
    });
}

export function completion(wires) {
    if (!wires.length) return 0;
    const successful = wires.filter(w => !w.failed).length;
    return successful / wires.length;
}
