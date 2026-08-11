export const textEncoder = new TextEncoder();

const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Use a lookup table to find the index.
const base64Lookup = new Uint8Array(256);
for (let i = 0; i < base64Chars.length; i++) {
    base64Lookup[base64Chars.charCodeAt(i)] = i;
}

export function decodeBase64(base64) {
    // Padding carries no data, so the byte count comes from the payload alone. Sizing the
    // buffer from the raw length instead treated '=' as a data character and left the
    // output padded with NUL bytes, which then travelled into subjects and filenames.
    let len = base64.length;
    while (len > 0 && base64.charAt(len - 1) === '=') {
        len--;
    }

    // A remainder of one character cannot encode a byte, it is a truncated group
    if (len % 4 === 1) {
        len--;
    }

    const remainder = len % 4;
    const bufferLength = Math.floor(len / 4) * 3 + (remainder ? remainder - 1 : 0);

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const bytes = new Uint8Array(arrayBuffer);

    let p = 0;

    for (let i = 0; i < len; i += 4) {
        let encoded1 = base64Lookup[base64.charCodeAt(i)];
        let encoded2 = base64Lookup[base64.charCodeAt(i + 1)];
        let encoded3 = base64Lookup[base64.charCodeAt(i + 2)];
        let encoded4 = base64Lookup[base64.charCodeAt(i + 3)];

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (p < bufferLength) {
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        }
        if (p < bufferLength) {
            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }
    }

    return arrayBuffer;
}

// Charset labels the WHATWG Encoding Standard does not list, but that name an encoding
// TextDecoder can decode. Without an entry the TextDecoder constructor throws and
// getDecoder falls back to windows-1252, turning the body into mojibake with nothing to
// signal that the wrong decoder was used.
//
// Keys are normalized (see normalizeCharset), so one entry covers every spelling of a
// label, eg. `eucjp` also catches `euc_jp`, `x-eucjp` and `x-euc-jp`. Only labels that
// need real encoding knowledge belong here; anything that differs from a supported
// label by nothing but an `x-` prefix or a separator is handled by normalization alone.
const charsetAliases = new Map([
    // Hebrew. The logical and explicit ordering variants share the iso-8859-8 index.
    ['iso88598i', 'iso-8859-8'],
    ['iso88598e', 'iso-8859-8'],

    // Japanese. WHATWG shift_jis is the Windows-31J index, so cp932 text decodes
    // identically, including the NEC and IBM extension rows.
    ['shiftjis', 'shift_jis'],
    ['windows31j', 'shift_jis'],
    ['mskanji', 'shift_jis'],
    ['eucjp', 'euc-jp'],

    // ISO-2022-JP, including the -1 / -2 supersets. Escape sequences outside plain
    // ISO-2022-JP (JIS X 0212, the non-Japanese G2 sets, and the SO/SI katakana shifts
    // cp50222 uses) decode to replacement characters, but the Japanese text around them
    // still comes out right.
    ['iso2022jp', 'iso-2022-jp'],
    ['iso2022jp1', 'iso-2022-jp'],
    ['iso2022jp2', 'iso-2022-jp'],
    ['junet', 'iso-2022-jp'],

    // Korean. The WHATWG euc-kr index is the extended cp949 / UHC index.
    ['euckr', 'euc-kr'],
    ['uhc', 'euc-kr'],

    // Thai.
    ['tis620', 'windows-874']
]);

// Windows and IBM code page numbers, as written in labels like cp932, windows-932, ms932
// or ibm932. An explicit allowlist rather than a derived one, because plenty of code
// pages that appear in mail (cp437, cp850, cp1361) have no equivalent to map onto and
// have to keep falling back.
const codePageAliases = new Map([
    ['932', 'shift_jis'],
    ['936', 'gbk'],
    ['949', 'euc-kr'],
    ['950', 'big5'],
    ['874', 'windows-874'],
    // Microsoft's EUC-JP and ISO-2022-JP variants. euc-jp and iso-2022-jp cover
    // everything they can express.
    ['51932', 'euc-jp'],
    ['50220', 'iso-2022-jp'],
    ['50221', 'iso-2022-jp'],
    ['50222', 'iso-2022-jp']
]);

