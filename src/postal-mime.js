import MimeNode from './mime-node.js';
import { textToHtml, htmlToText, formatTextHeader, formatHtmlHeader } from './text-format.js';
import addressParser from './address-parser.js';
import { decodeWords, textEncoder, blobToArrayBuffer } from './decode-strings.js';
import { base64ArrayBuffer } from './base64-encoder.js';

export { addressParser, decodeWords };

const MAX_NESTING_DEPTH = 256;
const MAX_HEADERS_SIZE = 2 * 1024 * 1024;
// Inline message/rfc822 parts are parsed recursively. Without a dedicated limit
// each nesting level spawns a new parser that retains the full nested message,
// so a small crafted email can exhaust memory (OOM crash). Cap the recursion and
// treat deeper nested messages as regular attachments instead.
const MAX_RFC822_NESTING_DEPTH = 10;

function toCamelCase(key) {
    return key.replace(/-(.)/g, (o, c) => c.toUpperCase());
}

// Limit options must be validated rather than falsy-coalesced. `0` would silently
// restore the default, and a string or NaN disables the limit altogether, because
// every `size > limit` comparison against such a value is false. Callers that
// forward a request supplied options object would otherwise hand an attacker a way
// to turn the limits off.
function parseLimitOption(value, defaultValue, name) {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new TypeError(`${name} must be a non-negative integer`);
    }

    return value;
}

export default class PostalMime {
    // async so that an invalid option rejects the returned promise instead of throwing
    // synchronously, which would escape a `.catch()` chain
    static async parse(buf, options) {
        const parser = new PostalMime(options);
        return parser.parse(buf);
    }

    // rfc822NestingDepth is internal state that nested parsers receive from their parent.
    // It is deliberately a separate argument rather than an option, so that forwarding a
    // caller supplied options object can not seed it and switch the recursion limit off.
    constructor(options, rfc822NestingDepth = 0) {
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
        this.rfc822NestingDepth = rfc822NestingDepth;

        this.root = this.currentNode = new MimeNode({
            postalMime: this,
            ...this.mimeOptions
        });
        this.boundaries = [];

        // Header bytes seen across every part of this message, see MimeNode.feed
        this.headerSize = 0;

        this.textContent = {};
        this.attachments = [];

        this.attachmentEncoding =
            (this.options.attachmentEncoding || '')
                .toString()
                .replace(/[-_\s]/g, '')
                .trim()
                .toLowerCase() || 'arraybuffer';

        this.started = false;
    }

    async finalize() {
        // close all pending nodes
        await this.root.finalize();
    }

    async processLine(line, isFinal) {
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

    readLine() {
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

    async processNodeTree() {
        // get text nodes

        let textContent = {};

        let textTypes = new Set();
        let textMap = (this.textMap = new Map());

        let forceRfc822Attachments = this.forceRfc822Attachments();

        let walk = async (node, alternative, related) => {
            alternative = alternative || false;
            related = related || false;

            if (!node.contentType.multipart) {
                const inlineRfc822 = this.isInlineMessageRfc822(node) && !forceRfc822Attachments;
                const rfc822DepthExceeded = inlineRfc822 && this.rfc822NestingDepth >= this.maxRfc822NestingDepth;

                // is it inline message/rfc822
                if (inlineRfc822 && !rfc822DepthExceeded) {
                    const subParser = new PostalMime(
                        {
                            // Only the limits are inherited. Options that decide how a part
                            // is classified stay with the parser that was configured.
                            ...this.mimeOptions,
                            maxRfc822NestingDepth: this.maxRfc822NestingDepth,
                            // attachments are encoded by the parent parser, keep raw buffers here
                            attachmentEncoding: 'arraybuffer'
                        },
                        this.rfc822NestingDepth + 1
                    );
                    node.subMessage = await subParser.parse(node.content);

                    if (!textMap.has(node)) {
                        textMap.set(node, {});
                    }

                    let textEntry = textMap.get(node);

                    // default to text if there is no content
                    if (node.subMessage.text || !node.subMessage.html) {
                        textEntry.plain = textEntry.plain || [];
                        textEntry.plain.push({ type: 'subMessage', value: node.subMessage });
                        textTypes.add('plain');
                    }

                    if (node.subMessage.html) {
                        textEntry.html = textEntry.html || [];
                        textEntry.html.push({ type: 'subMessage', value: node.subMessage });
                        textTypes.add('html');
                    }

                    if (subParser.textMap) {
                        subParser.textMap.forEach((subTextEntry, subTextNode) => {
                            textMap.set(subTextNode, subTextEntry);
                        });
                    }

                    for (let attachment of node.subMessage.attachments || []) {
                        this.attachments.push(attachment);
                    }
                }

                // is it text?
                else if (this.isInlineTextNode(node)) {
                    let textType = node.contentType.parsed.value.substr(node.contentType.parsed.value.indexOf('/') + 1);

                    let selectorNode = alternative || node;
                    if (!textMap.has(selectorNode)) {
                        textMap.set(selectorNode, {});
                    }

                    let textEntry = textMap.get(selectorNode);
                    textEntry[textType] = textEntry[textType] || [];
                    textEntry[textType].push({ type: 'text', value: node.getTextContent() });
                    textTypes.add(textType);
                }

                // is it an attachment
                else if (node.content) {
                    const filename =
                        node.contentDisposition?.parsed?.params?.filename ||
                        node.contentType.parsed.params.name ||
                        null;
                    const attachment = {
                        filename: filename ? decodeWords(filename) : null,
                        mimeType: node.contentType.parsed.value,
                        disposition: node.contentDisposition?.parsed?.value || null
                    };

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
                                attachment.method = node.contentType.parsed.params.method
                                    .toString()
                                    .toUpperCase()
                                    .trim();
                            }

                            // Enforce into unicode
                            const decodedText = node.getTextContent().replace(/\r?\n/g, '\n').replace(/\n*$/, '\n');
                            attachment.content = textEncoder.encode(decodedText);
                            break;
                        }

                        // Regular attachments
                        default:
                            attachment.content = node.content;
                    }

                    this.attachments.push(attachment);
                }
            } else if (node.contentType.multipart === 'alternative') {
                alternative = node;
            } else if (node.contentType.multipart === 'related') {
                related = node;
            }

            for (let childNode of node.childNodes) {
                await walk(childNode, alternative, related);
            }
        };

