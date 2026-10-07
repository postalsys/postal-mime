import { blobToArrayBuffer } from './decode-strings.js';

// Hands the body through as it is, the line endings included.
//
// The line break is written when the next line arrives, not after each line. The CRLF in
// front of a multipart boundary belongs to the boundary (RFC 2046 5.1.1), so the last line
// of a part ended by a boundary must not carry one.
//
// The break written is the one the line came with. Writing LF for every line rewrote the
// bytes of every 7bit, 8bit and binary part: an attached message lost each of its CR and a
// binary attachment came out corrupted. Text is normalized to LF where it is read as text
// instead, see MimeNode.getTextContent.
//
// The lines of a part, breaks included, are one contiguous range of the message, so the
// decoder keeps the bounds of that range rather than a chunk per line: a Blob of two parts
// per line took 60 times longer to assemble than one of a single part.
export default class PassThroughDecoder {
    chunks: Uint8Array<ArrayBuffer>[];
    /** the buffer the current run of lines lives in, and the bounds of the run in it */
    runBuffer: ArrayBuffer | null;
    runStart: number;
    runEnd: number;
    /** the line break of the last line, written once the next line arrives */
    pendingLineBreak: Uint8Array<ArrayBuffer> | null;

    constructor() {
        this.chunks = [];
        this.runBuffer = null;
        this.runStart = 0;
        this.runEnd = 0;
        this.pendingLineBreak = null;
    }

    // Whether the bytes sit in the run's buffer right at the end of the run
    continuesRun(bytes: Uint8Array): boolean {
        return bytes.buffer === this.runBuffer && bytes.byteOffset === this.runEnd;
    }

    flushRun(): void {
        if (this.runBuffer && this.runEnd > this.runStart) {
            this.chunks.push(new Uint8Array(this.runBuffer, this.runStart, this.runEnd - this.runStart));
        }
        this.runBuffer = null;
    }

    update(line: Uint8Array<ArrayBuffer>, lineBreak: Uint8Array<ArrayBuffer>): void {
        const pending = this.pendingLineBreak;

        if (
            pending &&
            this.continuesRun(pending) &&
            line.buffer === this.runBuffer &&
            line.byteOffset === this.runEnd + pending.byteLength
        ) {
            // the break follows the run and the line follows the break, so the run grows
            this.runEnd = line.byteOffset + line.byteLength;
        } else {
            this.flushRun();
            if (pending) {
                this.chunks.push(pending);
            }
            this.runBuffer = line.buffer;
            this.runStart = line.byteOffset;
            this.runEnd = line.byteOffset + line.byteLength;
        }

        this.pendingLineBreak = lineBreak;
    }

    // A part ended by the end of the message has no boundary to own its final line
    // break, so there it stays content
    finalize(boundaryEnded = false): Promise<ArrayBuffer> {
        const pending = this.pendingLineBreak;
        if (!boundaryEnded && pending) {
            if (this.continuesRun(pending)) {
                this.runEnd += pending.byteLength;
            } else {
                this.flushRun();
                this.chunks.push(pending);
            }
        }
        this.flushRun();

        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
