import MimeNode from './mime-node.js';
import { textToHtml, htmlToText, formatTextHeader, formatHtmlHeader } from './text-format.js';
import addressParser from './address-parser.js';
import { decodeWords, foldLineBreaks, isWsp, textEncoder, blobToArrayBuffer } from './decode-strings.js';
import { base64ArrayBuffer } from './base64-encoder.js';
import { createError } from './errors.js';
import type { Address, Attachment, AttachmentEncoding, Email, PostalMimeOptions, RawEmail } from './types.js';

export { addressParser, decodeWords };
export type {
    Address,
    AddressGroup,
    AddressParserOptions,
    Attachment,
    AttachmentDisposition,
    AttachmentEncoding,
    Email,
    Header,
    HeaderLine,
    Mailbox,
    PostalMimeOptions,
    RawEmail
} from './types.js';
export type { ErrorCode, PostalMimeError } from './errors.js';

interface Boundary {
    value: Uint8Array;
    node: MimeNode;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
    return !!value && typeof (value as ReadableStream<Uint8Array>).getReader === 'function';
}

function isBlob(value: unknown): value is Blob {
    return value instanceof Blob || Object.prototype.toString.call(value) === '[object Blob]';
}

// Checked by tag rather than instanceof, which fails for a buffer from another realm
function isArrayBuffer(value: unknown): value is ArrayBuffer {
    const tag = Object.prototype.toString.call(value);
    return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}

const ATTACHMENT_ENCODINGS: ReadonlySet<string> = new Set<AttachmentEncoding>(['arraybuffer', 'base64', 'utf8']);

// Checked up front, an unknown encoding used to reject only once the whole message had
// been parsed
function parseAttachmentEncoding(value: unknown): AttachmentEncoding {
    const encoding =
        String(value || '')
            .replace(/[-_\s]/g, '')
            .toLowerCase() || 'arraybuffer';
    if (!ATTACHMENT_ENCODINGS.has(encoding)) {
        throw createError('EINVALIDOPTION', `Unknown attachment encoding ${encoding}`);
    }
    return encoding as AttachmentEncoding;
}

// the inline text parts a message body is assembled from, see isInlineTextNode
type TextType = 'plain' | 'html';

type TextEntryItem = { type: 'text'; value: string } | { type: 'subMessage'; value: Email };

// text parts of a node keyed by type
type TextEntry = Partial<Record<TextType, TextEntryItem[]>>;

// Renders one entry of a node as the requested text type. A text part of the other type
// is converted, and a nested message becomes a header block in that format
function renderEntry(textEntry: TextEntryItem, textType: TextType, convert: boolean): string {
    if (textEntry.type === 'subMessage') {
        return textType === 'html' ? formatHtmlHeader(textEntry.value) : formatTextHeader(textEntry.value);
    }
    if (!convert) {
        return textEntry.value;
    }
    return textType === 'html' ? textToHtml(textEntry.value) : htmlToText(textEntry.value);
}

// The line break given to the last line of a message that ends without one, see readLine
const LINE_FEED = new Uint8Array([0x0a]);

const MAX_NESTING_DEPTH = 256;
const MAX_HEADERS_SIZE = 2 * 1024 * 1024;
// The depth limit does not bound the size of the tree. An empty part costs six bytes of
// input (`--b` and a blank line) and over a kilobyte of parser state at its peak, so a
// flat multipart of a million empty parts took a 7 MB message to 1.4 GB of memory.
const MAX_PART_COUNT = 10000;
// Inline message/rfc822 parts are parsed recursively. Without a dedicated limit
// each nesting level spawns a new parser that retains the full nested message,
// so a small crafted email can exhaust memory (OOM crash). Cap the recursion and
// treat deeper nested messages as regular attachments instead.
const MAX_RFC822_NESTING_DEPTH = 10;
// The From, To, Cc and Bcc of every inline message/rfc822 part are rendered into the
// text and html of the parent, an address of one or two bytes as some 60 characters of
// html. maxHeadersSize bounds the header bytes, not the addresses they hold, so without
// a limit of their own the output grows with the number of forwards.
const MAX_FORWARDED_ADDRESSES = 10000;