        await walk(this.root, false, false);

        textMap.forEach(mapEntry => {
            textTypes.forEach(textType => {
                if (!textContent[textType]) {
                    textContent[textType] = [];
                }

                if (mapEntry[textType]) {
                    mapEntry[textType].forEach(textEntry => {
                        switch (textEntry.type) {
                            case 'text':
                                textContent[textType].push(textEntry.value);
                                break;

                            case 'subMessage':
                                {
                                    switch (textType) {
                                        case 'html':
                                            textContent[textType].push(formatHtmlHeader(textEntry.value));
                                            break;
                                        case 'plain':
                                            textContent[textType].push(formatTextHeader(textEntry.value));
                                            break;
                                    }
                                }
                                break;
                        }
                    });
                } else {
                    let alternativeType;
                    switch (textType) {
                        case 'html':
                            alternativeType = 'plain';
                            break;
                        case 'plain':
                            alternativeType = 'html';
                            break;
                    }

                    (mapEntry[alternativeType] || []).forEach(textEntry => {
                        switch (textEntry.type) {
                            case 'text':
                                switch (textType) {
                                    case 'html':
                                        textContent[textType].push(textToHtml(textEntry.value));
                                        break;
                                    case 'plain':
                                        textContent[textType].push(htmlToText(textEntry.value));
                                        break;
                                }
                                break;

                            case 'subMessage':
                                {
                                    switch (textType) {
                                        case 'html':
                                            textContent[textType].push(formatHtmlHeader(textEntry.value));
                                            break;
                                        case 'plain':
                                            textContent[textType].push(formatTextHeader(textEntry.value));
                                            break;
                                    }
                                }
                                break;
                        }
                    });
                }
            });
        });

        Object.keys(textContent).forEach(textType => {
            textContent[textType] = textContent[textType].join('\n');
        });

