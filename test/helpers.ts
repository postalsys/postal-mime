import { Buffer } from 'node:buffer';
import type { Attachment } from '../src/postal-mime.js';

// Shared by the test files that generate their own input. Not a test file itself, the
// test script only picks up `*-test.ts`.

/**
 * Park-Miller generator, enough randomness for a test and the same sequence on every run
 */
export function createRandom(seed: number): () => number {
    let state = seed % 2147483647 || 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

/**
 * A random element of the list
 */
export function pick<T>(random: () => number, list: readonly T[]): T {
    return list[Math.floor(random() * list.length)];
}

/**
 * The bytes of an attachment parsed with the default arraybuffer encoding
 */
export function attachmentBytes(attachment: Attachment): Buffer {
    return Buffer.from(attachment.content as ArrayBuffer);
}
