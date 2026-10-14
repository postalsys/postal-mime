import { hexNibble, isWsp } from './decode-strings.js';
import ChunkWriter from './chunk-writer.js';

const CHR_EQUALS = 0x3d;

export default class QPDecoder {
    output: ChunkWriter;
    /** the line break of the last line, written once the next line arrives, see update */
    pendingLineBreak: Uint8Array | null;

    constructor() {
        this.output = new ChunkWriter();
        this.pendingLineBreak = null;
    }

    writeLineBreak(): void {
        if (this.pendingLineBreak) {
            this.output.writeBytes(this.pendingLineBreak);
        }
    }

    // Quoted-printable source is 7 bit by definition, so it is decoded byte by byte and
    // the result is handed on as bytes. Running the body charset over the encoded source
    // instead corrupted every part whose charset was not ASCII compatible: the same
    // content that decoded correctly in base64 came out as mojibake in quoted-printable.
    //
    // As in PassThroughDecoder, a hard line break is only written once the next line
    // arrives, so the CRLF that belongs to a following boundary is not decoded as content,
    // and the break written is the one the line came with.
    update(line: Uint8Array, lineBreak: Uint8Array): void {
        this.writeLineBreak();

        let len = line.length;

        // Trailing white space on an encoded line was added in transit and is deleted (RFC
        // 2045 6.7 rule 3). Before the soft line break is looked for, since the `=` it
        // consists of may have had white space appended the same way
        while (len > 0 && isWsp(line[len - 1])) {
            len--;
        }

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

            this.output.writeBytes(line, literalStart, i);
            this.output.writeByte((high << 4) | low);
            i += 2;
            literalStart = i + 1;
        }
        this.output.writeBytes(line, literalStart, len);

        this.pendingLineBreak = softBreak ? null : lineBreak;
    }

    // see PassThroughDecoder.finalize
    finalize(boundaryEnded = false): Promise<ArrayBuffer> {
        if (!boundaryEnded) {
            this.writeLineBreak();
        }
        return this.output.finalize();
    }
}
