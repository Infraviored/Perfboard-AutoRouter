const data = require('/home/schneider/Programs/autorouter/pcb_circuit-stuck.json');

// Map out the board
const comps = data.components;
let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
comps.forEach(c => {
    minCol = Math.min(minCol, c.ox);
    maxCol = Math.max(maxCol, c.ox + c.w - 1);
    minRow = Math.min(minRow, c.oy);
    maxRow = Math.max(maxRow, c.oy + c.h - 1);
});

console.log(`BB: cols [${minCol}..${maxCol}], rows [${minRow}..${maxRow}]`);
console.log(`BB size: ${maxCol - minCol + 1} x ${maxRow - minRow + 1} = ${(maxCol - minCol + 1) * (maxRow - minRow + 1)}`);
console.log();

// Print component positions
console.log("Components:");
comps.forEach(c => {
    const nets = [...new Set(c.pins.map(p => p.net).filter(Boolean))];
    const right = c.ox + c.w - 1;
    const bottom = c.oy + c.h - 1;
    const onRight = right === maxCol ? " [RIGHT BOUNDARY]" : "";
    const onLeft = c.ox === minCol ? " [LEFT BOUNDARY]" : "";
    const onTop = c.oy === minRow ? " [TOP BOUNDARY]" : "";
    const onBottom = bottom === maxRow ? " [BOTTOM BOUNDARY]" : "";
    console.log(`  ${c.id} (${c.w}x${c.h}) at (${c.ox},${c.oy})-(${right},${bottom}) nets: [${nets.join(', ')}]${onRight}${onLeft}${onTop}${onBottom}`);
});

// Draw ASCII board
console.log("\nASCII Board:");
const grid = {};
// Mark components
comps.forEach(c => {
    for (let dc = 0; dc < c.w; dc++) {
        for (let dr = 0; dr < c.h; dr++) {
            const col = c.ox + dc;
            const row = c.oy + dr;
            grid[`${col},${row}`] = c.id.substring(0, 3).padEnd(3);
        }
    }
});
// Mark wires
data.wires.forEach(w => {
    if (w.path) w.path.forEach(pt => {
        const key = `${pt.col},${pt.row}`;
        if (!grid[key]) grid[key] = ` ${w.net.substring(0, 1)} `;
    });
});

for (let r = minRow - 1; r <= maxRow + 1; r++) {
    let line = `${String(r).padStart(3)}: `;
    for (let c = minCol - 1; c <= maxCol + 1; c++) {
        const key = `${c},${r}`;
        line += grid[key] || ' . ';
    }
    console.log(line);
}

// Column headers
let hdr = '     ';
for (let c = minCol - 1; c <= maxCol + 1; c++) {
    hdr += String(c).padStart(3);
}
console.log(hdr);

// Analyze right boundary
console.log("\n--- Right Boundary Analysis ---");
const rightBoundary = comps.filter(c => c.ox + c.w - 1 === maxCol);
console.log("Components on right boundary:", rightBoundary.map(c => c.id));
rightBoundary.forEach(c => {
    const nets = [...new Set(c.pins.map(p => p.net).filter(Boolean))];
    console.log(`  ${c.id}: connects to nets [${nets.join(', ')}]`);
});

// Check what's at col 4 (one step left of right boundary at col 5)
console.log("\n--- What occupies column 5 (right edge)? ---");
comps.forEach(c => {
    if (c.ox <= 5 && c.ox + c.w - 1 >= 5) {
        console.log(`  ${c.id} at (${c.ox},${c.oy}) w=${c.w} h=${c.h}`);
    }
});

// Check free space
console.log("\n--- Free cells analysis ---");
const occupied = new Set();
comps.forEach(c => {
    for (let dc = 0; dc < c.w; dc++)
        for (let dr = 0; dr < c.h; dr++)
            occupied.add(`${c.ox + dc},${c.oy + dr}`);
});
let freeCells = [];
for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
        if (!occupied.has(`${c},${r}`)) freeCells.push({ col: c, row: r });
    }
}
console.log(`Free cells within BB: ${freeCells.length}`);
freeCells.forEach(f => console.log(`  (${f.col}, ${f.row})`));
