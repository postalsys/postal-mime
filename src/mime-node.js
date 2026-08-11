import { getDecoder, decodeParameterValueContinuations, textEncoder } from './decode-strings.js';
import PassThroughDecoder from './pass-through-decoder.js';
import Base64Decoder from './base64-decoder.js';
import QPDecoder from './qp-decoder.js';

// Header lines are decoded with ignoreBOM so that a U+FEFF at the start of a line is
// kept as a character instead of being swallowed. A stripped BOM turns a line a strict
// parser skips into a genuine header, which is how a second `From:` gets smuggled past
// anything that inspects the raw message.
const headerDecoder = new TextDecoder('utf-8', { ignoreBOM: true });

// Trims only the whitespace RFC 5322 allows around a field name. String.prototype.trim
// also strips U+00A0, U+FEFF, U+2028 and the rest of the Unicode spaces, which turns a
// line that a strict parser rejects into a canonical field name: ` From:` became a
// `from` header, and since the first occurrence of a header wins it outranked the real
// sender. Leaving the character in the key keeps the line visible without letting it
// collide with a genuine header.
const trimWsp = str => str.replace(/^[ \t]+|[ \t]+$/g, '');

// Headers that decide how this part's body is read, see processHeaders
const CONTENT_HEADERS = new Set([
    'content-type',
    'content-transfer-encoding',
    'content-disposition',
    'content-id',
    'content-description'
]);

