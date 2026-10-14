import { blobToArrayBuffer } from './decode-strings.js';

/**
 * Collects decoded content in fixed size chunks, so memory follows the number of bytes
 * written rather than the number of writes. Decoders that write many short runs, such as
 * a quoted-printable line or a base64 body that pads every line, would otherwise hold a
 * buffer per run.
 */
export default class ChunkWriter {
    maxChunkSize: number;
    buffer: Uint8Array<ArrayBuffer> | null;
    bufferPos: number;
    chunks: Uint8Array<ArrayBuffer>[];

    constructor(maxChunkSize = 100 * 1024) {
        this.maxChunkSize = maxChunkSize;

        // allocated on the first write, a part with no content costs nothing
        this.buffer = null;
        this.bufferPos = 0;

        this.chunks = [];
    }

    writeByte(byte: number): void {
        if (!this.buffer || this.bufferPos >= this.buffer.length) {
            this.flush();
            this.buffer ??= new Uint8Array(this.maxChunkSize);
        }
        this.buffer[this.bufferPos++] = byte;
    }

    // Copied in runs rather than a byte at a time
    writeBytes(bytes: Uint8Array, start = 0, end = bytes.length): void {
        while (start < end) {
            if (!this.buffer || this.bufferPos >= this.buffer.length) {
                this.flush();
                this.buffer ??= new Uint8Array(this.maxChunkSize);
            }
            const count = Math.min(end - start, this.buffer.length - this.bufferPos);
            this.buffer.set(bytes.subarray(start, start + count), this.bufferPos);
            this.bufferPos += count;
            start += count;
        }
    }

    /**
     * Keeps a buffer the caller hands over and will not touch again. A large one is kept as
     * a chunk of its own instead of being copied, a small one is copied like any other write.
     */
    append(bytes: Uint8Array<ArrayBuffer>): void {
        if (bytes.length >= this.maxChunkSize / 2) {
            this.flush();
            this.chunks.push(bytes);
        } else {
            this.writeBytes(bytes);
        }
    }

    flush(): void {
        if (this.buffer && this.bufferPos) {
            this.chunks.push(this.buffer.slice(0, this.bufferPos));
            this.bufferPos = 0;
        }
    }

    finalize(): Promise<ArrayBuffer> {
        this.flush();

        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
