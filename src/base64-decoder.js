export default class Base64Decoder {
    constructor(opts) {
        opts = opts || {};

        this.decoder = opts.decoder || new TextDecoder();

        this.maxChunkSize = 100 * 1024;

        this.chunks = [];

        this.remainder = '';

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

        // Use a lookup table to find the index.
        this.lookup = new Uint8Array(256);
        for (var i = 0; i < chars.length; i++) {
            this.lookup[chars.charCodeAt(i)] = i;
        }
    }

    decodeBase64(base64) {
        const bufferLength = base64.length * 0.75;
        const len = base64.length;

        let p = 0;

        if (base64[base64.length - 1] === '=') {
            bufferLength--;
            if (base64[base64.length - 2] === '=') {
                bufferLength--;
            }
        }

        const arrayBuffer = new ArrayBuffer(bufferLength);
        const bytes = new Uint8Array(arrayBuffer);

        for (let i = 0; i < len; i += 4) {
            let encoded1 = this.lookup[base64.charCodeAt(i)];
            let encoded2 = this.lookup[base64.charCodeAt(i + 1)];
            let encoded3 = this.lookup[base64.charCodeAt(i + 2)];
            let encoded4 = this.lookup[base64.charCodeAt(i + 3)];

            bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }

        return arrayBuffer;
    }

    update(buffer) {
        let str = this.decoder.decode(buffer);

        if (/[^a-zA-Z0-9+\/]/.test(str)) {
            str = str.replace(/[^a-zA-Z0-9+\/]+/g, '');
        }

        this.remainder += str;

        if (this.remainder.length >= this.maxChunkSize) {
            let allowedBytes = Math.floor(this.remainder.length / 4) * 4;
            let base64Str;

            if (allowedBytes === this.remainder.length) {
                base64Str = this.remainder;
                this.remainder = '';
            } else {
                base64Str = this.remainder.substr(0, allowedBytes);
                this.remainder = this.remainder.substr(allowedBytes);
            }

            if (base64Str.length) {
                this.chunks.push(this.decodeBase64(base64Str));
            }
        }
    }

    finalize() {
        if (this.remainder && !/^=+$/.test(this.remainder)) {
            this.chunks.push(this.decodeBase64(this.remainder));
        }

        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        let blob = new Blob(this.chunks, { type: 'application/octet-stream' });
        const fr = new FileReader();

        return new Promise((resolve, reject) => {
            fr.onload = function (e) {
                resolve(e.target.result);
            };

            fr.onerror = function (e) {
                reject(fr.error);
            };

            fr.readAsArrayBuffer(blob);
        });
    }
}