const codePagePattern = /^(?:cp|windows|ms|ibm)(\d+)$/;

// Strip the decorations mail clients add to an otherwise standard label: an x- vendor
// prefix, the IANA cs- prefix, and any separators.
function normalizeCharset(charset) {
    return charset.replace(/^(?:x-ms-|x-|cs)/, '').replace(/[\s._-]+/g, '');
}

function tryDecoder(charset) {
    try {
        return new TextDecoder(charset);
    } catch (err) {
        return null;
    }
}

export function getDecoder(charset) {
    charset = (charset || 'utf8').trim().toLowerCase();

    // Try the label as written first, so the alias table only ever adds to what the
    // runtime already supports instead of shadowing it.
    const decoder = tryDecoder(charset);
    if (decoder) {
        return decoder;
    }

    const normalized = normalizeCharset(charset);
    const codePage = normalized.match(codePagePattern);

    // The normalized label is itself the last candidate, which resolves everything that
    // differed from a supported label only by a prefix or a separator, eg. x-big5.
    const alias = (codePage && codePageAliases.get(codePage[1])) || charsetAliases.get(normalized) || normalized;

    return tryDecoder(alias) || new TextDecoder('windows-1252');
}

/**
 * Converts a Blob into an ArrayBuffer
 * @param {Blob} blob Blob to convert
 * @returns {ArrayBuffer} Converted value
 */
export async function blobToArrayBuffer(blob) {
    if ('arrayBuffer' in blob) {
        return await blob.arrayBuffer();
    }

    const fr = new FileReader();

    return new Promise((resolve, reject) => {
        fr.onload = function (e) {
            resolve(e.target.result);
        };

        fr.onerror = function (e) {
            reject(fr.error);
        };

        fr.readAsArrayBuffer(blob);
    });
}

/**
 * Numeric value of an ASCII hex digit
 *
 * @param {Number} c Byte to read
 * @return {Number} Value 0-15, or -1 if the byte is not a hex digit
 */
export function hexNibble(c) {
    if (c >= 0x30 /* 0 */ && c <= 0x39 /* 9 */) {
        return c - 0x30;
    }
    if (c >= 0x61 /* a */ && c <= 0x66 /* f */) {
        return c - 0x61 + 10;
    }
    if (c >= 0x41 /* A */ && c <= 0x46 /* F */) {
        return c - 0x41 + 10;
    }
    return -1;
}

export function getHex(c) {
    return hexNibble(c) < 0 ? false : String.fromCharCode(c);
}

/**
 * Decode a complete mime word encoded string
 *
 * @param {String} str Mime word encoded string
 * @return {String} Decoded unicode string
 */
export function decodeWord(charset, encoding, str) {
    // RFC2231 added language tag to the encoding
    // see: https://tools.ietf.org/html/rfc2231#section-5
    // this implementation silently ignores this tag
    let splitPos = charset.indexOf('*');
    if (splitPos >= 0) {
        charset = charset.substr(0, splitPos);
    }

    encoding = encoding.toUpperCase();

    let byteStr;

    if (encoding === 'Q') {
        str = str
            // remove spaces between = and hex char, this might indicate invalidly applied line splitting
            .replace(/=\s+([0-9a-fA-F])/g, '=$1')
            // convert all underscores to spaces
            .replace(/[_\s]/g, ' ');

        let buf = textEncoder.encode(str);
        let encodedBytes = [];
        for (let i = 0, len = buf.length; i < len; i++) {
            let c = buf[i];
            if (i <= len - 2 && c === 0x3d /* = */) {
                let high = hexNibble(buf[i + 1]);
                let low = hexNibble(buf[i + 2]);
                if (high >= 0 && low >= 0) {
                    encodedBytes.push((high << 4) | low);
                    i += 2;
                    continue;
                }
            }
            encodedBytes.push(c);
        }
        byteStr = new ArrayBuffer(encodedBytes.length);
        let dataView = new DataView(byteStr);
        for (let i = 0, len = encodedBytes.length; i < len; i++) {
            dataView.setUint8(i, encodedBytes[i]);
        }
    } else if (encoding === 'B') {
        byteStr = decodeBase64(str.replace(/[^a-zA-Z0-9\+\/=]+/g, ''));
    } else {
        // keep as is, convert ArrayBuffer to unicode string, assume utf8
        byteStr = textEncoder.encode(str);
    }

    return getDecoder(charset).decode(byteStr);
}

