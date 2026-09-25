import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';
import { getDecoder, ENCODING_LABELS } from '../src/decode-strings.js';

// Parse paths that used to cost O(n²) in the input size,
// https://github.com/postalsys/postal-mime/issues/97
//
// Every input here took seconds or more before the fix and takes milliseconds after it,
// so a regression shows up as a failed bound rather than a slow test.

const LIMIT_MS = 5000;

const timed = async (fn, label = '') => {
    const started = Date.now();
    const result = await fn();
    const elapsed = Date.now() - started;
    assert.ok(elapsed < LIMIT_MS, `${label} took ${elapsed}ms`);
    return result;
};

test('a header line with a long blank run is trimmed in linear time', async () => {
    const run = ' '.repeat(128 * 1024);
    const email = await timed(() => PostalMime.parse(`From: a@b\r\nSubject: a${run}b\r\na${run}b\r\n\r\nx`));

    assert.strictEqual(email.subject, `a${run}b`);
    assert.strictEqual(email.headers[2].key, `a${run}b`);
});

test('a header value is trimmed of SP and HTAB only', async () => {
    const email = await PostalMime.parse('Subject: \t \u00a0x\u00a0 \t \r\n\r\nx');
    assert.strictEqual(email.subject, '\u00a0x\u00a0');
});

test('a long format=flowed paragraph is unfolded in linear time', async () => {
    const lines = 250000;
    const email = await timed(() =>
        PostalMime.parse(`Content-Type: text/plain; format=flowed\r\n\r\n${'ab \r\n'.repeat(lines)}end\r\n`)
    );

    assert.strictEqual(email.text, 'ab '.repeat(lines) + 'end\n');
});

test('a long format=flowed delsp=yes paragraph is unfolded in linear time', async () => {
    const lines = 250000;
    const email = await timed(() =>
        PostalMime.parse(`Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\n${'ab \r\n'.repeat(lines)}end\r\n`)
    );

    assert.strictEqual(email.text, 'ab'.repeat(lines) + 'end\n');
});

test('format=flowed keeps the signature separator and empty lines', async () => {
    const email = await PostalMime.parse(
        'Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\n\r\na \r\nb\r\n-- \r\nsig \r\n \r\nx\r\n'
    );
    assert.strictEqual(email.text, '\nab\n-- \nsig\nx\n');
});

test('an address header with many addresses parses in linear time', async () => {
    const count = 150000;
    const email = await timed(() => PostalMime.parse(`To: ${'a@b,'.repeat(count)}\r\n\r\nx`));

    assert.strictEqual(email.to.length, count);
    assert.deepStrictEqual(email.to[count - 1], { address: 'a@b', name: '' });
});

test('many address headers of one kind are collected in linear time', async () => {
    const count = 160000;
    const email = await timed(() => PostalMime.parse(`${'Cc: a@b\r\n'.repeat(count)}\r\nx`));

    assert.strictEqual(email.cc.length, count);
});

test('structured headers with many parentheses in a parameter value parse in linear time', async () => {
    const parens = '('.repeat(256 * 1024);
    const email = await timed(() =>
        PostalMime.parse(
            [
                `Content-Type: application/octet-stream; a=b${parens}`,
                `Content-Disposition: attachment; filename=b${parens}`,
                `Content-Transfer-Encoding: base64; a=b${parens}`,
                '',
                'eA=='
            ].join('\r\n')
        )
    );

    // a parenthesis that continues a parameter value is content, not a comment
    assert.strictEqual(email.attachments[0].filename, `b${parens}`);
    assert.deepStrictEqual(new Uint8Array(email.attachments[0].content), new Uint8Array([0x78]));
});

test('an address after a long whitespace run is extracted in linear time', async () => {
    const run = ' '.repeat(128 * 1024);
    const email = await timed(() => PostalMime.parse(`To: x${run}!a@b.c\r\n\r\nx`));

    assert.deepStrictEqual(email.to, [{ address: 'a@b.c', name: `x${run}!` }]);
});

test('an encoded word that decodes to an unclosed angle bracket parses in linear time', async () => {
    const decoded = '<' + 'a@'.repeat(96 * 1024);
    const encoded = `=?utf-8?B?${Buffer.from(decoded).toString('base64')}?=`;
    const email = await timed(() => PostalMime.parse(`To: ${encoded}\r\n\r\nx`));

    // no angle bracket address, so the decoded text is only a display name
    assert.deepStrictEqual(email.to, [{ address: '', name: decoded }]);
});

test('an encoded word that decodes to an angle bracket address is parsed as one', async () => {
    const encoded = `=?utf-8?B?${Buffer.from('Name <a@b.c>').toString('base64')}?=`;
    const email = await PostalMime.parse(`To: ${encoded}\r\n\r\nx`);

    assert.deepStrictEqual(email.to, [{ address: 'a@b.c', name: 'Name' }]);
});

