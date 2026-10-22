// The input shapes test/scaling-test.ts measures, one for every way the cost of parsing a
// message could grow faster than the message. Not a test file itself, the test script
// only picks up `*-test.ts`.

export interface Shape {
    name: string;
    /** a message of `n` units of the shape */
    build: (n: number) => string;
    /** a count of units to measure the bytes of one at */
    size: number;
    /** the most units the default limits allow, for a shape that one of them bounds */
    max?: number;
}

// Every shape is parsed at a message of about this many bytes, or of `max` units, and at
// a quarter of that: a cost that follows the input grows four times, a quadratic one
// sixteen times. The header shapes stay under maxHeadersSize at this size.
export const TARGET_BYTES = 1.5 * 1024 * 1024;
export const GROWTH = 4;
// How much more the larger parse may cost than its size predicts from the smaller one:
// well above what a linear parse measures, which the garbage collector and the caches
// take to five or six on the shapes that allocate the most, and well below the sixteen
// of a quadratic one. A parse under NOISE_MS at the larger size is timer noise either
// way, and cheap however it grows.
export const MAX_RATIO = 10;
export const NOISE_MS = 10;
export const followsTheInput = (smallMs: number, smallBytes: number, largeMs: number, largeBytes: number): boolean =>
    largeMs < NOISE_MS || largeMs / smallMs < (MAX_RATIO * largeBytes) / (GROWTH * smallBytes);

// The heap the process parsing the shapes may use. The input is held as a string and as
// bytes, the output can be as large again, and the parser has its working set on top. The
// address parser used to be the largest at some 200 times the input, a token object for
// every byte of a list of one letter names and a copy of the tokens of every address, and
// needed 384MB here. It now keeps its tokens as offsets in one typed array and the shapes
// parse in about 64MB, so the limit leaves them twice that. A shape that holds more per
// byte, as a header of one byte lines or a multipart of empty parts did before their limits,
// runs out of it.
export const HEAP_MB = 128;

const headers = (lines: string[]): string => lines.join('\r\n') + '\r\n\r\n';
const subject = (value: string): string => headers(['From: a@b', 'Subject: ' + value]) + 'x';
const to = (value: string): string => headers(['From: a@b', 'To: ' + value]) + 'x';
const body = (type: string, content: string): string => headers(['From: a@b', 'Content-Type: ' + type]) + content;
const mixed = (parts: string[]): string =>
    headers(['From: a@b', 'Content-Type: multipart/mixed; boundary=b']) +
    parts.map(part => '--b\r\n' + part + '\r\n').join('') +
    '--b--\r\n';
// the text/plain sibling makes the parser derive text from the html part
const html = (content: string): string =>
    mixed([headers(['Content-Type: text/plain']) + 'plain', headers(['Content-Type: text/html']) + content]);
const forward = (message: string): string => headers(['From: a@b', 'Content-Type: message/rfc822']) + message;
const repeat = (count: number, piece: (i: number) => string): string =>
    Array.from({ length: count }, (_, i) => piece(i)).join('');

// every header line counts for at least 64 bytes of maxHeadersSize, see HEADER_LINE_MIN_COST
const MAX_HEADER_LINES = 32000;
// the root part and the parts of every forwarded message count against maxPartCount
const MAX_PARTS = 9990;
const MAX_FORWARDS = 4990;
const MAX_FORWARDED_ADDRESSES = 9990;

