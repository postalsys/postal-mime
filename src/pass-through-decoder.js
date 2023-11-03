import { blobToArrayBuffer } from './decode-strings.js';

export default class PassThroughDecoder {
    constructor() {
        this.chunks = [];
    }

    update(line) {
        this.chunks.push(line);
        this.chunks.push('\n');
    }

    finalize() {
        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
