import { decodeBase64, blobToArrayBuffer } from './decode-strings.js';

export default class Base64Decoder {
    constructor(opts) {
        opts = opts || {};

        this.decoder = opts.decoder || new TextDecoder();

        this.maxChunkSize = 100 * 1024;

        this.chunks = [];

        this.remainder = '';
    }

    pushChunk(base64Str) {
        if (base64Str.length) {
            this.chunks.push(decodeBase64(base64Str));
        }
    }

    flushRemainder() {
        this.pushChunk(this.remainder);
        this.remainder = '';
    }

    update(buffer) {
        let str = this.decoder.decode(buffer).replace(/[^a-zA-Z0-9+/=]+/g, '');

        // '=' terminates a base64 unit. Some mailers pad every line, and erasing the
        // padding used to concatenate the units, which knocked everything after the first
        // embedded pad out of 4 character alignment and decoded it to garbage.
        const units = str.split(/=+/);
        for (let i = 0; i < units.length; i++) {
            this.remainder += units[i];
            // the trailing piece is not followed by padding, so it stays open
            if (i < units.length - 1) {
                this.flushRemainder();
            }
        }

        if (this.remainder.length >= this.maxChunkSize) {
            const alignedLength = Math.floor(this.remainder.length / 4) * 4;
            this.pushChunk(this.remainder.substring(0, alignedLength));
            this.remainder = this.remainder.substring(alignedLength);
        }
    }

    finalize() {
        this.flushRemainder();

        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