export const SHAPES: Shape[] = [
    // encoded words
    { name: 'joinable base64 encoded words', size: 1000, build: n => subject('=?utf-8?B?QUJD?= '.repeat(n)) },
    {
        name: 'base64 encoded words that decode to invalid UTF-8',
        size: 1000,
        build: n => subject('=?utf-8?B?gICA?= '.repeat(n))
    },
    { name: 'padded base64 encoded words', size: 1000, build: n => subject('=?utf-8?B?QQ==?= '.repeat(n)) },
    { name: 'joinable quoted-printable encoded words', size: 1000, build: n => subject('=?utf-8?Q?a?= '.repeat(n)) },
    {
        name: 'encoded words under distinct charsets',
        size: 1000,
        build: n => subject(repeat(n, i => `=?c${i}?Q?a?= `))
    },
    {
        name: 'one encoded word with a long payload',
        size: 1000,
        build: n => subject('=?utf-8?B?' + 'QUJD'.repeat(n) + '?=')
    },
    { name: 'encoded word openers that never close', size: 1000, build: n => subject('=?a?B?'.repeat(n)) },
    { name: 'a long subject of short words', size: 1000, build: n => subject('ab '.repeat(n)) },

    // header lines
    {
        name: 'folded header lines',
        size: 1000,
        max: MAX_HEADER_LINES,
        build: n => headers(['From: a@b', 'Subject: x' + '\r\n y'.repeat(n)]) + 'x'
    },
    {
        name: 'header lines',
        size: 1000,
        max: MAX_HEADER_LINES,
        build: n => headers(['From: a@b', ...Array<string>(n).fill('X-H: v')]) + 'x'
    },
    {
        name: 'address headers of one kind',
        size: 1000,
        max: MAX_HEADER_LINES,
        build: n => headers(['From: a@b', ...Array<string>(n).fill('Cc: a@b')]) + 'x'
    },
    {
        name: 'a header line of whitespace between long lines',
        size: 1000,
        max: MAX_HEADER_LINES / 2,
        build: n => headers(['From: a@b', ...Array<string>(n).fill(' \r\n' + 'x'.repeat(50))]) + 'x'
    },
    {
        name: 'one long header line without a colon',
        size: 1000,
        build: n => headers(['From: a@b', 'a'.repeat(n)]) + 'x'
    },

    // address lists
    { name: 'addresses', size: 1000, build: n => to('a@b,'.repeat(n)) },
    { name: 'display names without addresses', size: 1000, build: n => to('a,'.repeat(n)) },
    { name: 'quote characters', size: 1000, build: n => to('"'.repeat(n)) },
    { name: 'loose address text', size: 1000, build: n => to('a@'.repeat(n)) },
    { name: 'runs of loose address text', size: 1000, build: n => to('x@@ '.repeat(n)) },
    { name: 'whitespace runs in an angle bracket address', size: 1000, build: n => to('<' + 'a '.repeat(n) + 'u@d>') },
    { name: 'comments between the atoms of a display name', size: 1000, build: n => to('a(c)'.repeat(n) + ' <u@d>') },
    { name: 'comments inside an angle bracket address', size: 1000, build: n => to('<' + 'a(c)'.repeat(n) + '@d>') },
    { name: 'quoted strings back to back', size: 1000, build: n => to('"a"'.repeat(n) + ' <u@d>') },
    { name: 'whitespace and commas', size: 1000, build: n => to(' ,'.repeat(n)) },

    // structured headers
    {
        name: 'RFC 2231 continuation sections',
        size: 1000,
        build: n =>
            headers(['From: a@b', 'Content-Disposition: attachment;' + repeat(n, i => ` filename*${i}*=%41;`)]) + 'x'
    },
    {
        name: 'parameters',
        size: 1000,
        build: n => headers(['From: a@b', 'Content-Type: text/plain;' + repeat(n, i => ` p${i}=v;`)]) + 'x'
    },
    {
        name: 'comments in a structured header',
        size: 1000,
        build: n => headers(['From: a@b', 'Content-Type: text/plain' + ' (c)'.repeat(n)]) + 'x'
    },
    {
        name: 'a long parameter value',
        size: 1000,
        build: n => headers(['From: a@b', 'Content-Type: text/plain; charset=utf-8; x=' + 'v'.repeat(n)]) + 'x'
    },

    // body decoders
    {
        name: 'quoted-printable soft line breaks',
        size: 1000,
        build: n => headers(['From: a@b', 'Content-Transfer-Encoding: quoted-printable']) + '=\r\n'.repeat(n)
    },
    {
        name: 'quoted-printable lines of equals signs',
        size: 1000,
        build: n =>
            headers(['From: a@b', 'Content-Transfer-Encoding: quoted-printable']) + ('='.repeat(70) + '\r\n').repeat(n)
    },
    {
        name: 'base64 padded units on every line',
        size: 1000,
        build: n => headers(['From: a@b', 'Content-Transfer-Encoding: base64']) + 'QQ==\r\n'.repeat(n)
    },
    {
        name: 'base64 of nothing but pads',
        size: 1000,
        build: n => headers(['From: a@b', 'Content-Transfer-Encoding: base64']) + '='.repeat(n)
    },
    {
        name: 'format=flowed lines',
        size: 1000,
        build: n => body('text/plain; format=flowed; delsp=yes', 'a \r\n'.repeat(n))
    },
    {
        name: 'format=flowed quoted lines',
        size: 1000,
        build: n => body('text/plain; format=flowed', '> a \r\n'.repeat(n))
    },
    { name: 'empty lines', size: 1000, build: n => headers(['From: a@b']) + '\n'.repeat(n) },
    {
        name: 'a calendar part with trailing newlines',
        size: 1000,
        build: n => body('text/calendar', 'BEGIN' + '\n'.repeat(n))
    },
    { name: 'empty multipart parts', size: 1000, max: MAX_PARTS, build: n => mixed(Array<string>(n).fill('')) },

    // html to text
    { name: 'bare < characters', size: 1000, build: n => html('<'.repeat(n)) },
    { name: 'unclosed link tags', size: 1000, build: n => html('<a href='.repeat(n) + '>') },
    { name: 'unclosed comments', size: 1000, build: n => html('<!--'.repeat(n)) },
    { name: 'unclosed script end tags', size: 1000, build: n => html('<script>' + '</script'.repeat(n)) },
    { name: 'unclosed body tags', size: 1000, build: n => html('<body'.repeat(n)) },
    { name: 'entities without a semicolon', size: 1000, build: n => html('&amp'.repeat(n)) },
    { name: 'an href run past the last >', size: 1000, build: n => html('<a href=x>' + 'y'.repeat(n)) },
    { name: 'lines of whitespace', size: 1000, build: n => html(('\n' + ' '.repeat(20)).repeat(n) + 'x') },
    { name: 'list items', size: 1000, build: n => html('<li>\n \n'.repeat(n)) },

    // inline forwards, rendered into the text and html of the parent
    {
        name: 'inline forwards',
        size: 100,
        max: MAX_FORWARDS,
        build: n =>
            mixed(Array<string>(n).fill(headers(['Content-Type: message/rfc822']) + headers(['Subject: s']) + 'body'))
    },
    {
        name: 'addresses rendered from an inline forward',
        size: 1000,
        max: MAX_FORWARDED_ADDRESSES,
        build: n => forward(headers(['Subject: s', 'To: ' + 'a@b,'.repeat(n), 'Content-Type: text/plain']) + 'leaf')
    },
    {
        name: 'text rendered from an inline forward',
        size: 1000,
        build: n =>
            mixed([
                headers(['Content-Type: text/html']) + '<p>hi</p>',
                headers(['Content-Type: message/rfc822']) +
                    headers(['Subject: s', 'Content-Type: text/plain']) +
                    '&<\n'.repeat(n)
            ])
    },
    {
        // A dated forward renders its header block in both forms, and a date formatter per
        // header held ICU state off the V8 heap that no heap limit saw
        name: 'dated inline forwards',
        size: 100,
        max: MAX_FORWARDS,
        build: n =>
            mixed([
                headers(['Content-Type: text/html']) + '<p>hi</p>',
                ...Array<string>(n).fill(
                    headers(['Content-Type: message/rfc822']) +
                        headers(['Subject: s', 'Date: Mon, 1 Jan 2024 00:00:00 +0000']) +
                        'body'
                )
            ])
    },
    {
        // every character of the address is percent encoded into the mailto href
        name: 'a long percent-encoded address in an inline forward',
        size: 1000,
        build: n =>
            mixed([
                headers(['Content-Type: text/html']) + '<p>hi</p>',
                headers(['Content-Type: message/rfc822']) +
                    headers(['Subject: s', 'To: <' + '%'.repeat(n) + '@b>', 'Content-Type: text/plain']) +
                    'leaf'
            ])
    },
    {
        name: 'a chain of nested forwards with long subjects',
        size: 1000,
        build: n => {
            let message = headers(['Subject: ' + 'S'.repeat(n), 'Content-Type: text/plain']) + 'leaf';
            // as deep as maxRfc822NestingDepth parses inline
            for (let depth = 0; depth < 10; depth++) {
                message = forward(message);
            }
            return message;
        }
    },
    {
        name: 'a chain of nested forwards with text to convert',
        size: 1000,
        build: n => {
            // The html sibling makes the parser derive html from the plain part, six
            // characters for every `<`, and the non-ASCII character makes every string two
            // bytes a character. Rendered at every level of the chain, this took ten times
            // the time and memory of the flat message
            let message = mixed([
                headers(['Content-Type: text/html']) + '<p>€</p>',
                headers(['Content-Type: text/plain']) + '<'.repeat(n)
            ]);
            for (let depth = 0; depth < 10; depth++) {
                message = forward(message);
            }
            return message;
        }
    }
];