// The limits a parse runs under, validated once and handed to every nested parser as
// they are, so that a limit added here reaches an inline message/rfc822 part without
// being threaded through anywhere else
interface Limits {
    maxNestingDepth: number;
    maxHeadersSize: number;
    maxPartCount: number;
    maxRfc822NestingDepth: number;
    maxForwardedAddresses: number;
}

// What the limits count, see the MimeNode constructor, MimeNode.feed and
// collectSubMessage. One object serves the whole message: a nested parser gets the
// object of its parent, so that an inline message/rfc822 part can not start the
// budgets over. Before that each nested message had its own 2 MiB of headers and
// 10000 parts, and a few hundred of them in one message exhausted the heap.
interface LimitCounters {
    headerSize: number;
    partCount: number;
    forwardedAddresses: number;
}

// the number of entries the header formatters render for a list of addresses, a group
// counted along with each of its members
function countAddresses(addresses: Address[] | Address | undefined): number {
    if (!addresses) {
        return 0;
    }
    let count = 0;
    for (const address of Array.isArray(addresses) ? addresses : [addresses]) {
        count += 1 + (address.group ? address.group.length : 0);
    }
    return count;
}

// Limit options must be validated rather than falsy-coalesced. `0` would silently
// restore the default, and a string or NaN disables the limit altogether, because
// every `size > limit` comparison against such a value is false. Callers that
// forward a request supplied options object would otherwise hand an attacker a way
// to turn the limits off.
function parseLimitOption(value: unknown, defaultValue: number, name: string, min = 0): number {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
        throw createError('EINVALIDOPTION', `${name} must be a ${min ? 'positive' : 'non-negative'} integer`);
    }

    return value;
}

function parseLimits(options: PostalMimeOptions): Limits {
    return {
        maxNestingDepth: parseLimitOption(options.maxNestingDepth, MAX_NESTING_DEPTH, 'maxNestingDepth'),
        maxHeadersSize: parseLimitOption(options.maxHeadersSize, MAX_HEADERS_SIZE, 'maxHeadersSize'),
        // The root part is always counted, so a limit of zero can parse nothing, not even
        // an empty message, and it threw EMAXPARTCOUNT from the constructor, where only
        // EINVALIDOPTION is thrown
        maxPartCount: parseLimitOption(options.maxPartCount, MAX_PART_COUNT, 'maxPartCount', 1),
        // A limit of 0 disables inline parsing entirely, so every message/rfc822 part
        // becomes an attachment.
        maxRfc822NestingDepth: parseLimitOption(
            options.maxRfc822NestingDepth,
            MAX_RFC822_NESTING_DEPTH,
            'maxRfc822NestingDepth'
        ),
        maxForwardedAddresses: parseLimitOption(
            options.maxForwardedAddresses,
            MAX_FORWARDED_ADDRESSES,
            'maxForwardedAddresses'
        )
    };
}

export default class PostalMime {
    /** @internal */ options: PostalMimeOptions;
    /** @internal */ rfc822NestingDepth: number;
    // shared with every nested parser, see the constructor
    /** @internal */ limits: Limits;
    /** @internal */ counters: LimitCounters;
    /** @internal */ root: MimeNode;
    /** @internal */ currentNode: MimeNode;
    /** @internal */ boundaries: Boundary[];
    /** @internal */ textContent: Record<string, string>;
    /** @internal */ textMap: Map<MimeNode, TextEntry>;
    /** @internal */ textTypes: Set<TextType>;
    /** @internal */ attachments: Attachment[];
    /** @internal */ attachmentEncoding: AttachmentEncoding;
    // whether message/rfc822 parts are kept as attachments, decided once the tree is parsed
    /** @internal */ forceRfc822Attachments: boolean;
    /** @internal */ started: boolean;
    // the message being parsed, set by parse()
    /** @internal */ buf!: ArrayBuffer;
    /** @internal */ av!: Uint8Array<ArrayBuffer>;
    /** @internal */ readPos!: number;

    /**
     * Parses a raw email message
     *
     * @param buf Raw email message
     * @param options Parser options
     * @returns The parsed email
     */
    // async so that an invalid option rejects the returned promise instead of throwing
    // synchronously, which would escape a `.catch()` chain
    static async parse(buf: RawEmail, options?: PostalMimeOptions): Promise<Email> {
        const parser = new PostalMime(options);
        return parser.parse(buf);
    }