// A charset label runs to the next '?' so that labels containing punctuation, eg.
// ISO_8859-1:1987, are recognised. Whitespace is excluded so a stray '=?' in running text
// can not swallow the rest of the line.
const ENCODED_WORD_PATTERN = '=\\?([^?\\s]+)\\?([QqBb])\\?([^?]*)\\?=';
const ENCODED_WORD_REGEX = new RegExp(ENCODED_WORD_PATTERN, 'g');

// Only linear whitespace separates encoded words, the rest is content
const WORD_SEPARATOR_REGEX = /^[ \t\r\n]+$/;

const ENCODED_WORDS_ONLY_REGEX = new RegExp(`^(?:${ENCODED_WORD_PATTERN}\\s*)+$`);

/**
 * Checks whether a string is nothing but RFC 2047 encoded words. Kept next to the grammar
 * it depends on, so the pattern has a single definition.
 *
 * @param {String} str String to check
 * @return {Boolean} true if the string holds encoded words and nothing else
 */
export function isEncodedWordsOnly(str) {
    return ENCODED_WORDS_ONLY_REGEX.test(str);
}

/**
 * Splits a string into encoded words and the literal text around them.
 *
 * Working on a token list rather than marking joinable words with an in band sentinel
 * means the input can not contain the marker, which previously let a sender delete text
 * from a subject or a display name by writing the marker into the header themselves.
 *
 * @param {String} str String to split
 * @return {Array} Array of `{text}` and `{charset, encoding, encodedText}` tokens
 */
function splitEncodedWords(str) {
    const tokens = [];

    ENCODED_WORD_REGEX.lastIndex = 0;

    let pos = 0;
    let match;

    while ((match = ENCODED_WORD_REGEX.exec(str))) {
        if (match.index > pos) {
            tokens.push({ text: str.substring(pos, match.index) });
        }
        tokens.push({ charset: match[1], encoding: match[2], encodedText: match[3] });
        pos = match.index + match[0].length;
    }

    if (pos < str.length) {
        tokens.push({ text: str.substring(pos) });
    }

    return tokens;
}

/**
 * Checks if two adjacent encoded words may be decoded as a single unit. A multi byte
 * character is often split across two words, so the bytes have to be concatenated before
 * they are decoded. Base64 additionally needs the left chunk to end on a group boundary,
 * otherwise the concatenation shifts every byte that follows.
 */
function canJoinWords(left, right) {
    const encoding = left.encoding.toUpperCase();

    if (left.charset !== right.charset || encoding !== right.encoding.toUpperCase()) {
        return false;
    }

    if (encoding === 'B') {
        return left.encodedText.length % 4 === 0 && !/=$/.test(left.encodedText);
    }

    return true;
}

/**
 * Decodes a token list into a string, optionally merging adjacent encoded words.
 *
 * @param {Array} tokens Tokens from splitEncodedWords
 * @param {Boolean} joinWords Whether adjacent encoded words may be decoded as one unit
 * @return {String} Decoded string
 */
