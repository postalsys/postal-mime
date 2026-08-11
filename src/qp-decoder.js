import { blobToArrayBuffer, hexNibble } from './decode-strings.js';

const CHR_EQUALS = 0x3d;
const CHR_LF = 0x0a;

export default class QPDecoder {
    constructor() {
        this.maxChunkSize = 100 * 1024;

        this.buffer = new Uint8Array(this.maxChunkSize);
        this.bufferPos = 0;

        this.chunks = [];
    }

    writeByte(byte) {
        if (this.bufferPos >= this.buffer.length) {
            this.flushBuffer();
        }
        this.buffer[this.bufferPos++] = byte;
    }

    // Literal text is the bulk of a typical body, so it is copied in runs rather than a
    // byte at a time
    writeBytes(line, start, end) {
        while (start < end) {
            if (this.bufferPos >= this.buffer.length) {
                this.flushBuffer();
            }
            const count = Math.min(end - start, this.buffer.length - this.bufferPos);
            this.buffer.set(line.subarray(start, start + count), this.bufferPos);
            this.bufferPos += count;
            start += count;
        }
    }

    flushBuffer() {
        if (this.bufferPos) {
            this.chunks.push(this.buffer.slice(0, this.bufferPos));
            this.bufferPos = 0;
        }
    }

    // Quoted-printable source is 7 bit by definition, so it is decoded byte by byte and
    // the result is handed on as bytes. Running the body charset over the encoded source
    // instead corrupted every part whose charset was not ASCII compatible: the same
    // content that decoded correctly in base64 came out as mojibake in quoted-printable.
    update(line) {
        let len = line.length;

        // a line ending in '=' is a soft line break, the newline is not part of the content
        const softBreak = len > 0 && line[len - 1] === CHR_EQUALS;
        if (softBreak) {
            len--;
        }

        let literalStart = 0;
        for (let i = 0; i < len; i++) {
            if (line[i] !== CHR_EQUALS || i + 2 >= len) {
                continue;
            }

            const high = hexNibble(line[i + 1]);
            const low = hexNibble(line[i + 2]);
            if (high < 0 || low < 0) {
                // not a valid escape sequence, keep it as literal text
                continue;
            }

            this.writeBytes(line, literalStart, i);
            this.writeByte((high << 4) | low);
            i += 2;
            literalStart = i + 1;
        }
        this.writeBytes(line, literalStart, len);

        if (!softBreak) {
            this.writeByte(CHR_LF);
        }
    }

    finalize() {
        this.flushBuffer();

        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        return blobToArrayBuffer(new Blob(this.chunks, { type: 'application/octet-stream' }));
    }
}