    constructor(options?: PostalMimeOptions);
    // A nested parser is created with its parent, see collectSubMessage. The overload is
    // internal so that the state it hands over can not be seeded through the public API.
    /** @internal */
    constructor(options: PostalMimeOptions | undefined, parent: PostalMime);
    constructor(options?: PostalMimeOptions, parent?: PostalMime) {
        this.options = options || {};

        // Internal state that a nested parser receives from its parent. It is deliberately
        // not an option, so that forwarding a caller supplied options object can not seed
        // it and switch the recursion limit off or start the counters over.
        this.rfc822NestingDepth = parent ? parent.rfc822NestingDepth + 1 : 0;
        // Set before the root part is created, since the root is counted and checked too
        this.limits = parent ? parent.limits : parseLimits(this.options);
        this.counters = parent ? parent.counters : { headerSize: 0, partCount: 0, forwardedAddresses: 0 };

        this.root = this.currentNode = new MimeNode({ postalMime: this });
        this.boundaries = [];

        this.textContent = {};
        this.textMap = new Map();
        this.textTypes = new Set();
        this.attachments = [];
        this.forceRfc822Attachments = false;

        this.attachmentEncoding = parseAttachmentEncoding(this.options.attachmentEncoding);

        this.started = false;
    }

    /** @internal */
    async finalize(): Promise<void> {
        // close all pending nodes
        await this.root.finalize();
    }

    /** @internal */
    async processLine(
        line: Uint8Array<ArrayBuffer>,
        lineBreak: Uint8Array<ArrayBuffer>,
        isFinal: boolean
    ): Promise<void> {
        let boundaries = this.boundaries;

        // check if this is a mime boundary
        if (boundaries.length && line.length > 2 && line[0] === 0x2d && line[1] === 0x2d) {
            // Could be a boundary marker. The open boundaries are checked outermost first:
            // a boundary may not appear inside the parts it delimits (RFC 2046 5.1.1), and
            // when a nested multipart declares the boundary of an ancestor anyway, or one
            // that ancestor's terminator matches, the ancestor's delimiter is the one every
            // other parser reads the line as. Reading it as the nested one instead gave the
            // nested multipart parts, and an attachment after the ancestor's terminator, that
            // Python and Go leave in the epilogue, which hid it from a scanner built on
            // either while it was shown here. Legal boundaries match one line at most, the
            // order changes nothing for them.
            for (let i = 0; i < boundaries.length; i++) {
                let boundary = boundaries[i];

                // Line must be at least long enough for "--" + boundary
                if (line.length < boundary.value.length + 2) {
                    continue;
                }

                // Check if boundary value matches
                let boundaryMatches = true;
                for (let j = 0; j < boundary.value.length; j++) {
                    if (line[j + 2] !== boundary.value[j]) {
                        boundaryMatches = false;
                        break;
                    }
                }
                if (!boundaryMatches) {
                    continue;
                }

                // Check for terminator (-- after boundary) and determine where boundary ends
                let boundaryEnd = boundary.value.length + 2;
                let isTerminator = false;

                if (
                    line.length >= boundary.value.length + 4 &&
                    line[boundary.value.length + 2] === 0x2d &&
                    line[boundary.value.length + 3] === 0x2d
                ) {
                    isTerminator = true;
                    boundaryEnd = boundary.value.length + 4;
                }

                // RFC 2046: boundary line may have trailing whitespace (space/tab) before CRLF
                let hasValidTrailing = true;
                for (let j = boundaryEnd; j < line.length; j++) {
                    if (!isWsp(line[j])) {
                        hasValidTrailing = false;
                        break;
                    }
                }
                if (!hasValidTrailing) {
                    continue;
                }

                if (isTerminator) {
                    await boundary.node.finalize(true);

                    this.currentNode = boundary.node.parentNode || this.root;
                } else {
                    // finalize any open child nodes (should be just one though)
                    await boundary.node.finalizeChildNodes(true);

                    this.currentNode = new MimeNode({
                        postalMime: this,
                        parentNode: boundary.node,
                        parentMultipartType: boundary.node.contentType.multipart
                    });
                }

                if (isFinal) {
                    return this.finalize();
                }

                return;
            }
        }

        if (this.currentNode.feed(line, lineBreak)) {
            // The headers ended with the line before this one, so the boundary this part
            // declares was not registered when the line was checked above. Read it again
            return this.processLine(line, lineBreak, isFinal);
        }

        if (isFinal) {
            return this.finalize();
        }
    }

