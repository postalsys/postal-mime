import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';
import { SHAPES, GROWTH, HEAP_MB, MAX_RATIO, NOISE_MS, followsTheInput } from './scaling-shapes.js';

// Every shape of test/scaling-shapes.ts is parsed at a message of some 1.5 MB and at a
// quarter of that, see test/scaling-run.ts. A parse whose cost follows the input takes
// about four times as long at the larger size, a quadratic one sixteen times, so the
// ratio tells the two apart on any machine. A second run parses each shape under a heap
// limit, so a parse that holds far more than its input runs out of it and fails here too.
//
// The reports behind test/parse-cost-test.ts each came from one more shape that nobody
// had measured this way, so this runs the measurement over every stage of the parser at
// once, and a new shape belongs here as well as there.

interface Record {
    name: string;
    smallMs?: number;
    smallBytes?: number;
    largeMs?: number;
    largeBytes?: number;
    parsed?: boolean;
}

// no linear parse of a 1.5 MB message takes this long
const LIMIT_MS = 3000;
// the heap of the timing run, enough that the garbage collector stays out of the ratios
const TIMING_HEAP_MB = 1024;

const dir = path.dirname(fileURLToPath(import.meta.url));

// Runs test/scaling-run.ts in the given mode and returns its records by shape name, with
// a note on how the process ended if it did not finish
function run(mode: 'time' | 'memory', heapMb: number): { records: Map<string, Record>; ended: string } {
    const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', `--max-old-space-size=${heapMb}`, path.join(dir, 'scaling-run.ts'), mode],
        {
            cwd: path.resolve(dir, '..'),
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024
        }
    );

    const records = new Map<string, Record>();
    let started = 'nothing';
    for (const line of result.stdout.split('\n').filter(Boolean)) {
        const record = JSON.parse(line) as Record;
        // every shape is named once before its parse and once with its result
        if (records.has(record.name)) {
            records.set(record.name, record);
        } else {
            records.set(record.name, { name: record.name });
            started = record.name;
        }
    }

    let ended = '';
    if (result.status !== 0) {
        const reason = /heap out of memory/.test(result.stderr)
            ? `ran out of its ${heapMb} MB of heap`
            : result.stderr.trim().split('\n').slice(-3).join(' ');
        ended = `the ${mode} run ended with status ${result.status} while parsing ${started}: ${reason}`;
    }
    return { records, ended };
}

test('parse cost follows the input', async t => {
    const timing = run('time', TIMING_HEAP_MB);
    const memory = run('memory', HEAP_MB);

    for (const shape of SHAPES) {
        await t.test(shape.name, () => {
            const held = memory.records.get(shape.name);
            assert.ok(
                held && held.parsed,
                `${shape.name} was not parsed under the heap limit, ${memory.ended || 'the run reported nothing for it'}`
            );

            const cost = timing.records.get(shape.name);
            assert.ok(
                cost && cost.largeMs !== undefined,
                `${shape.name} was not measured, ${timing.ended || 'the run reported nothing for it'}`
            );
            const { smallMs, smallBytes, largeMs, largeBytes } = cost as Required<Record>;

            const report =
                `${shape.name}: ${smallMs.toFixed(1)}ms for ${smallBytes} bytes, ${largeMs.toFixed(1)}ms for ${largeBytes} bytes, ` +
                `${(largeMs / smallMs).toFixed(1)}x for ${(largeBytes / smallBytes).toFixed(1)}x the input`;
            assert.ok(largeMs < LIMIT_MS, report);
            assert.ok(
                followsTheInput(smallMs, smallBytes, largeMs, largeBytes),
                `${report}, over ${MAX_RATIO}x for ${GROWTH}x at more than ${NOISE_MS}ms`
            );
        });
    }
});
