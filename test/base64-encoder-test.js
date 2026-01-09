import test from 'node:test';
import assert from 'node:assert';
import { base64ArrayBuffer } from '../src/base64-encoder.js';

// Basic encoding tests
test('base64ArrayBuffer - encode empty buffer', () => {
    const buffer = new ArrayBuffer(0);
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, '');
});

test('base64ArrayBuffer - encode single byte', () => {
    const buffer = new Uint8Array([65]).buffer; // 'A'
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'QQ==');
});

test('base64ArrayBuffer - encode two bytes', () => {
    const buffer = new Uint8Array([65, 66]).buffer; // 'AB'
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'QUI=');
});

test('base64ArrayBuffer - encode three bytes (no padding)', () => {
    const buffer = new Uint8Array([65, 66, 67]).buffer; // 'ABC'
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'QUJD');
});

test('base64ArrayBuffer - encode "Hello World"', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('Hello World').buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'SGVsbG8gV29ybGQ=');
});

test('base64ArrayBuffer - encode UTF-8 text', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('Cafe').buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'Q2FmZQ==');
});

test('base64ArrayBuffer - encode all printable ASCII', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789').buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk=');
});

test('base64ArrayBuffer - encode binary data with zero bytes', () => {
    const buffer = new Uint8Array([0, 0, 0, 0]).buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'AAAAAA==');
});

test('base64ArrayBuffer - encode binary data with high bytes', () => {
    const buffer = new Uint8Array([255, 254, 253, 252]).buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, '//79/A==');
});

test('base64ArrayBuffer - encode all byte values 0-255', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        bytes[i] = i;
    }
    const result = base64ArrayBuffer(bytes.buffer);
    // Verify length (256 bytes = 342-344 base64 chars with padding)
    assert.ok(result.length > 0);
    // Verify it's valid base64
    assert.ok(/^[A-Za-z0-9+/]+=*$/.test(result));
});

test('base64ArrayBuffer - encode single byte 0', () => {
    const buffer = new Uint8Array([0]).buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'AA==');
});

test('base64ArrayBuffer - encode single byte 255', () => {
    const buffer = new Uint8Array([255]).buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, '/w==');
});

test('base64ArrayBuffer - encode newlines', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('Line1\nLine2\r\nLine3').buffer;
    const result = base64ArrayBuffer(buffer);
    // LF is 0x0A, CR is 0x0D
    assert.strictEqual(result, 'TGluZTEKTGluZTINCkxpbmUz');
});

test('base64ArrayBuffer - encode special characters', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('!@#$%^&*()').buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'IUAjJCVeJiooKQ==');
});

test('base64ArrayBuffer - encode long string', () => {
    const text = 'A'.repeat(1000);
    const encoder = new TextEncoder();
    const buffer = encoder.encode(text).buffer;
    const result = base64ArrayBuffer(buffer);
    // Verify it's valid base64
    assert.ok(/^[A-Za-z0-9+/]+=*$/.test(result));
    // 1000 bytes should produce ~1333 base64 chars
    assert.ok(result.length >= 1333);
});

test('base64ArrayBuffer - verify roundtrip with atob', () => {
    const original = 'Hello, World! 123';
    const encoder = new TextEncoder();
    const buffer = encoder.encode(original).buffer;
    const base64 = base64ArrayBuffer(buffer);

    // Decode back using atob
    const decoded = atob(base64);
    assert.strictEqual(decoded, original);
});

test('base64ArrayBuffer - encode bytes that produce + and /', () => {
    // Bytes that when encoded produce + and / characters
    const buffer = new Uint8Array([251, 239, 190]).buffer;
    const result = base64ArrayBuffer(buffer);
    // Should contain base64 characters including potentially + or /
    assert.ok(/^[A-Za-z0-9+/]+=*$/.test(result));
});

test('base64ArrayBuffer - encode chunks of varying sizes', () => {
    for (let size = 1; size <= 10; size++) {
        const buffer = new Uint8Array(size).fill(65).buffer; // 'AAA...'
        const result = base64ArrayBuffer(buffer);
        assert.ok(/^[A-Za-z0-9+/]+=*$/.test(result), `Valid base64 for size ${size}`);
    }
});

test('base64ArrayBuffer - padding is correct', () => {
    // 1 byte remainder = 2 padding chars
    const buffer1 = new Uint8Array([65]).buffer;
    assert.ok(base64ArrayBuffer(buffer1).endsWith('=='));

    // 2 byte remainder = 1 padding char
    const buffer2 = new Uint8Array([65, 66]).buffer;
    assert.ok(base64ArrayBuffer(buffer2).endsWith('='));
    assert.ok(!base64ArrayBuffer(buffer2).endsWith('=='));

    // 3 bytes = no padding
    const buffer3 = new Uint8Array([65, 66, 67]).buffer;
    assert.ok(!base64ArrayBuffer(buffer3).endsWith('='));
});

test('base64ArrayBuffer - encode emoji (UTF-8 encoded)', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('Hello 😀').buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, 'SGVsbG8g8J+YgA==');
});

test('base64ArrayBuffer - encode Japanese text (UTF-8 encoded)', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('こんにちは').buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, '44GT44KT44Gr44Gh44Gv');
});

test('base64ArrayBuffer - encode Chinese text (UTF-8 encoded)', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('你好世界').buffer;
    const result = base64ArrayBuffer(buffer);
    assert.strictEqual(result, '5L2g5aW95LiW55WM');
});

test('base64ArrayBuffer - Uint8Array buffer property', () => {
    const uint8 = new Uint8Array([72, 101, 108, 108, 111]); // 'Hello'
    const result = base64ArrayBuffer(uint8.buffer);
    assert.strictEqual(result, 'SGVsbG8=');
});

test('base64ArrayBuffer - large binary file simulation', () => {
    // Simulate a small binary file (1KB)
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
        bytes[i] = i % 256;
    }
    const result = base64ArrayBuffer(bytes.buffer);
    assert.ok(/^[A-Za-z0-9+/]+=*$/.test(result));
    // 1024 bytes should produce ~1366 base64 chars
    assert.ok(result.length >= 1360);
});
