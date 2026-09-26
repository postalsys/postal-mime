import { getDecoder, decodeParameterValueContinuations, textEncoder } from './decode-strings.js';
import type { StructuredHeader } from './decode-strings.js';
import PassThroughDecoder from './pass-through-decoder.js';
import Base64Decoder from './base64-decoder.js';
import QPDecoder from './qp-decoder.js';
import type PostalMime from './postal-mime.js';
import type { Email, Header, HeaderLine } from './types.js';

export interface MimeNodeOptions {
    postalMime: PostalMime;
    parentNode?: MimeNode | undefined;
    /** multipart subtype of the parent, decides the default content type of this part */
    parentMultipartType?: string | false | undefined;
    maxNestingDepth: number;
    maxHeadersSize: number;
}

type ContentDecoder = PassThroughDecoder | Base64Decoder | QPDecoder;

// Header lines are decoded with ignoreBOM so that a U+FEFF at the start of a line is
// kept as a character instead of being swallowed. A stripped BOM turns a line a strict
// parser skips into a genuine header, which is how a second `From:` gets smuggled past
// anything that inspects the raw message.
const headerDecoder = new TextDecoder('utf-8', { ignoreBOM: true });

// Trims only the whitespace RFC 5322 allows around a field name. String.prototype.trim
// also strips U+00A0, U+FEFF, U+2028 and the rest of the Unicode spaces, which turns a
// line that a strict parser rejects into a canonical field name: a `From:` line with a
// leading U+00A0 became a `from` header, and since the first occurrence of a header wins
// it outranked the real sender. Leaving the character in the key keeps the line visible
// without letting it collide with a genuine header.
//
// An index scan rather than `/^[ \t]+|[ \t]+$/g`, which retries the trailing branch at
// every position of a blank run that is followed by other text, so a single header with
// a long run of spaces in the middle took seconds to trim.
const isWsp = (c: number): boolean => c === 0x20 || c === 0x09;
const trimWsp = (str: string): string => {
    let start = 0;
    let end = str.length;
    while (start < end && isWsp(str.charCodeAt(start))) {
        start++;
    }
    while (end > start && isWsp(str.charCodeAt(end - 1))) {
        end--;
    }
    return str.slice(start, end);
};

// Headers that decide how this part's body is read, see processHeaders
const CONTENT_HEADERS = new Set([
    'content-type',
    'content-transfer-encoding',
    'content-disposition',
    'content-id',
    'content-description'
]);

export default class MimeNode {
    options: MimeNodeOptions;
    postalMime: PostalMime;
    childNodes: MimeNode[];
    finalizedChildCount: number;
    parentNode?: MimeNode | undefined;
    depth: number;
    state: 'header' | 'body' | 'finished';
    headerLines: string[];
    contentType: { value: string; parsed: StructuredHeader; multipart: string | false };
    contentTransferEncoding: { value: string; encoding: string };
    contentDisposition: { value: string; parsed: StructuredHeader };
    contentId?: string | undefined;
    contentDescription?: string | undefined;
    headers: Header[];
    rawHeaderLines: HeaderLine[];
    contentDecoder: ContentDecoder | null;
    /** decoded body, set by finalize() */
    content: ArrayBuffer | null;
    /** parsed inline message/rfc822 content, set by the parser */
    subMessage?: Email | undefined;

