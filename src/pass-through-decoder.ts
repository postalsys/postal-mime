import { blobToArrayBuffer } from './decode-strings.js';

export default class PassThroughDecoder {
    chunks: Array<Uint8Array<ArrayBuffer> | string>;

    constructor() {
        this.chunks = [];
    }

    update(line: Uint8Array<ArrayBuffer>): void {
        this.chunks.push(line);
        this.chunks.push('\n');
    }

    finalize(): Promise<ArrayBuffer> {
        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
