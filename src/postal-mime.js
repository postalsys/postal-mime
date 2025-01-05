import MimeNode from './mime-node.js';
import { textToHtml, htmlToText, formatTextHeader, formatHtmlHeader } from './text-format.js';
import addressParser from './address-parser.js';
import { decodeWords, textEncoder, blobToArrayBuffer } from './decode-strings.js';
import { base64ArrayBuffer } from './base64-encoder.js';

export { addressParser, decodeWords };

export default class PostalMime {
    static parse(buf, options) {
        const parser = new PostalMime(options);
        return parser.parse(buf);
    }

    constructor(options) {
        this.options = options || {};

        this.root = this.currentNode = new MimeNode({
            postalMime: this
        });
        this.boundaries = [];

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

                if (line.length !== boundary.value.length + 2 && line.length !== boundary.value.length + 4) {
                    continue;
                }

                let isTerminator = line.length === boundary.value.length + 4;

                if (isTerminator && (line[line.length - 2] !== 0x2d || line[line.length - 1] !== 0x2d)) {
                    continue;
                }

                let boudaryMatches = true;
                for (let i = 0; i < boundary.value.length; i++) {
                    if (line[i + 2] !== boundary.value[i]) {
                        boudaryMatches = false;
                        break;
                    }
                }
                if (!boudaryMatches) {
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
                        parentNode: boundary.node
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

        let res = () => {
            return {
                bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
                done: this.readPos >= this.av.length
            };
        };

        while (this.readPos < this.av.length) {
            const c = this.av[this.readPos++];

            if (c !== 0x0d && c !== 0x0a) {
                endPos = this.readPos;
            }

            if (c === 0x0a) {
                return res();
            }
        }

        return res();
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
                // is it inline message/rfc822
                if (this.isInlineMessageRfc822(node) && !forceRfc822Attachments) {
                    const subParser = new PostalMime();
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
                    const filename = node.contentDisposition.parsed.params.filename || node.contentType.parsed.params.name || null;
                    const attachment = {
                        filename: filename ? decodeWords(filename) : null,
                        mimeType: node.contentType.parsed.value,
                        disposition: node.contentDisposition.parsed.value || null
                    };

                    if (related && node.contentId) {
                        attachment.related = true;
                    }

                    if (node.contentDescription) {
                        attachment.description = node.contentDescription;
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

        await walk(this.root, false, []);

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

    isInlineMessageRfc822(node) {
        if (node.contentType.parsed.value !== 'message/rfc822') {
            return false;
        }
        let disposition = node.contentDisposition.parsed.value || (this.options.rfc822Attachments ? 'attachment' : 'inline');
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
                if (['message/delivery-status', 'message/feedback-report'].includes(node.contentType.parsed.value)) {
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

        // Cast Node.js Buffer object or Uint8Array into ArrayBuffer
        if (buf.buffer instanceof ArrayBuffer) {
            buf = new Uint8Array(buf).buffer;
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
            headers: this.root.headers.map(entry => ({ key: entry.key, value: entry.value })).reverse()
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
                    const camelKey = key.replace(/\-(.)/g, (o, c) => c.toUpperCase());
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
                const camelKey = key.replace(/\-(.)/g, (o, c) => c.toUpperCase());
                message[camelKey] = addresses;
            }
        }

        for (const key of ['subject', 'message-id', 'in-reply-to', 'references']) {
            const header = this.root.headers.find(line => line.key === key);
            if (header && header.value) {
                const camelKey = key.replace(/\-(.)/g, (o, c) => c.toUpperCase());
                message[camelKey] = decodeWords(header.value);
            }
        }

        let dateHeader = this.root.headers.find(line => line.key === 'date');
        if (dateHeader) {
            let date = new Date(dateHeader.value);
            if (!date || date.toString() === 'Invalid Date') {
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
                throw new Error('Unknwon attachment encoding');
        }

        return message;
    }
}