    constructor(options: MimeNodeOptions) {
        this.options = options;

        this.postalMime = options.postalMime;

        this.childNodes = [];
        // Cursor into childNodes for finalizeChildNodes. Every new part of a multipart
        // finalizes its parent's children, so re-walking the whole array each time is
        // quadratic in the number of parts.
        this.finalizedChildCount = 0;

        if (options.parentNode) {
            this.parentNode = options.parentNode;

            this.depth = this.parentNode.depth + 1;
            if (this.depth > options.maxNestingDepth) {
                throw new Error(`Maximum MIME nesting depth of ${options.maxNestingDepth} levels exceeded`);
            }

            options.parentNode.childNodes.push(this);
        } else {
            this.depth = 0;
        }

        this.state = 'header';

        this.headerLines = [];

        // RFC 2046 Section 5.1.5: multipart/digest defaults to message/rfc822
        const parentMultipartType = options.parentMultipartType || null;
        const defaultContentType = parentMultipartType === 'digest' ? 'message/rfc822' : 'text/plain';

        // The value is replaced by the first matching header and the rest is derived
        // from it, see the CONTENT_HEADERS pass in processHeaders
        this.contentType = {
            value: defaultContentType,
            parsed: { value: defaultContentType, params: {} },
            multipart: false
        };

        this.contentTransferEncoding = {
            value: '8bit',
            encoding: ''
        };

        this.contentDisposition = {
            value: '',
            parsed: { value: '', params: {} }
        };

        this.headers = [];
        this.rawHeaderLines = [];

        this.contentDecoder = null;
        this.content = null;
    }

    setupContentDecoder(transferEncoding: string): void {
        if (/base64/i.test(transferEncoding)) {
            this.contentDecoder = new Base64Decoder();
        } else if (/quoted-printable/i.test(transferEncoding)) {
            this.contentDecoder = new QPDecoder();
        } else {
            this.contentDecoder = new PassThroughDecoder();
        }
    }

    async finalize(): Promise<void> {
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
        this.contentDecoder = null;

        this.state = 'finished';
    }