test('a calendar attachment with a long run of blank lines is normalized in linear time', async () => {
    const lines = 128 * 1024;
    for (const type of ['text/calendar', 'application/ics']) {
        const email = await timed(() =>
            PostalMime.parse(
                `Content-Type: ${type}\r\nContent-Disposition: attachment\r\n\r\nA${'\r\n'.repeat(lines)}B\r\n\r\n\r\n`,
                { attachmentEncoding: 'utf8' }
            )
        );

        // line endings become LF and the text ends in exactly one newline
        assert.strictEqual(email.attachments[0].content, `A${'\n'.repeat(lines)}B\n`);
    }
});

test('encoded words under unknown charset labels do not construct decoders', async () => {
    const labels = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
    let subject = '';
    for (let i = 0; subject.length < 62000; i++) {
        subject += `=?${labels[i % labels.length]}?Q??=`;
    }
    // a word that does not decode makes decodeWords render the header a second time
    subject += '=?utf-8?Q?=FF?=';

    const part = `--XX\r\nContent-Type: message/rfc822\r\n\r\nSubject: ${subject}\r\n\r\nx\r\n`;
    const email = await timed(() =>
        PostalMime.parse(`Content-Type: multipart/mixed; boundary=XX\r\n\r\n${part.repeat(128)}--XX--\r\n`)
    );

    assert.ok(email.text.includes('Subject: \ufffd'));
});

test('getDecoder reuses one decoder per label and falls back for labels TextDecoder refuses', () => {
    assert.strictEqual(getDecoder('iso-8859-2'), getDecoder('iso-8859-2'));
    assert.strictEqual(getDecoder('ISO-8859-2').encoding, 'iso-8859-2');

    // the replacement encoding and made up labels both end up as windows-1252
    for (const label of ['iso-2022-kr', 'hz-gb-2312', 'replacement', 'x-made-up', 'utf-32']) {
        assert.strictEqual(getDecoder(label).encoding, 'windows-1252', label);
    }

    // a reused decoder starts from a fresh state on every call
    const decoder = getDecoder('utf-8');
    assert.strictEqual(decoder.decode(new Uint8Array([0xe6, 0x97])), '\ufffd');
    assert.strictEqual(decoder.decode(new Uint8Array([0xa5])), '\ufffd');
    assert.strictEqual(decoder.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), 'a');
});

test('html parts with unclosed tags are converted to text in linear time', async () => {
    const size = 128 * 1024;
    const shapes = {
        'bare <': '<'.repeat(size),
        '<a without href': '<a '.repeat(size / 3) + '>',
        'unclosed comments': '<!--'.repeat(size / 4),
        'unclosed script end tags': '<script>' + '</script'.repeat(size / 8),
        'unclosed body tags': '<body'.repeat(size / 5),
        'unclosed br tags': '<br'.repeat(size / 3)
    };

    for (const [name, html] of Object.entries(shapes)) {
        // the text/plain sibling makes PostalMime derive text from the html part
        const email = await timed(
            () =>
                PostalMime.parse(
                    [
                        'Content-Type: multipart/mixed; boundary=XX',
                        '',
                        '--XX',
                        'Content-Type: text/plain',
                        '',
                        'plain',
                        '--XX',
                        'Content-Type: text/html',
                        '',
                        html,
                        '--XX--',
                        ''
                    ].join('\r\n')
                ),
            name
        );

        assert.ok(email.text.startsWith('plain\n'), name);
    }
});

test('TextDecoder accepts no charset label that is missing from the WHATWG list', () => {
    assert.strictEqual(ENCODING_LABELS.size, 228);

    const accepts = label => {
        try {
            new TextDecoder(label);
            return true;
        } catch (err) {
            return false;
        }
    };

    // A label the runtime accepts but the list lacks would be turned away and decode as
    // windows-1252. The other direction is fine: a runtime built without an encoding,
    // like Node 20 without iso-8859-16, rejects a listed label and falls back as before.
    const candidates = new Set([
        'utf-32',
        'utf-7',
        'binary',
        'ucs2',
        'cp437',
        'cp850',
        'iso-8859-11:2001',
        'gb2312-80'
    ]);
    for (const label of ENCODING_LABELS) {
        for (const variant of [
            `x-${label}`,
            `cs${label}`,
            label.replace(/[-_]/g, ''),
            label.replace(/-/g, '_'),
            label.replace(/_/g, '-')
        ]) {
            candidates.add(variant);
        }
    }

    for (const label of candidates) {
        if (!ENCODING_LABELS.has(label)) {
            assert.strictEqual(accepts(label), false, label);
        }
    }

    for (const label of ['iso-2022-kr', 'hz-gb-2312', 'replacement']) {
        assert.strictEqual(accepts(label), false, label);
    }
});
