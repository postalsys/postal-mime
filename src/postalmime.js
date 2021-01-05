class Base64Decoder {
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

        return new Promise(resolve => {
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

class QPDecoder {
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
        encodedBytes.forEach((b, i) => {
            dataView.setUint8(i, parseInt(b, 16));
        });
        return buf;
    }

    decodeChunks(str) {
        // unwrap newlines
        str = str.replace(/=\r?\n/g, '');

        let list = str.split(/(?==)/);
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
                encodedBytes.push(part.substr(1));
                continue;
            }

            if (part.length > 3) {
                encodedBytes.push(part.substr(1, 2));
                this.chunks.push(this.decodeQPBytes(encodedBytes));
                encodedBytes = [];

                part = part.substr(3);
                this.chunks.push(part);
            }
        }
        if (encodedBytes.length) {
            this.chunks.push(decodeQPBytes(encodedBytes));
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

        let partialEnding = str.match(/=[a-fA-F0-9]?$/);
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
        let blob = new Blob(this.chunks, { type: 'application/octet-stream' });
        const fr = new FileReader();

        return new Promise(resolve => {
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

class PassThroughDecoder {
    constructor() {
        this.chunks = [];
    }

    update(line) {
        this.chunks.push(line);
        this.chunks.push('\n');
    }

    finalize() {
        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        let blob = new Blob(this.chunks, { type: 'application/octet-stream' });
        const fr = new FileReader();

        return new Promise(resolve => {
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

class MimeNode {
    constructor(opts) {
        opts = opts || {};

        this.parser = opts.parser;

        this.root = !!opts.parentNode;
        this.childNodes = [];
        if (opts.parentNode) {
            opts.parentNode.childNodes.push(this);
        }

        this.state = 'header';

        this.headerLines = [];
        this.decoders = new Map();

        this.contentType = {
            value: 'text/plain'
        };

        this.contentTransferEncoding = {
            value: '8bit'
        };

        this.contentDisposition = {
            value: ''
        };

        this.headers = [];

        this.contentDecoder = false;
    }

    getDecoder(charset) {
        charset = charset || 'utf8';
        if (this.decoders.has(charset)) {
            return this.decoders.get(charset);
        }
        let decoder;
        try {
            decoder = new TextDecoder(charset);
        } catch (err) {
            if (charset === 'utf8') {
                // is this even possible?
                throw err;
            }
            // use default
            return this.getDecoder();
        }

        this.decoders.set(charset, decoder);
        return decoder;
    }

    setupContentDecoder(transferEncoding) {
        if (/base64/i.test(transferEncoding)) {
            this.contentDecoder = new Base64Decoder();
        } else if (/quoted-printable/i.test(transferEncoding)) {
            this.contentDecoder = new QPDecoder({ decoder: this.getDecoder(this.contentType.parsed.params.charset) });
        } else {
            this.contentDecoder = new PassThroughDecoder();
        }
    }

    async finalize() {
        if (this.state === 'finished') {
            return;
        }

        // remove self from boundary listing
        let boundaries = this.parser.boundaries;
        for (let i = boundaries.length - 1; i >= 0; i--) {
            let boundary = boundaries[i];
            if (boundary.node === this) {
                boundaries.splice(i, 1);
                break;
            }
        }

        await this.finalizeChildNodes();

        this.content = await this.contentDecoder.finalize();

        this.state = 'finished';
    }

    async finalizeChildNodes() {
        for (let childNode of this.childNodes) {
            await childNode.finalize();
        }
    }

    parseStructuredHeader(str) {
        let response = {
            value: false,
            params: {}
        };

        let key = false;
        let value = '';
        let stage = 'value';

        let quote = false;
        let escaped = false;
        let chr;

        for (let i = 0, len = str.length; i < len; i++) {
            chr = str.charAt(i);
            switch (stage) {
                case 'key':
                    if (chr === '=') {
                        key = value.trim().toLowerCase();
                        stage = 'value';
                        value = '';
                        break;
                    }
                    value += chr;
                    break;
                case 'value':
                    if (escaped) {
                        value += chr;
                    } else if (chr === '\\') {
                        escaped = true;
                        continue;
                    } else if (quote && chr === quote) {
                        quote = false;
                    } else if (!quote && chr === '"') {
                        quote = chr;
                    } else if (!quote && chr === ';') {
                        if (key === false) {
                            response.value = value.trim();
                        } else {
                            response.params[key] = value.trim();
                        }
                        stage = 'key';
                        value = '';
                    } else {
                        value += chr;
                    }
                    escaped = false;
                    break;
            }
        }

        // finalize remainder
        value = value.trim();
        if (stage === 'value') {
            if (key === false) {
                // default value
                response.value = value;
            } else {
                // subkey value
                response.params[key] = value;
            }
        } else if (value) {
            // treat as key without value, see emptykey:
            // Header-Key: somevalue; key=value; emptykey
            response.params[value.toLowerCase()] = '';
        }

        if (response.value) {
            response.value = response.value.toLowerCase();
        }

        return response;
    }

    decodeFlowedText(str, delSp) {
        return (
            str
                .split(/\r?\n/)
                // remove soft linebreaks
                // soft linebreaks are added after space symbols
                .reduce((previousValue, currentValue) => {
                    if (/ $/.test(previousValue) && !/(^|\n)-- $/.test(previousValue)) {
                        if (delSp) {
                            // delsp adds space to text to be able to fold it
                            // these spaces can be removed once the text is unfolded
                            return previousValue.slice(0, -1) + currentValue;
                        } else {
                            return previousValue + currentValue;
                        }
                    } else {
                        return previousValue + '\n' + currentValue;
                    }
                })
                // remove whitespace stuffing
                // http://tools.ietf.org/html/rfc3676#section-4.4
                .replace(/^ /gm, '')
        );
    }

    getTextContent() {
        if (!this.content) {
            return '';
        }

        let str = this.getDecoder(this.contentType.parsed.params.charset).decode(this.content);

        if (/^flowed$/i.test(this.contentType.parsed.params.format)) {
            str = this.decodeFlowedText(str, /^yes$/i.test(this.contentType.parsed.params.delsp));
        }

        return str;
    }

    processHeaders() {
        for (let i = this.headerLines.length - 1; i >= 0; i--) {
            let line = this.headerLines[i];
            if (i && /^\s/.test(line)) {
                this.headerLines[i - 1] += '\n' + line;
                this.headerLines.splice(i, 1);
            } else {
                // remove folding and extra WS
                line = line.replace(/\s+/g, ' ');
                let sep = line.indexOf(':');
                let key = sep < 0 ? line.trim() : line.substr(0, sep).trim();
                let value = sep < 0 ? '' : line.substr(sep + 1).trim();
                this.headers.push({ key: key.toLowerCase(), originalKey: key, value });

                switch (key.toLowerCase()) {
                    case 'content-type':
                        this.contentType = { value };
                        break;
                    case 'content-transfer-encoding':
                        this.contentTransferEncoding = { value };
                        break;
                    case 'content-disposition':
                        this.contentDisposition = { value };
                        break;
                }
            }
        }

        this.contentType.parsed = this.parseStructuredHeader(this.contentType.value);
        this.contentType.multipart = /^multipart\//i.test(this.contentType.parsed.value)
            ? this.contentType.parsed.value.substr(this.contentType.parsed.value.indexOf('/') + 1)
            : false;

        if (this.contentType.multipart && this.contentType.parsed.params.boundary) {
            // add self to boundary terminator listing
            this.parser.boundaries.push({
                value: this.contentType.parsed.params.boundary,
                node: this
            });
        }

        this.contentDisposition.parsed = this.parseStructuredHeader(this.contentDisposition.value);

        this.contentTransferEncoding.encoding = this.contentTransferEncoding.value
            .toLowerCase()
            .split(/[^\w-]/)
            .shift();

        this.setupContentDecoder(this.contentTransferEncoding.encoding);
    }

    feed(line) {
        switch (this.state) {
            case 'header':
                if (!line.length) {
                    this.state = 'body';
                    return this.processHeaders();
                }
                this.headerLines.push(this.getDecoder().decode(line));
                break;
            case 'body': {
                // add line to body
                this.contentDecoder.update(line);
            }
        }
    }
}

class MimeParser {
    constructor() {
        this.root = this.currentNode = new MimeNode({ parser: this });
        this.boundaries = [];
    }

    async finalize() {
        // close all pending nodes
        await this.root.finalize();
        console.log(this.root);
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

    readLine = () => {
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
    };

    async processNodeTree() {
        // get text nodes

        let textContent = {};

        let textTypes = new Set();
        let textMap = new Map();

        let walk = async (node, alternative) => {
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
                }
            } else if (node.contentType.multipart === 'alternative') {
                alternative = node;
            }

            for (let childNode of node.childNodes) {
                walk(childNode, alternative);
            }
        };

        walk(this.root);

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

        console.log(textContent);
    }

    convertTextToHtml(str) {
        let html = str
            .trim()
            .replace(/[<>"'?&]/g, c => {
                let hex = c.charCodeAt(0).toString(16);
                if (hex.length < 2) {
                    hex = '0' + hex;
                }
                return '&#' + hex + ';';
            })
            .replace(/\n/g, '<br />');
        return '<div>' + html + '</div>';
    }

    // TODO: convert HTML to plaintext
    convertHtmlToText(str) {
        //let plain = str.replace(//)
        return str;
    }

    generateTextNode(textType, mapEntry) {
        switch (textType) {
            case 'html':
                if (mapEntry.plain) {
                    return this.convertTextToHtml(mapEntry.plain);
                }
                break;
            case 'plain':
                if (mapEntry.html) {
                    return this.convertHtmlToText(mapEntry.html);
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

        return this.processNodeTree();
    }
}

const parseEmail = async buf => {
    const parser = new MimeParser();
    await parser.parse(buf);

    return 123;
};

onconnect = function (e) {
    var port = e.ports[0];

    port.onmessage = function (e) {
        parseEmail(e.data.content)
            .then(result => {
                port.postMessage({ result });
            })
            .catch(err => console.error(err));
    };
};