    // Reads the next line without its line break. The break itself, the exact bytes between
    // the line and the next one, is returned alongside, because the body decoders write it
    // back out: a part has to keep the line endings it was sent with, see PassThroughDecoder.
    /** @internal */
    readLine(): { bytes: Uint8Array<ArrayBuffer>; lineBreak: Uint8Array<ArrayBuffer>; done: boolean } {
        let startPos = this.readPos;
        let endPos = this.readPos;

        while (this.readPos < this.av.length) {
            const c = this.av[this.readPos++];

            if (c !== 0x0d && c !== 0x0a) {
                endPos = this.readPos;
            }

            if (c === 0x0a) {
                return {
                    bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
                    lineBreak: this.av.subarray(endPos, this.readPos),
                    done: this.readPos >= this.av.length
                };
            }
        }

        // A message that ends without a line break still gets one after its last line, the
        // decoders write it out unless a boundary ended the part
        return {
            bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
            lineBreak: LINE_FEED,
            done: this.readPos >= this.av.length
        };
    }

    // Records a text part or a nested message under the node that selects it
    /** @internal */
    addTextEntry(selector: MimeNode, textType: TextType, item: TextEntryItem): void {
        let textEntry = this.textMap.get(selector);
        if (!textEntry) {
            textEntry = {};
            this.textMap.set(selector, textEntry);
        }
        const entries = textEntry[textType] || [];
        textEntry[textType] = entries;
        entries.push(item);
        this.textTypes.add(textType);
    }

    // Sorts every leaf of the tree into text content, nested messages and attachments.
    // `alternative` is the closest enclosing multipart/alternative, if any: its text parts
    // are collected under the alternative itself, so that the body is assembled from one
    // representation of it rather than from every one. `related` tells whether the part
    // sits inside a multipart/related, where a Content-ID makes it an inline resource
    /** @internal */
    async collectNode(node: MimeNode, alternative: MimeNode | false, related: boolean): Promise<void> {
        if (!node.contentType.multipart) {
            const inlineRfc822 = this.isInlineMessageRfc822(node);
            const rfc822DepthExceeded = inlineRfc822 && this.rfc822NestingDepth >= this.limits.maxRfc822NestingDepth;

            if (inlineRfc822 && !rfc822DepthExceeded) {
                await this.collectSubMessage(node);
            } else if (this.isInlineTextNode(node)) {
                const textType: TextType = node.contentType.parsed.value === 'text/html' ? 'html' : 'plain';
                this.addTextEntry(alternative || node, textType, { type: 'text', value: node.getTextContent() });
            } else if (node.content) {
                this.collectAttachment(node, node.content, related, rfc822DepthExceeded);
            }
        } else if (node.contentType.multipart === 'alternative') {
            alternative = node;
        } else if (node.contentType.multipart === 'related') {
            related = true;
        }

        for (let childNode of node.childNodes) {
            await this.collectNode(childNode, alternative, related);
        }
    }

