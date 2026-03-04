import { moveComp, rotateComp90InPlace } from './placer.js';

export function placeInitial(compDefs, cols, rows) {
  const components = [];
  const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
  // Calculate a small spread based on number of components to keep them tight but distinct
  const spread = Math.max(5, Math.ceil(Math.sqrt(compDefs.length) * 2));

  compDefs.forEach(cd => {
    // 1. Position within a tight center zone
    const ox = cx + Math.floor(Math.random() * spread - spread / 2);
    const oy = cy + Math.floor(Math.random() * spread - spread / 2);

    let c = makeComp(cd, ox, oy);

    // 2. Random Initial Rotation (0 to 3 times 90 degrees)
    const rotations = Math.floor(Math.random() * 4);
    for (let i = 0; i < rotations; i++) {
      rotateComp90InPlace(c);
    }

    // Safety clamp 
    if (c.ox + c.w >= cols) moveComp(c, cols - c.w - 1, c.oy);
    if (c.oy + c.h >= rows) moveComp(c, c.ox, rows - c.h - 1);

    components.push(c);
  });
  return components;
}


export function makeComp(cd, ox, oy) {
  return {
    id: cd.id, name: cd.name, value: cd.value, color: cd.color,
    routeUnder: !!cd.routeUnder,
    w: cd.w, h: cd.h, ox, oy,
    pins: cd.offsets.map((off, i) => ({
      col: ox + off[0], row: oy + off[1],
      net: cd.pinNets[i], lbl: cd.pinLbls[i],
      dCol: off[0], dRow: off[1]
    }))
  };
}