export default class MimeNode {
    constructor(options) {
        this.options = options || {};

        this.postalMime = this.options.postalMime;

        this.childNodes = [];
        // Cursor into childNodes for finalizeChildNodes. Every new part of a multipart
        // finalizes its parent's children, so re-walking the whole array each time is
        // quadratic in the number of parts.
        this.finalizedChildCount = 0;

        if (this.options.parentNode) {
            this.parentNode = this.options.parentNode;

            this.depth = this.parentNode.depth + 1;
            if (this.depth > this.options.maxNestingDepth) {
                throw new Error(`Maximum MIME nesting depth of ${this.options.maxNestingDepth} levels exceeded`);
            }

            this.options.parentNode.childNodes.push(this);
        } else {
            this.depth = 0;
        }

        this.state = 'header';

        this.headerLines = [];

        // RFC 2046 Section 5.1.5: multipart/digest defaults to message/rfc822
        const parentMultipartType = this.options.parentMultipartType || null;
        const defaultContentType = parentMultipartType === 'digest' ? 'message/rfc822' : 'text/plain';

        // Replaced by the first matching header, see the CONTENT_HEADERS pass in
        // processHeaders
        this.contentType = {
            value: defaultContentType
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

    setupContentDecoder(transferEncoding) {
        if (/base64/i.test(transferEncoding)) {
            this.contentDecoder = new Base64Decoder();
        } else if (/quoted-printable/i.test(transferEncoding)) {
            this.contentDecoder = new QPDecoder();
        } else {
            this.contentDecoder = new PassThroughDecoder();
        }
    }

    async finalize() {
        if (this.state === 'finished') {
            return;
        }

        if (this.state === 'header') {
            this.processHeaders();
        }

        // remove self from boundary listing
        let boundaries = this.postalMime.boundaries;
        for (let i = boundaries.length - 1; i >= 0; i--) {
            let boundary = boundaries[i];
            if (boundary.node === this) {
                boundaries.splice(i, 1);
                break;
            }
        }

        await this.finalizeChildNodes();

        this.content = this.contentDecoder ? await this.contentDecoder.finalize() : null;

        // The decoder buffers every body line it received, so keeping it around
        // retains a second copy of the content for the lifetime of the node.
        // Nothing reads it once the node is finished, so release it here.
        this.contentDecoder = false;

        this.state = 'finished';
    }

    async finalizeChildNodes() {
        // Children are only ever appended, so everything before the cursor is already
        // finished and re-visiting it only costs time.
        while (this.finalizedChildCount < this.childNodes.length) {
            await this.childNodes[this.finalizedChildCount++].finalize();
        }
    }

    // Strip RFC 822 comments (parenthesized text) from structured header values.
    //
    // Inside an unquoted parameter value a parenthesis that continues the current token is
    // content, because `filename=Invoice(1).pdf` is a filename and not a token followed by
    // a comment, and deleting the parens silently renames the attachment.
    stripComments(str) {
        let result = '';
        let depth = 0;
        let escaped = false;
        let inQuote = false;
        // where the outermost comment opened, for the unbalanced case below
        let commentStart = -1;
        // A parameter value starts at `=` and ends at the `;` that begins the next one
        let inParameterValue = false;

        // A comment may only appear where linear whitespace is allowed, so inside a
        // parameter value the parenthesis has to follow whitespace to open one. Outside
        // one, eg. after the type itself, anything goes.
        const opensComment = () => !inParameterValue || !result.length || /[ \t]$/.test(result);

        for (let i = 0; i < str.length; i++) {
            const chr = str.charAt(i);

            if (escaped) {
                if (depth === 0) {
                    result += chr;
                }
                escaped = false;
                continue;
            }

            if (chr === '\\') {
                escaped = true;
                if (depth === 0) {
                    result += chr;
                }
                continue;
            }

            if (chr === '"' && depth === 0) {
                inQuote = !inQuote;
                result += chr;
                continue;
            }

            if (!inQuote) {
                if (chr === '(' && opensComment()) {
                    if (depth === 0) {
                        commentStart = i;
                    }
                    depth++;
                    continue;
                }
                if (chr === ')' && depth > 0) {
                    depth--;
                    continue;
                }
                if (depth === 0) {
                    if (chr === '=') {
                        inParameterValue = true;
                    } else if (chr === ';') {
                        inParameterValue = false;
                    }
                }
            }

            if (depth === 0) {
                result += chr;
            }
        }

        if (depth === 0) {
            return result;
        }

        // An unbalanced `(` is not a comment. Dropping everything after it would take any
        // parameter that follows with it, including the boundary that holds the message
        // together, so the dangling text is only discarded when nothing follows it.
        return str.indexOf(';', commentStart) < 0 ? result : str;
    }

    parseStructuredHeader(str) {
        // Strip RFC 822 comments before parsing
        str = this.stripComments(str);

        let response = {
            value: false,
            params: {}
        };

        let key = false;
        let value = '';
        let stage = 'value';

        // Whitespace seen outside a quoted string is held back until a significant
        // character follows it, so surrounding whitespace can be dropped without
        // trimming spaces the sender quoted on purpose. Trimming the stored value
        // instead loses the trailing space in `filename*0="Annual Report "`, which the
        // next continuation section is meant to be appended to.
        let pendingSpace = '';
        let quoteClosed = false;

        let quote = false;
        let escaped = false;
        let chr;

        const addChr = c => {
            if (value.length) {
                value += pendingSpace;
            }
            pendingSpace = '';
            value += c;
        };

        const takeValue = () => {
            const result = value;
            value = '';
            pendingSpace = '';
            quoteClosed = false;
            return result;
        };

        // A duplicated parameter resolves to its first occurrence, matching how duplicated
        // headers are resolved. Letting the last one win means `boundary="b"; boundary="c"`
        // registers a boundary that no delimiter in the message matches, which drops the
        // body without an error. hasOwnProperty, because a parameter may be named
        // `constructor` or `toString`.
        const storeParam = (name, result) => {
            if (!Object.prototype.hasOwnProperty.call(response.params, name)) {
                response.params[name] = result;
            }
        };

        const storeValue = () => {
            const result = takeValue();
            if (key === false) {
                response.value = result;
            } else {
                storeParam(key, result);
            }
        };

        // A parameter name with no `=` is a valueless parameter, not the start of the
        // next one. Without this the name would keep growing across the `;` and swallow
        // whatever followed, which is how `x=1; flag; boundary="AAA"` loses its boundary.
        const storeEmptyKey = () => {
            const name = takeValue().trim();
            if (name) {
                storeParam(name.toLowerCase(), '');
            }
        };

        for (let i = 0, len = str.length; i < len; i++) {
            chr = str.charAt(i);
            switch (stage) {
                case 'key':
                    if (chr === '=') {
                        key = takeValue().trim().toLowerCase();
                        stage = 'value';
                        break;
                    }
                    if (chr === ';') {
                        storeEmptyKey();
                        break;
                    }
                    value += chr;
                    break;
                case 'value':
                    if (escaped) {
                        addChr(chr);
                    } else if (quote && chr === '\\') {
                        // backslash only escapes inside a quoted string, everywhere else
                        // it is an ordinary character. Treating it as an escape turns
                        // `filename=C:\Users\me\a.txt` into `C:Usersmea.txt`.
                        escaped = true;
                        continue;
                    } else if (quote && chr === quote) {
                        quote = false;
                        quoteClosed = true;
                    } else if (!quote && chr === '"') {
                        quote = chr;
                        // whitespace before a quote that opens the value is padding, but
                        // between a token and a quoted string it is content
                        if (value.length) {
                            value += pendingSpace;
                        }
                        pendingSpace = '';
                    } else if (!quote && chr === ';') {
                        storeValue();
                        stage = 'key';
                    } else if (!quote && (chr === ' ' || chr === '\t')) {
                        pendingSpace += chr;
                    } else if (!quoteClosed) {
                        addChr(chr);
                    }
                    // Anything else is trailing junk after a closed quoted string. RFC 2045
                    // says a parameter value is a token or a quoted string, not both, and
                    // appending the junk is how `boundary="AAA" (unterminated comment`
                    // turned into a boundary that no delimiter in the message matches.
                    escaped = false;
                    break;
            }
        }

        // finalize remainder
        if (stage === 'value') {
            storeValue();
        } else {
            // treat as key without value, see emptykey:
            // Header-Key: somevalue; key=value; emptykey
            storeEmptyKey();
        }

        if (response.value) {
            response.value = response.value.toLowerCase();
        }

        // convert Parameter Value Continuations into single strings
        decodeParameterValueContinuations(response);

        return response;
    }

    decodeFlowedText(str, delSp) {
        return (
            str
                .split(/\r?\n/)
                // remove whitespace stuffing before anything else
                // http://tools.ietf.org/html/rfc3676#section-4.4
                // doing it after the join leaves the stuffed space of a continuation line
                // sitting in the middle of the joined paragraph
                .map(line => (line.charAt(0) === ' ' ? line.slice(1) : line))
                // remove soft linebreaks
                // soft linebreaks are added after space symbols
                .reduce((previousValue, currentValue) => {
                    if (previousValue.endsWith(' ') && previousValue !== '-- ' && !previousValue.endsWith('\n-- ')) {
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
        );
    }

    getTextContent() {
        if (!this.content) {
            return '';
        }

        let str = getDecoder(this.contentType.parsed.params.charset).decode(this.content);

        if (/^flowed$/i.test(this.contentType.parsed.params.format)) {
            str = this.decodeFlowedText(str, /^yes$/i.test(this.contentType.parsed.params.delsp));
        }

        return str;
    }

    processHeaders() {
        // First pass: group folded continuation lines with the header they belong to.
        //
        // Only SP and HTAB continue a header (RFC 5322 3.2.2 WSP). JS `\s` also matches
        // NBSP, vertical tab, form feed and U+2028, so a line starting with one of those
        // used to be absorbed into the header above it and disappear from both `headers`
        // and `headerLines` while a strict parser still sees it as a header of its own.
        //
        // Collecting into an array and joining once keeps this linear. Appending onto the
        // previous string in a backward pass re-scans the joined value on every line,
        // which is quadratic in the number of folds and lets a message that fits inside
        // maxHeadersSize burn seconds of CPU.
        let foldedLines = [];
        for (let line of this.headerLines) {
            if (foldedLines.length && /^[ \t]/.test(line)) {
                foldedLines[foldedLines.length - 1].push(line);
            } else {
                foldedLines.push([line]);
            }
        }

        // Initialize rawHeaderLines to store unmodified lines
        this.rawHeaderLines = [];

        let seenContentHeaders = new Set();

        // Second pass: process headers in document order
        for (let parts of foldedLines) {
            let rawLine = parts.join('\n');

            // Extract key from raw line for rawHeaderLines
            let sep = rawLine.indexOf(':');
            let rawKey = trimWsp(sep < 0 ? rawLine : rawLine.substr(0, sep));

            // Store raw line with lowercase key
            this.rawHeaderLines.push({
                key: rawKey.toLowerCase(),
                line: rawLine
            });

            // Unfolding removes the line break and keeps the folding whitespace, so
            // `Subject: Hello\r\n    World` stays `Hello    World`. Collapsing every
            // whitespace run instead also rewrote boundary values and filenames, and it
            // replaced the non-ASCII spaces that raw UTF-8 headers (RFC 6532) may carry.
            let unfoldedLine = parts.join('');
            sep = unfoldedLine.indexOf(':');
            let key = trimWsp(sep < 0 ? unfoldedLine : unfoldedLine.substr(0, sep));
            // A bare CR is not legal in a field body. It used to be folded into a space by
            // the whitespace collapse, and passing it through would hand consumers that
            // write the value back out a line of their own.
            let value = sep < 0 ? '' : trimWsp(unfoldedLine.substr(sep + 1).replace(/[\r\n]+/g, ' '));
            this.headers.push({ key: key.toLowerCase(), originalKey: key, value });

            // A header that decides how the body is read must resolve the same way every
            // time it is duplicated, otherwise a message can present one Content-Type to a
            // scanner and a different one here. Every one of these takes the first
            // occurrence and later copies are ignored.
            const lowerKey = key.toLowerCase();
            if (CONTENT_HEADERS.has(lowerKey) && !seenContentHeaders.has(lowerKey)) {
                seenContentHeaders.add(lowerKey);

                switch (lowerKey) {
                    case 'content-type':
                        this.contentType = { value, parsed: {} };
                        break;
                    case 'content-transfer-encoding':
                        this.contentTransferEncoding = { value, parsed: {} };
                        break;
                    case 'content-disposition':
                        this.contentDisposition = { value, parsed: {} };
                        break;
                    case 'content-id':
                        this.contentId = value;
                        break;
                    case 'content-description':
                        this.contentDescription = value;
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
            this.postalMime.boundaries.push({
                value: textEncoder.encode(this.contentType.parsed.params.boundary),
                node: this
            });
        }

        this.contentDisposition.parsed = this.parseStructuredHeader(this.contentDisposition.value);

        // Take the first token rather than splitting on the first non-token character.
        // `split()` returns an empty string for anything that does not start with a word
        // character, so `(comment) base64` and `"base64"` used to fall through to the
        // pass-through decoder and hand the caller undecoded base64 as the message body.
        this.contentTransferEncoding.encoding = (this.stripComments(this.contentTransferEncoding.value)
            .toLowerCase()
            .match(/[\w-]+/) || [''])[0];

        this.setupContentDecoder(this.contentTransferEncoding.encoding);
    }

    feed(line) {
        switch (this.state) {
            case 'header':
                if (!line.length) {
                    this.state = 'body';
                    return this.processHeaders();
                }

                // Counted across the whole message, not per part. A per-node budget lets a
                // multipart carry the limit again for every part it declares, so a message
                // many times over the limit still parses.
                this.postalMime.headerSize += line.length;

                if (this.postalMime.headerSize > this.options.maxHeadersSize) {
                    let error = new Error(`Maximum header size of ${this.options.maxHeadersSize} bytes exceeded`);
                    throw error;
                }

                this.headerLines.push(headerDecoder.decode(line));
                break;
            case 'body': {
                // add line to body
                this.contentDecoder.update(line);
            }
        }
    }
}