        this.textContent = textContent;
    }

    isInlineTextNode(node) {
        if (node.contentDisposition?.parsed?.value === 'attachment') {
            // no matter the type, this is an attachment
            return false;
        }

        switch (node.contentType.parsed?.value) {
            case 'text/html':
            case 'text/plain':
                return true;

            case 'text/calendar':
            case 'text/csv':
            default:
                return false;
        }
    }

    isInlineMessageRfc822(node) {
        if (node.contentType.parsed?.value !== 'message/rfc822') {
            return false;
        }
        let disposition =
            node.contentDisposition?.parsed?.value || (this.options.rfc822Attachments ? 'attachment' : 'inline');
        return disposition === 'inline';
    }

    // Check if this is a specially crafted report email where message/rfc822 content should not be inlined
    forceRfc822Attachments() {
        if (this.options.forceRfc822Attachments) {
            return true;
        }

        let forceRfc822Attachments = false;
        let walk = node => {
            if (!node.contentType.multipart) {
                if (
                    node.contentType.parsed &&
                    ['message/delivery-status', 'message/feedback-report'].includes(node.contentType.parsed.value)
                ) {
                    forceRfc822Attachments = true;
                }
            }

            for (let childNode of node.childNodes) {
                walk(childNode);
            }
        };
        walk(this.root);
        return forceRfc822Attachments;
    }

    async resolveStream(stream) {
        let chunkLen = 0;
        let chunks = [];
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

    async parse(buf) {
        if (this.started) {
            throw new Error('Can not reuse parser, create a new PostalMime object');
        }
        this.started = true;

        // Check if the input is a readable stream and resolve it into an ArrayBuffer
        if (buf && typeof buf.getReader === 'function') {
            buf = await this.resolveStream(buf);
        }

        // Should it throw for an empty value instead of defaulting to an empty ArrayBuffer?
        buf = buf || new ArrayBuffer(0);

        // Cast string input to Uint8Array
        if (typeof buf === 'string') {
            buf = textEncoder.encode(buf);
        }

        // Cast Blob to ArrayBuffer
        if (buf instanceof Blob || Object.prototype.toString.call(buf) === '[object Blob]') {
            buf = await blobToArrayBuffer(buf);
        }

        // Cast a Node.js Buffer, a typed array or a DataView into an ArrayBuffer.
        // `new Uint8Array(view)` only works for array-likes, so a DataView produced an
        // empty buffer and the message parsed to nothing without an error. Slicing off
        // byteOffset also keeps views over a larger buffer from reading their neighbours.
        if (ArrayBuffer.isView(buf)) {
            buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }

        this.buf = buf;

        this.av = new Uint8Array(buf);
        this.readPos = 0;

        while (this.readPos < this.av.length) {
            const line = this.readLine();

            await this.processLine(line.bytes, line.done);
        }

        await this.processNodeTree();

        const message = {
            headers: this.root.headers.map(entry => ({
                key: entry.key,
                originalKey: entry.originalKey,
                value: entry.value
            }))
        };

        for (const key of ['from', 'sender']) {
            const addressHeader = this.root.headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                const addresses = addressParser(addressHeader.value);
                if (addresses && addresses.length) {
                    message[key] = addresses[0];
                }
            }
        }

        for (const key of ['delivered-to', 'return-path']) {
            const addressHeader = this.root.headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                const addresses = addressParser(addressHeader.value);
                if (addresses && addresses.length && addresses[0].address) {
                    const camelKey = toCamelCase(key);
                    message[camelKey] = addresses[0].address;
                }
            }
        }

        for (const key of ['to', 'cc', 'bcc', 'reply-to']) {
            const addressHeaders = this.root.headers.filter(line => line.key === key);
            let addresses = [];

            addressHeaders
                .filter(entry => entry && entry.value)
                .map(entry => addressParser(entry.value))
                .forEach(parsed => (addresses = addresses.concat(parsed || [])));

            if (addresses && addresses.length) {
                const camelKey = toCamelCase(key);
                message[camelKey] = addresses;
            }
        }

        for (const key of ['subject', 'message-id', 'in-reply-to', 'references']) {
            const header = this.root.headers.find(line => line.key === key);
            if (header && header.value) {
                const camelKey = toCamelCase(key);
                message[camelKey] = decodeWords(header.value);
            }
        }

        let dateHeader = this.root.headers.find(line => line.key === 'date');
        if (dateHeader) {
            let date = new Date(dateHeader.value);
            if (date.toString() === 'Invalid Date') {
                date = dateHeader.value;
            } else {
                // enforce ISO format if seems to be a valid date
                date = date.toISOString();
            }
            message.date = date;
        }

        if (this.textContent?.html) {
            message.html = this.textContent.html;
        }

        if (this.textContent?.plain) {
            message.text = this.textContent.plain;
        }

        message.attachments = this.attachments;

        // Expose raw header lines, in the same order as the headers array
        message.headerLines = (this.root.rawHeaderLines || []).slice();

        switch (this.attachmentEncoding) {
            case 'arraybuffer':
                break;

            case 'base64':
                for (let attachment of message.attachments || []) {
                    if (attachment?.content) {
                        attachment.content = base64ArrayBuffer(attachment.content);
                        attachment.encoding = 'base64';
                    }
                }
                break;

            case 'utf8':
                let attachmentDecoder = new TextDecoder('utf8');
                for (let attachment of message.attachments || []) {
                    if (attachment?.content) {
                        attachment.content = attachmentDecoder.decode(attachment.content);
                        attachment.encoding = 'utf8';
                    }
                }
                break;

            default:
                throw new Error('Unknown attachment encoding');
        }

        return message;
    }
}
