import test from 'node:test';
import assert from 'node:assert';
import ChunkWriter from '../src/chunk-writer.js';

test('ChunkWriter - allocates nothing until written to', async () => {
    const writer = new ChunkWriter();
    assert.strictEqual(writer.buffer, null);
    assert.strictEqual((await writer.finalize()).byteLength, 0);
});

test('ChunkWriter - short writes share fixed size chunks', async () => {
    const writer = new ChunkWriter(8);
    for (let i = 0; i < 20; i++) {
        writer.writeByte(i);
    }
    writer.writeBytes(new Uint8Array([20, 21, 22, 23, 24]), 1, 4);

    assert.deepStrictEqual(
        new Uint8Array(await writer.finalize()),
        new Uint8Array([...Array.from({ length: 20 }, (_, i) => i), 21, 22, 23])
    );
    assert.deepStrictEqual(
        writer.chunks.map(chunk => chunk.length),
        [8, 8, 7]
    );
});

test('ChunkWriter - a large handed over buffer is kept without copying', async () => {
    const writer = new ChunkWriter(8);
    const small = new Uint8Array([1, 2]);
    const large = new Uint8Array([3, 4, 5, 6, 7]);
    writer.append(small);
    writer.append(large);
    writer.append(small);

    assert.deepStrictEqual(new Uint8Array(await writer.finalize()), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 1, 2]));
    assert.strictEqual(writer.chunks[1], large);
    assert.notStrictEqual(writer.chunks[0], small);
});
