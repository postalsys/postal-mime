// Parses every shape of test/scaling-shapes.ts and reports on each as a line of JSON, see
// test/scaling-test.ts. Runs as its own process, so that the instrumentation of the test
// runner stays out of the measurements and a heap limit applies to the parses alone.
//
//   node --import tsx test/scaling-run.ts time     the cost at two sizes
//   node --import tsx test/scaling-run.ts memory   one parse at the larger size
import { writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import PostalMime from '../src/postal-mime.js';
import { SHAPES, TARGET_BYTES, GROWTH, followsTheInput, type Shape } from './scaling-shapes.js';

interface Measurement {
    smallMs: number;
    smallBytes: number;
    largeMs: number;
    largeBytes: number;
}

// synchronous, so that the line is out before a parse that runs out of heap
const report = (record: object): void => {
    writeSync(1, JSON.stringify(record) + '\n');
};

async function cost(shape: Shape, n: number): Promise<{ ms: number; bytes: number }> {
    const mail = shape.build(n);
    const started = performance.now();
    await PostalMime.parse(mail);
    return { ms: performance.now() - started, bytes: mail.length };
}

// The fastest of a few parses stands for a size: the first one warms up the code it runs
// and any one of them can land on a pause of the garbage collector
async function fastest(shape: Shape, n: number, samples: number): Promise<{ ms: number; bytes: number }> {
    let best = { ms: Infinity, bytes: 0 };
    for (let i = 0; i < samples; i++) {
        const sample = await cost(shape, n);
        best = sample.ms < best.ms ? sample : best;
    }
    return best;
}

async function measure(shape: Shape, small: number, large: number): Promise<Measurement> {
    const smallCost = await fastest(shape, small, 3);
    const largeCost = await fastest(shape, large, 2);
    return { smallMs: smallCost.ms, smallBytes: smallCost.bytes, largeMs: largeCost.ms, largeBytes: largeCost.bytes };
}

const mode = process.argv[2];

for (const shape of SHAPES) {
    const bytesPerUnit = shape.build(shape.size).length / shape.size;
    const large = Math.min(Math.round(TARGET_BYTES / bytesPerUnit), shape.max ?? Infinity);
    const small = Math.max(1, Math.floor(large / GROWTH));

    // named before the parse, so that a parse that runs out of heap can be told apart
    report({ name: shape.name, small, large });

    if (mode === 'memory') {
        const { bytes } = await cost(shape, large);
        report({ name: shape.name, large, largeBytes: bytes, parsed: true });
        continue;
    }

    let measurement = await measure(shape, small, large);
    if (!followsTheInput(measurement.smallMs, measurement.smallBytes, measurement.largeMs, measurement.largeBytes)) {
        // a measurement can still be unlucky, a regression is not
        measurement = await measure(shape, small, large);
    }
    report({ name: shape.name, small, large, ...measurement });
}
