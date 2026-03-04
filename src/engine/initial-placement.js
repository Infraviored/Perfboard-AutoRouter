import { moveComp, rotateComp90InPlace } from './placer.js';

export function placeInitial(compDefs, cols, rows) {
  const components = [];
  compDefs.forEach(cd => {
    // 1. Random Initial Position
    const ox = Math.floor(Math.random() * (cols - cd.w - 1)) + 1;
    const oy = Math.floor(Math.random() * (rows - cd.h - 1)) + 1;

    let c = makeComp(cd, ox, oy);

    // 2. Random Initial Rotation (0 to 3 times 90 degrees)
    const rotations = Math.floor(Math.random() * 4);
    for (let i = 0; i < rotations; i++) {
      rotateComp90InPlace(c);
    }

    // Safety clamp to ensure rotation didn't push us out of bounds
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