function renderTokens(tokens, joinWords) {
    let result = '';
    let pending = null;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.text !== undefined) {
            // whitespace between two encoded words is a folding artifact, not content
            const nextToken = tokens[i + 1];
            if (pending && nextToken && nextToken.text === undefined && WORD_SEPARATOR_REGEX.test(token.text)) {
                continue;
            }
            if (pending) {
                result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
                pending = null;
            }
            result += token.text;
            continue;
        }

        if (pending && joinWords && canJoinWords(pending, token)) {
            pending.encodedText += token.encodedText;
            continue;
        }

        if (pending) {
            result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
        }
        pending = { charset: token.charset, encoding: token.encoding, encodedText: token.encodedText };
    }

    if (pending) {
        result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
    }

    return result;
}

export function decodeWords(str) {
    const tokens = splitEncodedWords((str || '').toString());

    const result = renderTokens(tokens, true);

    // A replacement character means the bytes did not decode, which happens when two
    // words were joined that should have stayed apart. Retry keeping them separate.
    return result.indexOf('\ufffd') < 0 ? result : renderTokens(tokens, false);
}

export function decodeURIComponentWithCharset(encodedStr, charset) {
    charset = charset || 'utf-8';

    let encodedBytes = [];
    for (let i = 0; i < encodedStr.length; i++) {
        let c = encodedStr.charAt(i);
        if (c === '%' && /^[a-f0-9]{2}/i.test(encodedStr.substr(i + 1, 2))) {
            // encoded sequence
            let byte = encodedStr.substr(i + 1, 2);
            i += 2;
            encodedBytes.push(parseInt(byte, 16));
        } else if (c.charCodeAt(0) > 126) {
            c = textEncoder.encode(c);
            for (let j = 0; j < c.length; j++) {
                encodedBytes.push(c[j]);
            }
        } else {
            // "normal" char
            encodedBytes.push(c.charCodeAt(0));
        }
    }

    const byteStr = new ArrayBuffer(encodedBytes.length);
    const dataView = new DataView(byteStr);
    for (let i = 0, len = encodedBytes.length; i < len; i++) {
        dataView.setUint8(i, encodedBytes[i]);
    }

    return getDecoder(charset).decode(byteStr);
}

export function decodeParameterValueContinuations(header) {
    // handle parameter value continuations
    // https://tools.ietf.org/html/rfc2231#section-3

    // preprocess values
    let paramKeys = new Map();

    Object.keys(header.params).forEach(key => {
        let match = key.match(/\*((\d+)\*?)?$/);
        if (!match) {
            // nothing to do here, does not seem like a continuation param
            return;
        }

        let actualKey = key.substr(0, match.index).toLowerCase();
        let nr = Number(match[2]) || 0;

        let paramVal;
        if (!paramKeys.has(actualKey)) {
            paramVal = {
                charset: false,
                values: []
            };
            paramKeys.set(actualKey, paramVal);
        } else {
            paramVal = paramKeys.get(actualKey);
        }

        let value = header.params[key];
        // RFC 2231 section 4.1: only a section whose name ends in '*' is percent encoded.
        // A plain `name*0=` section is literal text, so decoding it invents characters
        // that never appeared on the wire, turning `a%2F..%2Fetc` into a path traversal.
        let encoded = match[0].charAt(match[0].length - 1) === '*';

        if (nr === 0 && encoded && (match = value.match(/^([^']*)'[^']*'(.*)$/))) {
            paramVal.charset = match[1] || 'utf-8';
            value = match[2];
        }

        paramVal.values.push({ nr, value, encoded });

        // remove the old reference
        delete header.params[key];
    });

    paramKeys.forEach((paramVal, key) => {
        let result = '';
        // Adjacent encoded sections are decoded together, because a single multi byte
        // character may be percent encoded across a section boundary.
        let pending = '';

        for (let part of paramVal.values.sort((a, b) => a.nr - b.nr)) {
            if (part.encoded) {
                pending += part.value;
                continue;
            }
            if (pending) {
                result += decodeURIComponentWithCharset(pending, paramVal.charset);
                pending = '';
            }
            result += part.value;
        }

        if (pending) {
            result += decodeURIComponentWithCharset(pending, paramVal.charset);
        }

        header.params[key] = result;
    });
}
