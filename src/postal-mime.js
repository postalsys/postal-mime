import MimeNode from './mime-node';
import { textToHtml, htmlToText } from './text-format';
import addressParser from './address-parser';
import { decodeWords } from './decode-strings';

export default class PostalMime {
    constructor() {
        this.root = this.currentNode = new MimeNode({
            parser: this
        });
        this.boundaries = [];

        this.textContent = {};
        this.attachments = [];
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

                for (let i = 0; i < boundary.value.length; i++) {
                    if (line[i + 2] !== boundary.value[0]) {
                        continue;
                    }
                }

                if (isTerminator) {
                    await boundary.node.finalize();

                    this.currentNode = boundary.node.parentNode || this.root;
                } else {
                    // finalize any open child nodes (should be just one though)
                    await boundary.node.finalizeChildNodes();

                    this.currentNode = new MimeNode({
                        parser: this,
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
        let textMap = new Map();

        let walk = async (node, alternative, related) => {
            alternative = alternative || false;
            related = related || false;

            if (!node.contentType.multipart) {
                // regular node

                // is it text?
                if (/^text\//i.test(node.contentType.parsed.value) && node.contentDisposition.parsed.value !== 'attachment') {
                    let textType = node.contentType.parsed.value.substr(node.contentType.parsed.value.indexOf('/') + 1);
                    textTypes.add(textType);
                    let selectorNode = alternative || node;
                    if (!textMap.has(selectorNode)) {
                        textMap.set(selectorNode, { [textType]: node.getTextContent() });
                    } else {
                        textMap.get(selectorNode)[textType] = node.getTextContent();
                    }
                } else if (node.content) {
                    // attachment!
                    let filename = node.contentDisposition.parsed.params.filename || node.contentType.parsed.params.name || null;
                    let attachment = {
                        filename: decodeWords(filename),
                        mimeType: node.contentType.parsed.value,
                        disposition: node.contentDisposition.parsed.value || null
                    };

                    if (related && node.contentId) {
                        attachment.related = true;
                    }

                    if (node.contentId) {
                        attachment.contentId = node.contentId;
                    }

                    attachment.content = node.content;

                    this.attachments.push(attachment);
                }
            } else if (node.contentType.multipart === 'alternative') {
                alternative = node;
            } else if (node.contentType.multipart === 'related') {
                related = node;
            }

            for (let childNode of node.childNodes) {
                walk(childNode, alternative, related);
            }
        };

        walk(this.root, false, []);

        textMap.forEach((mapEntry, key) => {
            textTypes.forEach(textType => {
                let textVal = textType in mapEntry ? mapEntry[textType] : this.generateTextNode(textType, mapEntry);

                if (!textContent[textType]) {
                    textContent[textType] = [];
                }
                textContent[textType].push(textVal);
            });
        });

        Object.keys(textContent).forEach(textType => {
            textContent[textType] = textContent[textType].join('\n');
        });

        this.textContent = textContent;
    }

    generateTextNode(textType, mapEntry) {
        switch (textType) {
            case 'html':
                if (mapEntry.plain) {
                    return textToHtml(mapEntry.plain);
                }
                break;
            case 'plain':
                if (mapEntry.html) {
                    return htmlToText(mapEntry.html);
                }
                break;
        }
        return '';
    }

    async parse(buf) {
        this.buf = buf;
        this.av = new Uint8Array(buf);
        this.readPos = 0;

        while (this.readPos < this.av.length) {
            const line = this.readLine();

            await this.processLine(line.bytes, line.done);
        }

        await this.processNodeTree();

        let message = {
            headers: this.root.headers.map(entry => ({ key: entry.key, value: entry.value })).reverse()
        };

        for (let key of ['from', 'sender', 'reply-to']) {
            let addressHeader = this.root.headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                let addresses = addressParser(addressHeader.value);
                if (addresses && addresses.length) {
                    message[key.replace(/\-(.)/g, (o, c) => c.toUpperCase())] = addresses[0];
                }
            }
        }

        for (let key of ['delivered-to', 'return-path']) {
            let addressHeader = this.root.headers.find(line => line.key === key);
            if (addressHeader && addressHeader.value) {
                let addresses = addressParser(addressHeader.value);
                if (addresses && addresses.length && addresses[0].address) {
                    message[key.replace(/\-(.)/g, (o, c) => c.toUpperCase())] = addresses[0].address;
                }
            }
        }

        for (let key of ['to', 'cc', 'bcc']) {
            let addressHeaders = this.root.headers.filter(line => line.key === key);
            let addresses = [];

            addressHeaders
                .filter(entry => entry && entry.value)
                .map(entry => addressParser(entry.value))
                .forEach(parsed => (addresses = addresses.concat(parsed || [])));

            if (addresses && addresses.length) {
                message[key] = addresses;
            }
        }

        for (let key of ['subject', 'message-id', 'in-reply-to', 'references']) {
            let header = this.root.headers.find(line => line.key === key);
            if (header && header.value) {
                message[key.replace(/\-(.)/g, (o, c) => c.toUpperCase())] = decodeWords(header.value);
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

        if (this.textContent && this.textContent.html) {
            message.html = this.textContent.html;
        }

        if (this.textContent && this.textContent.plain) {
            message.text = this.textContent.plain;
        }

        message.attachments = this.attachments;

        return message;
    }
}
