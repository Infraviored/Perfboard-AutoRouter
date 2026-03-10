
import { readFileSync, writeFileSync } from 'fs';
import { compactBoard, optimizeBoard } from '../src/engine/optimizer.js';

const data = JSON.parse(readFileSync('problems/simple_pcb_optimizer/pcb_circuit_ai.json', 'utf-8'));
const components = data.components;
const wires = data.wires;

const config = {
    maxEpochs: 1,
    maxIters: 100,
    maxTimeMs: 10000,
    saTrigger: 5,
    plateauTrigger: 8,
    deepStagnation: 12
};

async function run() {
    console.log("Original BB: 6x6 = 36");

    console.log("\n--- Running Compact ---");
    const optRes = await compactBoard(components, wires, 1000000, 1000000, config, {
        onStatusUpdate: (s) => console.log("Status:", s),
        onProgress: (p, m) => console.log(`Progress: ${p.toFixed(1)}% ${m}`)
    });

    console.log("\n--- Running Optimize ---");
    const expRes = await optimizeBoard(components, optRes.wires, 1000000, 1000000, {
        onStatusUpdate: (s) => console.log("Status:", s),
        onProgress: (p, m) => console.log(`Progress: ${p.toFixed(1)}% ${m}`)
    });

    // Save to temp file for analysis
    const finalState = { components, wires: expRes.wires };
    writeFileSync('problems/repro_result.json', JSON.stringify(finalState, null, 2));
}

run().catch(console.error);
