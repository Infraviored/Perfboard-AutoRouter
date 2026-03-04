export const TEMPLATE = {
    board: { cols: 22, rows: 16 },
    components: [
        {
            id: 'J1', name: 'Power', value: '2-pin', color: '#2a2808',
            pins: [{ offset: [0, 0], net: 'VCC', label: '+' }, { offset: [0, 1], net: 'GND', label: '-' }]
        },
        {
            id: 'R1', name: 'Resistor', value: '10k', color: '#2e1a08',
            pins: [{ offset: [0, 0], net: 'VCC', label: '1' }, { offset: [2, 0], net: 'GATE', label: '2' }]
        },
        {
            id: 'Q1', name: 'N-MOSFET', value: 'IRLZ44N', color: '#1a3320',
            pins: [{ offset: [0, 0], net: 'GATE', label: 'G' },
            { offset: [1, 0], net: 'DRAIN', label: 'D' },
            { offset: [2, 0], net: 'SOURCE', label: 'S' }]
        },
        {
            id: 'RL1', name: 'Relay', value: '5V coil', color: '#1a1a2e',
            pins: [{ offset: [0, 0], net: 'VCC', label: 'A' }, { offset: [0, 1], net: 'DRAIN', label: 'B' }]
        },
        {
            id: 'C1', name: 'Cap', value: '100uF', color: '#0e2222',
            pins: [{ offset: [0, 0], net: 'VCC', label: '+' }, { offset: [1, 0], net: 'GND', label: '-' }]
        },
        {
            id: 'D1', name: 'Diode', value: '1N4007', color: '#2a0a18',
            pins: [{ offset: [0, 0], net: 'SOURCE', label: 'K' }, { offset: [1, 0], net: 'GND', label: 'A' }]
        }
    ],
    connections: [
        { net: 'VCC', comment: 'J1+ → R1[1], RL1[A], C1+' },
        { net: 'GND', comment: 'J1- → C1-, D1[A]' },
        { net: 'GATE', comment: 'R1[2] → Q1[G]' },
        { net: 'DRAIN', comment: 'Q1[D] → RL1[B]' },
        { net: 'SOURCE', comment: 'Q1[S] → D1[K]' }
    ]
};

export function processTemplate(data) {
    if (!data.components?.length) return null;

    return data.components.map((cd, idx) => {
        if (!cd.pins?.length) return null;
        const offsets = cd.pins.map(p =>
            Array.isArray(p.offset) ? [...p.offset] : [p.offset?.col || 0, p.offset?.row || 0]);

        const colValues = offsets.map(o => o[0]);
        const rowValues = offsets.map(o => o[1]);
        const minCol = Math.min(...colValues);
        const minRow = Math.min(...rowValues);
        const maxCol = Math.max(...colValues);
        const maxRow = Math.max(...rowValues);

        const normalizedOffsets = offsets.map(off => [off[0] - minCol, off[1] - minRow]);

        return {
            id: cd.id || ('C' + (idx + 1)),
            name: cd.name || '?',
            value: cd.value || '',
            color: cd.color || '#222a22',
            routeUnder: !!cd.routeUnder,
            offsets: normalizedOffsets,
            pinNets: cd.pins.map(p => p.net || null),
            pinLbls: cd.pins.map(p => p.label || p.lbl || String(idx + 1)),
            w: maxCol - minCol + 1,
            h: maxRow - minRow + 1,
            boardOffset: [minCol, minRow],
        };
    }).filter(Boolean);
}