    async finalizeChildNodes(): Promise<void> {
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
    stripComments(str: string): string {
        let result = '';
        let depth = 0;
        let escaped = false;
        let inQuote = false;
        // where the outermost comment opened, for the unbalanced case below
        let commentStart = -1;
        // A parameter value starts at `=` and ends at the `;` that begins the next one
        let inParameterValue = false;

        // Whether result ends in SP or HTAB. Kept up to date on every append, because
        // testing `/[ \t]$/` against result flattens the whole string on each `(` and is
        // quadratic in the length of the header.
        let endsWithWsp = false;
        const append = (c: string): void => {
            result += c;
            endsWithWsp = c === ' ' || c === '\t';
        };

        // A comment may only appear where linear whitespace is allowed, so inside a
        // parameter value the parenthesis has to follow whitespace to open one. Outside
        // one, eg. after the type itself, anything goes.
        const opensComment = (): boolean => !inParameterValue || !result.length || endsWithWsp;

        for (let i = 0; i < str.length; i++) {
            const chr = str.charAt(i);

            if (escaped) {
                if (depth === 0) {
                    append(chr);
                }
                escaped = false;
                continue;
            }

            if (chr === '\\') {
                escaped = true;
                if (depth === 0) {
                    append(chr);
                }
                continue;
            }

            if (chr === '"' && depth === 0) {
                inQuote = !inQuote;
                append(chr);
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
                append(chr);
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

    parseStructuredHeader(str: string): StructuredHeader {
        // Strip RFC 822 comments before parsing
        str = this.stripComments(str);

        let response: StructuredHeader = {
            value: '',
            params: {}
        };

        let key: string | false = false;
        let value = '';
        let stage: 'key' | 'value' = 'value';

        // Whitespace seen outside a quoted string is held back until a significant
        // character follows it, so surrounding whitespace can be dropped without
        // trimming spaces the sender quoted on purpose. Trimming the stored value
        // instead loses the trailing space in `filename*0="Annual Report "`, which the
        // next continuation section is meant to be appended to.
        let pendingSpace = '';
        let quoteClosed = false;

        let quote: string | false = false;
        let escaped = false;
        let chr: string;

        const addChr = (c: string): void => {
            if (value.length) {
                value += pendingSpace;
            }
            pendingSpace = '';
            value += c;
        };

        const takeValue = (): string => {
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
        const storeParam = (name: string, result: string): void => {
            if (!Object.prototype.hasOwnProperty.call(response.params, name)) {
                response.params[name] = result;
            }
        };

        const storeValue = (): void => {
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
        const storeEmptyKey = (): void => {
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

    decodeFlowedText(str: string, delSp: boolean): string {
        // Pieces of the result, joined once at the end. Growing a single string and
        // calling endsWith() on it for every line flattens the whole paragraph again on
        // each line, which is quadratic in the length of a paragraph.
        // Empty pieces are never stored, so the last piece always holds the last
        // character of the result.
        const parts: string[] = [];
        // The unfolded line being built, ie. everything after the last hard line break,
        // starts at this index of parts and is this many characters long
        let lineStart = 0;
        let lineLength = 0;

        const lines = str.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // remove whitespace stuffing before anything else
            // http://tools.ietf.org/html/rfc3676#section-4.4
            // doing it after the join leaves the stuffed space of a continuation line
            // sitting in the middle of the joined paragraph
            if (line.charAt(0) === ' ') {
                line = line.slice(1);
            }

            if (i) {
                const last = parts.length ? parts[parts.length - 1] : '';

                // soft linebreaks are added after space symbols, except for the signature
                // separator which is a line of its own
                const isSignature = lineLength === 3 && parts.slice(lineStart).join('') === '-- ';

                if (last.endsWith(' ') && !isSignature) {
                    if (delSp) {
                        // delsp adds space to text to be able to fold it
                        // these spaces can be removed once the text is unfolded
                        if (last.length > 1) {
                            parts[parts.length - 1] = last.slice(0, -1);
                        } else {
                            parts.pop();
                        }
                        lineLength--;
                    }
                } else {
                    parts.push('\n');
                    lineStart = parts.length;
                    lineLength = 0;
                }
            }

            if (line) {
                parts.push(line);
                lineLength += line.length;
            }
        }

        return parts.join('');
    }

    getTextContent(): string {
        if (!this.content) {
            return '';
        }

        let str = getDecoder(this.contentType.parsed.params.charset).decode(this.content);

        if (/^flowed$/i.test(this.contentType.parsed.params.format)) {
            str = this.decodeFlowedText(str, /^yes$/i.test(this.contentType.parsed.params.delsp));
        }

        return str;
    }

    processHeaders(): void {
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
        let foldedLines: string[][] = [];
        for (let line of this.headerLines) {
            if (foldedLines.length && /^[ \t]/.test(line)) {
                foldedLines[foldedLines.length - 1].push(line);
            } else {
                foldedLines.push([line]);
            }
        }

        let seenContentHeaders = new Set<string>();

        // Second pass: process headers in document order
        for (let parts of foldedLines) {
            let rawLine = parts.join('\n');

            // Extract key from raw line for rawHeaderLines
            let sep = rawLine.indexOf(':');
            let rawKey = trimWsp(sep < 0 ? rawLine : rawLine.slice(0, sep));

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
            let key = trimWsp(sep < 0 ? unfoldedLine : unfoldedLine.slice(0, sep));
            // A bare CR is not legal in a field body. It used to be folded into a space by
            // the whitespace collapse, and passing it through would hand consumers that
            // write the value back out a line of their own.
            let value = sep < 0 ? '' : trimWsp(unfoldedLine.slice(sep + 1).replace(/[\r\n]+/g, ' '));
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
                        this.contentType.value = value;
                        break;
                    case 'content-transfer-encoding':
                        this.contentTransferEncoding.value = value;
                        break;
                    case 'content-disposition':
                        this.contentDisposition.value = value;
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
            ? this.contentType.parsed.value.slice(this.contentType.parsed.value.indexOf('/') + 1)
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

    feed(line: Uint8Array<ArrayBuffer>): void {
        switch (this.state) {
            case 'header':
                if (!line.length) {
                    this.state = 'body';
                    this.processHeaders();
                    return;
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
            case 'body':
                // add line to body. processHeaders installs a decoder before the state
                // becomes body, and the only time the decoder is released is finalize,
                // which moves the state on to finished, so the guard only narrows the type
                if (this.contentDecoder) {
                    this.contentDecoder.update(line);
                }
                break;
        }
    }
}