    // Parses an inline message/rfc822 part with a nested parser and takes over its text
    // parts and attachments
    /** @internal */
    async collectSubMessage(node: MimeNode): Promise<void> {
        const subParser = new PostalMime(
            {
                // Options that decide how a part is classified stay with the parser that
                // was configured, the limits and their counters come from this parser.
                // Attachments are encoded by the parent parser, so raw buffers are kept here.
                attachmentEncoding: 'arraybuffer'
            },
            this
        );
        const subMessage = await subParser.parse(node.content || new ArrayBuffer(0));

        // counted before the header block below is rendered into the text and html
        this.counters.forwardedAddresses +=
            countAddresses(subMessage.from) +
            countAddresses(subMessage.to) +
            countAddresses(subMessage.cc) +
            countAddresses(subMessage.bcc);
        if (this.counters.forwardedAddresses > this.limits.maxForwardedAddresses) {
            throw createError(
                'EMAXFORWARDEDADDRESSES',
                `Maximum forwarded address count of ${this.limits.maxForwardedAddresses} addresses exceeded`
            );
        }

        // The nested parser renders no text, see parse, its text parts are taken over below
        // and rendered by the root parser along with everything else. What it holds of each
        // kind is read off its text types instead of its text and html
        const hasPlain = subParser.textTypes.has('plain');
        const hasHtml = subParser.textTypes.has('html');

        // default to text if there is no content
        if (hasPlain || !hasHtml) {
            this.addTextEntry(node, 'plain', { type: 'subMessage', value: subMessage });
        }

        if (hasHtml) {
            this.addTextEntry(node, 'html', { type: 'subMessage', value: subMessage });
        }

        subParser.textMap.forEach((subTextEntry, subTextNode) => {
            this.textMap.set(subTextNode, subTextEntry);
        });

        for (let attachment of subMessage.attachments) {
            this.attachments.push(attachment);
        }
    }

    /** @internal */
    collectAttachment(node: MimeNode, content: ArrayBuffer, related: boolean, rfc822DepthExceeded: boolean): void {
        const filename = node.contentDisposition.parsed.params.filename || node.contentType.parsed.params.name || null;
        // `content` is filled in below once the part type is known, hence the cast
        const attachment = {
            // An RFC 2231 filename is percent decoded without folding, since the same decoder
            // produces the boundary, so the fold happens here, see foldLineBreaks
            filename: filename ? decodeWords(foldLineBreaks(filename)) : null,
            mimeType: node.contentType.parsed.value,
            disposition: node.contentDisposition.parsed.value || null
        } as Attachment;

        // A nested message that was not parsed is not a renderable inline
        // resource, so it must not join the cid map behind an <img src>.
        if (related && node.contentId && !rfc822DepthExceeded) {
            attachment.related = true;
        }

        if (rfc822DepthExceeded) {
            // Tell the caller this part would have been parsed inline but hit
            // maxRfc822NestingDepth, so anything inside it is not reflected in
            // email.text, email.html or email.attachments.
            attachment.rfc822DepthExceeded = true;
        }

        if (node.contentDescription) {
            // decoded like filename, it is an unstructured header that may
            // carry encoded words
            attachment.description = decodeWords(node.contentDescription);
        }

        if (node.contentId) {
            attachment.contentId = node.contentId;
        }

        switch (node.contentType.parsed.value) {
            // Special handling for calendar events
            case 'text/calendar':
            case 'application/ics': {
                if (node.contentType.parsed.params.method) {
                    attachment.method = node.contentType.parsed.params.method.toString().toUpperCase().trim();
                }

                // Enforce into unicode, ending in exactly one newline. The trailing
                // newlines are counted rather than replaced with `/\n*$/`, which
                // retries at every newline of a run that does not end the text.
                const decodedText = node.getTextContent();
                let end = decodedText.length;
                while (end > 0 && decodedText.charCodeAt(end - 1) === 0x0a) {
                    end--;
                }
                attachment.content = textEncoder.encode(decodedText.slice(0, end) + '\n');
                break;
            }

            // Regular attachments
            default:
                attachment.content = content;
        }

        this.attachments.push(attachment);
    }

    // Joins the collected text parts into the plain and html bodies
    /** @internal */
    renderTextContent(): void {
        const textContent: Record<string, string[]> = {};

        this.textMap.forEach(mapEntry => {
            this.textTypes.forEach(textType => {
                const output = textContent[textType] || [];
                textContent[textType] = output;

                // a node without a part of this type is rendered from the other type
                const ownEntries = mapEntry[textType];
                const entries = ownEntries || mapEntry[textType === 'html' ? 'plain' : 'html'] || [];
                for (const textEntry of entries) {
                    output.push(renderEntry(textEntry, textType, !ownEntries));
                }
            });
        });

        Object.keys(textContent).forEach(textType => {
            this.textContent[textType] = textContent[textType].join('\n');
        });
    }

