import { blobToArrayBuffer } from './decode-strings.js';

// Regex patterns compiled once for performance
const VALID_QP_REGEX = /^=[a-f0-9]{2}$/i;
const QP_SPLIT_REGEX = /(?==[a-f0-9]{2})/i;
const SOFT_LINE_BREAK_REGEX = /=\r?\n/g;
const PARTIAL_QP_ENDING_REGEX = /=[a-fA-F0-9]?$/;

export default class QPDecoder {
    constructor(opts) {
        opts = opts || {};

        this.decoder = opts.decoder || new TextDecoder();

        this.maxChunkSize = 100 * 1024;

        this.remainder = '';

        this.chunks = [];
    }

    decodeQPBytes(encodedBytes) {
        let buf = new ArrayBuffer(encodedBytes.length);
        let dataView = new DataView(buf);
        for (let i = 0, len = encodedBytes.length; i < len; i++) {
            dataView.setUint8(i, parseInt(encodedBytes[i], 16));
        }
        return buf;
    }

    decodeChunks(str) {
        // unwrap newlines
        str = str.replace(SOFT_LINE_BREAK_REGEX, '');

        let list = str.split(QP_SPLIT_REGEX);
        let encodedBytes = [];
        for (let part of list) {
            if (part.charAt(0) !== '=') {
                if (encodedBytes.length) {
                    this.chunks.push(this.decodeQPBytes(encodedBytes));
                    encodedBytes = [];
                }
                this.chunks.push(part);
                continue;
            }

            if (part.length === 3) {
                // Validate that this is actually a valid QP sequence
                if (VALID_QP_REGEX.test(part)) {
                    encodedBytes.push(part.substr(1));
                } else {
                    // Not a valid QP sequence, treat as literal text
                    if (encodedBytes.length) {
                        this.chunks.push(this.decodeQPBytes(encodedBytes));
                        encodedBytes = [];
                    }
                    this.chunks.push(part);
                }
                continue;
            }

            if (part.length > 3) {
                // First 3 chars should be a valid QP sequence
                const firstThree = part.substr(0, 3);
                if (VALID_QP_REGEX.test(firstThree)) {
                    encodedBytes.push(part.substr(1, 2));
                    this.chunks.push(this.decodeQPBytes(encodedBytes));
                    encodedBytes = [];

                    part = part.substr(3);
                    this.chunks.push(part);
                } else {
                    // Not a valid QP sequence, treat entire part as literal
                    if (encodedBytes.length) {
                        this.chunks.push(this.decodeQPBytes(encodedBytes));
                        encodedBytes = [];
                    }
                    this.chunks.push(part);
                }
            }
        }
        if (encodedBytes.length) {
            this.chunks.push(this.decodeQPBytes(encodedBytes));
            encodedBytes = [];
        }
    }

    update(buffer) {
        // expect full lines, so add line terminator as well
        let str = this.decoder.decode(buffer) + '\n';

        str = this.remainder + str;

        if (str.length < this.maxChunkSize) {
            this.remainder = str;
            return;
        }

        this.remainder = '';

        let partialEnding = str.match(PARTIAL_QP_ENDING_REGEX);
        if (partialEnding) {
            if (partialEnding.index === 0) {
                this.remainder = str;
                return;
            }
            this.remainder = str.substr(partialEnding.index);
            str = str.substr(0, partialEnding.index);
        }

        this.decodeChunks(str);
    }

    finalize() {
        if (this.remainder.length) {
            this.decodeChunks(this.remainder);
            this.remainder = '';
        }

        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
