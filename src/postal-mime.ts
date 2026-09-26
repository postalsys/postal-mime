import MimeNode from './mime-node.js';
import { textToHtml, htmlToText, formatTextHeader, formatHtmlHeader } from './text-format.js';
import addressParser from './address-parser.js';
import { decodeWords, textEncoder, blobToArrayBuffer } from './decode-strings.js';
import { base64ArrayBuffer } from './base64-encoder.js';
import type { Address, Attachment, Email, PostalMimeOptions, RawEmail } from './types.js';

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

const MAX_NESTING_DEPTH = 256;
const MAX_HEADERS_SIZE = 2 * 1024 * 1024;
// Inline message/rfc822 parts are parsed recursively. Without a dedicated limit
// each nesting level spawns a new parser that retains the full nested message,
// so a small crafted email can exhaust memory (OOM crash). Cap the recursion and
// treat deeper nested messages as regular attachments instead.
const MAX_RFC822_NESTING_DEPTH = 10;

// Limit options must be validated rather than falsy-coalesced. `0` would silently
// restore the default, and a string or NaN disables the limit altogether, because
// every `size > limit` comparison against such a value is false. Callers that
// forward a request supplied options object would otherwise hand an attacker a way
// to turn the limits off.
function parseLimitOption(value: unknown, defaultValue: number, name: string): number {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new TypeError(`${name} must be a non-negative integer`);
    }

    return value;
}

export default class PostalMime {
    /** @internal */ options: PostalMimeOptions;
    /** @internal */ mimeOptions: { maxNestingDepth: number; maxHeadersSize: number };
    /** @internal */ maxRfc822NestingDepth: number;
    /** @internal */ rfc822NestingDepth: number;
    /** @internal */ root: MimeNode;
    /** @internal */ currentNode: MimeNode;
    /** @internal */ boundaries: Boundary[];
    /** @internal */ headerSize: number;
    /** @internal */ textContent: Record<string, string>;
    /** @internal */ textMap: Map<MimeNode, TextEntry>;
    /** @internal */ textTypes: Set<TextType>;
    /** @internal */ attachments: Attachment[];
    /** @internal */ attachmentEncoding: string;
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

    constructor(options?: PostalMimeOptions) {
        this.options = options || {};
        this.mimeOptions = {
            maxNestingDepth: parseLimitOption(this.options.maxNestingDepth, MAX_NESTING_DEPTH, 'maxNestingDepth'),
            maxHeadersSize: parseLimitOption(this.options.maxHeadersSize, MAX_HEADERS_SIZE, 'maxHeadersSize')
        };

        // A limit of 0 disables inline parsing entirely, so every message/rfc822 part
        // becomes an attachment.
        this.maxRfc822NestingDepth = parseLimitOption(
            this.options.maxRfc822NestingDepth,
            MAX_RFC822_NESTING_DEPTH,
            'maxRfc822NestingDepth'
        );

        // Internal state that a nested parser receives from its parent, see collectSubMessage.
        // It is deliberately not an option, so that forwarding a caller supplied options
        // object can not seed it and switch the recursion limit off.
        this.rfc822NestingDepth = 0;

        this.root = this.currentNode = new MimeNode({
            postalMime: this,
            ...this.mimeOptions
        });
        this.boundaries = [];

        // Header bytes seen across every part of this message, see MimeNode.feed
        this.headerSize = 0;

        this.textContent = {};
        this.textMap = new Map();
        this.textTypes = new Set();
        this.attachments = [];
        this.forceRfc822Attachments = false;

        this.attachmentEncoding =
            (this.options.attachmentEncoding || '')
                .toString()
                .replace(/[-_\s]/g, '')
                .trim()
                .toLowerCase() || 'arraybuffer';

        this.started = false;
    }

    /** @internal */
    async finalize(): Promise<void> {
        // close all pending nodes
        await this.root.finalize();
    }

    /** @internal */
    async processLine(line: Uint8Array<ArrayBuffer>, isFinal: boolean): Promise<void> {
        let boundaries = this.boundaries;

        // check if this is a mime boundary
        if (boundaries.length && line.length > 2 && line[0] === 0x2d && line[1] === 0x2d) {
            // could be a boundary marker
            for (let i = boundaries.length - 1; i >= 0; i--) {
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
                    if (line[j] !== 0x20 && line[j] !== 0x09) {
                        hasValidTrailing = false;
                        break;
                    }
                }
                if (!hasValidTrailing) {
                    continue;
                }

                if (isTerminator) {
                    await boundary.node.finalize();

                    this.currentNode = boundary.node.parentNode || this.root;
                } else {
                    // finalize any open child nodes (should be just one though)
                    await boundary.node.finalizeChildNodes();

                    this.currentNode = new MimeNode({
                        postalMime: this,
                        parentNode: boundary.node,
                        parentMultipartType: boundary.node.contentType.multipart,
                        ...this.mimeOptions
                    });
                }

                if (isFinal) {
                    return this.finalize();
                }

                return;
            }
        }

        this.currentNode.feed(line);

        if (isFinal) {
            return this.finalize();
        }
    }

    /** @internal */
    readLine(): { bytes: Uint8Array<ArrayBuffer>; done: boolean } {
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
                    done: this.readPos >= this.av.length
                };
            }
        }

        return {
            bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
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
            const rfc822DepthExceeded = inlineRfc822 && this.rfc822NestingDepth >= this.maxRfc822NestingDepth;

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
        const subParser = new PostalMime({
            // Only the limits are inherited. Options that decide how a part
            // is classified stay with the parser that was configured.
            ...this.mimeOptions,
            maxRfc822NestingDepth: this.maxRfc822NestingDepth,
            // attachments are encoded by the parent parser, keep raw buffers here
            attachmentEncoding: 'arraybuffer'
        });
        subParser.rfc822NestingDepth = this.rfc822NestingDepth + 1;
        const subMessage = (node.subMessage = await subParser.parse(node.content || new ArrayBuffer(0)));

        // default to text if there is no content
        if (subMessage.text || !subMessage.html) {
            this.addTextEntry(node, 'plain', { type: 'subMessage', value: subMessage });
        }

        if (subMessage.html) {
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
            filename: filename ? decodeWords(filename) : null,
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
                const decodedText = node.getTextContent().replace(/\r?\n/g, '\n');
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
            chunks.push(value);
            chunkLen += value.length;
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

            default:
                throw new Error('Unknown attachment encoding');
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
            throw new Error('Can not reuse parser, create a new PostalMime object');
        }
        this.started = true;

        this.buf = await this.resolveInput(buf);
        this.av = new Uint8Array(this.buf);
        this.readPos = 0;

        while (this.readPos < this.av.length) {
            const line = this.readLine();

            await this.processLine(line.bytes, line.done);
        }

        this.forceRfc822Attachments = Boolean(this.options.forceRfc822Attachments) || this.hasReportParts();
        await this.collectNode(this.root, false, false);
        this.renderTextContent();

        const message = this.buildMessage();
        this.encodeAttachments();

        return message;
    }
}