    /** @internal */
    isInlineTextNode(node: MimeNode): boolean {
        if (node.contentDisposition.parsed.value === 'attachment') {
            // no matter the type, this is an attachment
            return false;
        }

        switch (node.contentType.parsed.value) {
            case 'text/html':
            case 'text/plain':
                return true;

            case 'text/calendar':
            case 'text/csv':
            default:
                return false;
        }
    }

    /** @internal */
    isInlineMessageRfc822(node: MimeNode): boolean {
        if (this.forceRfc822Attachments || node.contentType.parsed.value !== 'message/rfc822') {
            return false;
        }
        // RFC 2046 5.2.1 allows no encoding but 7bit, 8bit and binary for a message/rfc822
        // body. Python parses the lines of a base64 or quoted-printable part as they are, so
        // the nested message it sees has no headers and holds the encoded text, and
        // mailparser keeps the part as one attachment. Decoding and inlining it here
        // rendered the html and listed the attachments of a message no scanner built on
        // either reads, so such a part is an attachment, with its content decoded
        const encoding = node.contentTransferEncoding.encoding;
        if (encoding === 'base64' || encoding === 'quoted-printable') {
            return false;
        }
        let disposition =
            node.contentDisposition.parsed.value || (this.options.rfc822Attachments ? 'attachment' : 'inline');
        return disposition === 'inline';
    }

    // A delivery status or feedback report carries the offending message as a part. It is
    // evidence rather than content, so it is not inlined into the body of the report
    /** @internal */
    hasReportParts(): boolean {
        let found = false;
        let walk = (node: MimeNode): void => {
            if (!node.contentType.multipart) {
                if (['message/delivery-status', 'message/feedback-report'].includes(node.contentType.parsed.value)) {
                    found = true;
                }
            }

            for (let childNode of node.childNodes) {
                walk(childNode);
            }
        };
        walk(this.root);
        return found;
    }

