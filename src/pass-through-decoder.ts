import { blobToArrayBuffer } from './decode-strings.js';

export default class PassThroughDecoder {
    chunks: Array<Uint8Array<ArrayBuffer> | string>;
    pendingLineBreak: boolean;

    constructor() {
        this.chunks = [];
        this.pendingLineBreak = false;
    }

    // The line break is written when the next line arrives, not after each line. The
    // CRLF in front of a multipart boundary belongs to the boundary (RFC 2046 5.1.1), so
    // the last line of a part ended by a boundary must not carry one.
    update(line: Uint8Array<ArrayBuffer>): void {
        if (this.pendingLineBreak) {
            this.chunks.push('\n');
        }
        this.chunks.push(line);
        this.pendingLineBreak = true;
    }

    // A part ended by the end of the message has no boundary to own its final line
    // break, so there it stays content
    finalize(boundaryEnded = false): Promise<ArrayBuffer> {
        if (!boundaryEnded && this.pendingLineBreak) {
            this.chunks.push('\n');
        }

        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