    /** @internal */
    async resolveStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
        let chunkLen = 0;
        let chunks: Uint8Array[] = [];
        const reader = stream.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            // A chunk that is not a byte view, eg. a string from a text stream, used to be
            // copied in as zeros
            if (!ArrayBuffer.isView(value)) {
                const error = createError('EINVALIDINPUT', 'Stream chunks must be Uint8Array values');
                // Not awaited, a source that fails or stalls on cancel must not hide this error
                reader.cancel(error).catch(() => {});
                throw error;
            }
            chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            chunkLen += value.byteLength;
        }

        const result = new Uint8Array(chunkLen);
        let chunkPointer = 0;
        for (let chunk of chunks) {
            result.set(chunk, chunkPointer);
            chunkPointer += chunk.length;
        }

        return result;
    }

    /** @internal */
    async resolveInput(buf: RawEmail): Promise<ArrayBuffer> {
        let input: RawEmail = buf;

        // Check if the input is a readable stream and resolve it into an ArrayBuffer
        if (isReadableStream(input)) {
            input = await this.resolveStream(input);
        }

        // Should it throw for an empty value instead of defaulting to an empty ArrayBuffer?
        input = input || new ArrayBuffer(0);

        // Cast string input to Uint8Array
        if (typeof input === 'string') {
            input = textEncoder.encode(input);
        }

        // Cast Blob to ArrayBuffer
        if (isBlob(input)) {
            input = await blobToArrayBuffer(input);
        }

        // Cast a Node.js Buffer, a typed array or a DataView into an ArrayBuffer.
        // `new Uint8Array(view)` only works for array-likes, so a DataView produced an
        // empty buffer and the message parsed to nothing without an error. Slicing off
        // byteOffset also keeps views over a larger buffer from reading their neighbours.
        if (ArrayBuffer.isView(input)) {
            return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
        }

        // Anything else, eg. a number or a plain object, was handed to the Uint8Array
        // constructor as it is and parsed into an empty or zero filled message
        if (!isArrayBuffer(input)) {
            throw createError('EINVALIDINPUT', 'Unsupported email input type');
        }

        return input;
    }

    // Properties are added in the order the output has always had them, so the required
    // ones are filled in below rather than in the literal
    /** @internal */
    buildMessage(): Email {
        const headers = this.root.headers;

        const message = {
            headers: headers.map(entry => ({
                key: entry.key,
                originalKey: entry.originalKey,
                value: entry.value
            }))
        } as Email;

        for (const key of ['from', 'sender'] as const) {
            const addressHeader = headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                const addresses = addressParser(addressHeader.value);
                if (addresses && addresses.length) {
                    message[key] = addresses[0];
                }
            }
        }

        for (const [key, camelKey] of [
            ['delivered-to', 'deliveredTo'],
            ['return-path', 'returnPath']
        ] as const) {
            const addressHeader = headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                const addresses = addressParser(addressHeader.value);
                if (addresses && addresses.length && addresses[0].address) {
                    message[camelKey] = addresses[0].address;
                }
            }
        }

        for (const [key, camelKey] of [
            ['to', 'to'],
            ['cc', 'cc'],
            ['bcc', 'bcc'],
            ['reply-to', 'replyTo']
        ] as const) {
            // Appended in place, concat() copies the whole list for every header
            const addresses: Address[] = [];
            for (const entry of headers) {
                if (entry.key === key && entry.value) {
                    for (const address of addressParser(entry.value)) {
                        addresses.push(address);
                    }
                }
            }

            if (addresses.length) {
                message[camelKey] = addresses;
            }
        }

        for (const [key, camelKey] of [
            ['subject', 'subject'],
            ['message-id', 'messageId'],
            ['in-reply-to', 'inReplyTo'],
            ['references', 'references']
        ] as const) {
            const header = headers.find(line => line.key === key);
            if (header && header.value) {
                message[camelKey] = decodeWords(header.value);
            }
        }

        let dateHeader = headers.find(line => line.key === 'date');
        if (dateHeader) {
            let date = new Date(dateHeader.value);
            // enforce ISO format if seems to be a valid date
            message.date = date.toString() === 'Invalid Date' ? dateHeader.value : date.toISOString();
        }

        if (this.textContent.html) {
            message.html = this.textContent.html;
        }

        if (this.textContent.plain) {
            message.text = this.textContent.plain;
        }

        message.attachments = this.attachments;

        // Expose raw header lines, in the same order as the headers array
        message.headerLines = this.root.rawHeaderLines.slice();

        return message;
    }

    // Every attachment holds binary content at this point, since nested parsers are
    // created with the arraybuffer encoding. The string check narrows the public content
    // type rather than handling a reachable case
    /** @internal */
    encodeAttachments(): void {
        switch (this.attachmentEncoding) {
            case 'arraybuffer':
                break;

            case 'base64':
                for (let attachment of this.attachments) {
                    if (attachment.content && typeof attachment.content !== 'string') {
                        attachment.content = base64ArrayBuffer(attachment.content);
                        attachment.encoding = 'base64';
                    }
                }
                break;

            case 'utf8': {
                let attachmentDecoder = new TextDecoder('utf8');
                for (let attachment of this.attachments) {
                    if (attachment.content && typeof attachment.content !== 'string') {
                        attachment.content = attachmentDecoder.decode(attachment.content);
                        attachment.encoding = 'utf8';
                    }
                }
                break;
            }
        }
    }

    /**
     * Parses a raw email message. A parser instance can be used once
     *
     * @param buf Raw email message
     * @returns The parsed email
     */
    async parse(buf: RawEmail): Promise<Email> {
        if (this.started) {
            throw createError('EPARSERREUSED', 'Can not reuse parser, create a new PostalMime object');
        }
        this.started = true;

        this.buf = await this.resolveInput(buf);
        this.av = new Uint8Array(this.buf);
        this.readPos = 0;

        while (this.readPos < this.av.length) {
            const line = this.readLine();

            await this.processLine(line.bytes, line.lineBreak, line.done);
        }

        this.forceRfc822Attachments = Boolean(this.options.forceRfc822Attachments) || this.hasReportParts();
        await this.collectNode(this.root, false, false);

        // A nested parser hands its text parts to its parent, see collectSubMessage, and the
        // root parser renders them all at once. Rendering at every level as well cost each
        // level the text and html of everything below it, and kept them until the root was
        // done: a chain of forwards as deep as maxRfc822NestingDepth allows took ten times
        // the time and the memory of the flat message it held
        if (this.rfc822NestingDepth === 0) {
            this.renderTextContent();
        }

        const message = this.buildMessage();
        this.encodeAttachments();

        return message;
    }
}
