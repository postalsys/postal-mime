import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime, { addressParser, decodeWords } from '../src/postal-mime.js';
import { decodeBase64 } from '../src/decode-strings.js';

const multipart = (contentType, ...parts) =>
    [contentType, '', ...parts.flatMap(part => ['--AAA', ...part]), '--AAA--', ''].join('\r\n');

const bytes = buffer => [...new Uint8Array(buffer)];

// Header unfolding, https://github.com/postalsys/postal-mime/issues/92

test('unfolding keeps the folding whitespace', async () => {
    const email = await PostalMime.parse('Subject: Hello\r\n    World\r\n\r\nBody');
    assert.strictEqual(email.subject, 'Hello    World');
});

test('unfolding keeps a tab used to fold', async () => {
    const email = await PostalMime.parse('Subject: Hello\r\n\tWorld\r\n\r\nBody');
    assert.strictEqual(email.subject, 'Hello\tWorld');
});

test('unfolding does not collapse whitespace inside an unfolded header', async () => {
    const email = await PostalMime.parse('Subject: John   Q.   Doe\r\n\r\nBody');
    assert.strictEqual(email.subject, 'John   Q.   Doe');
});

test('unfolding leaves non-ASCII whitespace in a raw UTF-8 header alone', async () => {
    // RFC 6532 allows raw UTF-8 in headers, and JS \s matches U+3000 and U+00A0
    const email = await PostalMime.parse('Subject: a\u3000b\u00a0c\r\n\r\nBody');
    assert.strictEqual(email.subject, 'a\u3000b\u00a0c');
});

test('a boundary containing repeated spaces still delimits the message', async () => {
    const mail = multipart('Content-Type: multipart/mixed; boundary="a  b"', ['Content-Type: text/plain', '', 'hello'])
        .split('--AAA')
        .join('--a  b');

    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'hello');
});

test('a filename containing repeated spaces is preserved', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; filename="my  file.txt"',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'my  file.txt');
});

test('only SP and HTAB continue a folded header', async () => {
    // A line opening with U+00A0 used to be absorbed into the header above it, which
    // hid it from both headers and headerLines while a strict parser still saw a line
    for (const chr of ['\u00a0', '\u000b', '\u000c', '\u2028']) {
        const email = await PostalMime.parse(
            `X-Filler: 1\r\n${chr}From: mallory@evil.example\r\nSubject: hi\r\n\r\nBody`
        );
        assert.strictEqual(email.headers.length, 3, `expected 3 headers for ${JSON.stringify(chr)}`);
        assert.strictEqual(email.headerLines.length, 3);
    }
});

test('a field name is not made canonical by stripping Unicode whitespace', async () => {
    // These lines are not folds, and they are not valid headers either. They have to stay
    // visible, but their key must not collide with a real header: a ` From:` line
    // placed ahead of the genuine one would otherwise become the sender, because the
    // first occurrence of a header wins.
    for (const chr of [' ', '', '', ' ', '﻿', '　', ' ']) {
        const email = await PostalMime.parse(
            `Received: from mx.example.com\r\n${chr}From: security@paypal.example\r\n` +
                `From: attacker@evil.example\r\nSubject: hi\r\n\r\nBody`
        );
        assert.strictEqual(email.from.address, 'attacker@evil.example', `spoofed via ${JSON.stringify(chr)}`);
        assert.strictEqual(email.headers.length, 4);
        assert.ok(email.headers.some(h => h.key === `${chr}from`));
        assert.strictEqual(email.headers.filter(h => h.key === 'from').length, 1);
    }
});

test('a Content-Type cannot be smuggled in on a Unicode whitespace line', async () => {
    const email = await PostalMime.parse(
        'From: a@b.example\r\nContent-Type: multipart/mixed; boundary=B\r\n\r\n' +
            '--B\r\n Content-Type: text/html\r\nContent-Type: text/plain\r\n\r\n' +
            '<script>alert(1)</script>\r\n--B--\r\n'
    );
    // the part is plain text, so it must not reach the caller as trusted HTML
    assert.strictEqual(email.html, undefined);
    assert.strictEqual(email.text.trim(), '<script>alert(1)</script>');
});

test('a bare CR does not survive into a header value', async () => {
    const email = await PostalMime.parse('Subject: hello\rBcc: victim@example.com\r\n\r\nBody');
    assert.ok(!email.subject.includes('\r'));
    assert.strictEqual(email.subject, 'hello Bcc: victim@example.com');
    assert.strictEqual(email.bcc, undefined);
});

// Header order and duplicate headers

test('headers are exposed in document order', async () => {
    const email = await PostalMime.parse(
        'From: a@example.com\r\nTo: b@example.com\r\nSubject: s\r\nX-Last: 1\r\n\r\nBody'
    );
    assert.deepStrictEqual(
        email.headers.map(h => h.key),
        ['from', 'to', 'subject', 'x-last']
    );
    assert.deepStrictEqual(
        email.headerLines.map(h => h.key),
        ['from', 'to', 'subject', 'x-last']
    );
});

test('a duplicated single value header resolves to the first occurrence', async () => {
    const email = await PostalMime.parse(
        'From: first@example.com\r\nFrom: second@example.com\r\n' +
            'Subject: first subject\r\nSubject: second subject\r\n\r\nBody'
    );
    assert.strictEqual(email.from.address, 'first@example.com');
    assert.strictEqual(email.subject, 'first subject');
    // both are still listed, in the order they were sent
    assert.deepStrictEqual(
        email.headers.filter(h => h.key === 'from').map(h => h.value),
        ['first@example.com', 'second@example.com']
    );
});

test('an empty duplicate does not hide the real sender', async () => {
    const email = await PostalMime.parse('From: real@example.com\r\nFrom:\r\n\r\nBody');
    assert.strictEqual(email.from.address, 'real@example.com');
});

test('multi value address headers keep document order', async () => {
    const email = await PostalMime.parse('To: a@example.com\r\nTo: b@example.com\r\n\r\nBody');
    assert.deepStrictEqual(
        email.to.map(a => a.address),
        ['a@example.com', 'b@example.com']
    );
});

test('a duplicated Content-Type can not change how the body is read', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"\r\nContent-Type: text/plain', [
            'Content-Type: application/octet-stream',
            'Content-Disposition: attachment; filename="evil.exe"',
            '',
            'payload'
        ])
    );
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, 'evil.exe');
});

test('a duplicated Content-Transfer-Encoding resolves to the first occurrence', async () => {
    const email = await PostalMime.parse(
        'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n' +
            'Content-Transfer-Encoding: 7bit\r\n\r\naGVsbG8=\r\n'
    );
    assert.strictEqual(email.text, 'hello');
});

// Structured header parameters

test('an unbalanced parenthesis does not discard the parameters after it', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; x=see(note; boundary="AAA"', [
            'Content-Type: text/plain',
            '',
            'hello'
        ])
    );
    assert.strictEqual(email.text.trim(), 'hello');
});

test('parentheses inside an unquoted parameter value are content', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; filename=Invoice(1).pdf',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'Invoice(1).pdf');
});

test('a comment is still stripped from a structured header value', async () => {
    const email = await PostalMime.parse('Content-Type: text/plain (plain text); charset=utf-8\r\n\r\nBody');
    assert.strictEqual(email.text.trim(), 'Body');
    assert.ok(!email.html);
});

test('a backslash outside a quoted string is an ordinary character', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; filename=C:\\Users\\me\\a.txt',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'C:\\Users\\me\\a.txt');
});

test('a valueless parameter does not swallow the one that follows it', async () => {
    for (const contentType of [
        'Content-Type: multipart/mixed; flag; boundary="AAA"',
        'Content-Type: multipart/mixed;; boundary="AAA"',
        'Content-Type: multipart/mixed; boundary="AAA"; flag'
    ]) {
        const email = await PostalMime.parse(multipart(contentType, ['Content-Type: text/plain', '', 'hello']));
        assert.strictEqual(email.text.trim(), 'hello', contentType);
    }
});

test('a valueless parameter does not swallow a filename', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; inline; filename="real.txt"',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'real.txt');
});

test('a comment after a parameter value is still stripped', async () => {
    // the parenthesis follows whitespace, so it opens a comment rather than continuing
    // the token the way `filename=Invoice(1).pdf` does
    const mail = Buffer.concat([
        Buffer.from('Content-Type: text/plain; charset=iso-8859-1 (latin1)\r\n\r\nCaf'),
        Buffer.from([0xe9])
    ]);
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Café');
});

test('whitespace between a token and a quoted string is content', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; filename=report "final"',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'report final');
});

test('a duplicated parameter resolves to its first occurrence', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"; boundary="BBB"', [
            'Content-Type: text/plain',
            '',
            'hello'
        ])
    );
    assert.strictEqual(email.text.trim(), 'hello');
});

test('a parameter named after an Object prototype member is kept', async () => {
    const email = await PostalMime.parse('Content-Type: text/plain; constructor=x; charset=utf-8\r\n\r\nBody');
    assert.strictEqual(email.text.trim(), 'Body');
});

test('an unterminated comment does not leak into a quoted parameter value', async () => {
    // RFC 2045: a parameter value is a token or a quoted string, not a quoted string
    // followed by more text. Appending the leftovers produced a boundary that none of
    // the delimiters in the message match, which silently discards the whole body.
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA" (unterminated comment', [
            'Content-Type: text/plain',
            '',
            'hello'
        ])
    );
    assert.strictEqual(email.text.trim(), 'hello');
});

test('whitespace around an unquoted parameter value is dropped', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; filename=  spaced.txt  ',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'spaced.txt');
});

// RFC 2231 parameter value continuations

test('an unencoded continuation section is literal text', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; filename*0="a%2F..%2F..%2Fetc"; filename*1=".txt"',
            '',
            'x'
        ])
    );
    // percent decoding an unencoded section invents path separators that were never sent
    assert.strictEqual(email.attachments[0].filename, 'a%2F..%2F..%2Fetc.txt');
});

test('an encoded continuation section is still percent decoded', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            "Content-Disposition: attachment; filename*0*=utf-8''a%20b; filename*1*=%2Ec",
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'a b.c');
});

test('a multi byte character split across encoded sections survives', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            "Content-Disposition: attachment; filename*0*=utf-8''smile%F0%9F; filename*1*=%98%80.pdf",
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'smile\u{1F600}.pdf');
});

test('quoted whitespace inside a continuation is preserved', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Disposition: attachment; filename*0="Annual Report "; filename*1="2024.pdf"',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].filename, 'Annual Report 2024.pdf');
});

// Content-Transfer-Encoding

test('a Content-Transfer-Encoding that does not start with a word character still decodes', async () => {
    for (const header of [
        'Content-Transfer-Encoding: (comment) base64',
        'Content-Transfer-Encoding: "base64"',
        'Content-Transfer-Encoding:  base64 (comment)'
    ]) {
        const email = await PostalMime.parse(`Content-Type: text/plain\r\n${header}\r\n\r\naGVsbG8=\r\n`);
        assert.strictEqual(email.text, 'hello', header);
    }
});

// Base64

test('decodeBase64 sizes its output from the payload, not the padding', () => {
    assert.deepStrictEqual(bytes(decodeBase64('QUJD')), [0x41, 0x42, 0x43]);
    assert.deepStrictEqual(bytes(decodeBase64('QUJDRA==')), [0x41, 0x42, 0x43, 0x44]);
    assert.deepStrictEqual(bytes(decodeBase64('QUJDREU=')), [0x41, 0x42, 0x43, 0x44, 0x45]);
    // unpadded remainders
    assert.deepStrictEqual(bytes(decodeBase64('QQ')), [0x41]);
    assert.deepStrictEqual(bytes(decodeBase64('QUJDRA')), [0x41, 0x42, 0x43, 0x44]);
    // a remainder of one character can not encode a byte, it is a truncated group
    assert.deepStrictEqual(bytes(decodeBase64('QUJDR')), [0x41, 0x42, 0x43]);
    assert.deepStrictEqual(bytes(decodeBase64('')), []);
});

test('a truncated base64 encoded word does not inject NUL bytes', async () => {
    const email = await PostalMime.parse('Subject: =?utf-8?B?SGVsbG8gd?=\r\n\r\nBody');
    assert.strictEqual(email.subject, 'Hello ');
    assert.ok(!email.subject.includes('\u0000'));
});

test('base64 padded on every line decodes as separate units', async () => {
    const email = await PostalMime.parse(
        'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\nd29ybGQ=\r\n'
    );
    assert.strictEqual(email.text, 'helloworld');
});

test('a base64 attachment padded on every line keeps its bytes', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/octet-stream',
            'Content-Transfer-Encoding: base64',
            'Content-Disposition: attachment; filename="a.bin"',
            '',
            'AQID',
            'BAUG'
        ])
    );
    assert.deepStrictEqual(bytes(email.attachments[0].content), [1, 2, 3, 4, 5, 6]);
});

// Encoded words

test('the join marker can not be injected through a header', async () => {
    const email = await PostalMime.parse('Subject: Sensitive__\u0000JOIN\u0000__Deleted\r\n\r\nBody');
    assert.strictEqual(email.subject, 'Sensitive__\u0000JOIN\u0000__Deleted');
});

test('an injected join marker does not eat the encoded word after it', () => {
    assert.strictEqual(decodeWords('A__\u0000JOIN\u0000__=?utf-8?B?SEVMTE8=?='), 'A__\u0000JOIN\u0000__HELLO');
});

test('encoded words are still joined across a fold', () => {
    assert.strictEqual(decodeWords('=?utf-8?B?0L/RgNC4?= =?utf-8?B?0LLQtdGC?='), 'привет');
});

test('encoded words with different charsets are decoded separately', () => {
    assert.strictEqual(decodeWords('=?utf-8?Q?a?= =?iso-8859-1?Q?b?='), 'ab');
});

test('a charset label containing punctuation is resolved', () => {
    assert.strictEqual(decodeWords('=?ISO_8859-1:1987?Q?caf=E9?='), 'café');
});

// Attachments

test('a Content-Description carrying encoded words is decoded', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: application/pdf',
            'Content-Description: =?utf-8?B?SGVsbG8=?=',
            'Content-Disposition: attachment; filename="a.pdf"',
            '',
            'x'
        ])
    );
    assert.strictEqual(email.attachments[0].description, 'Hello');
});

// Quoted-printable

test('quoted-printable is decoded independently of the body charset', async () => {
    // The charset belongs to the decoded bytes, not to the transfer encoded source.
    // Running it over the source turned every part whose charset is not ASCII
    // compatible into mojibake, while the same content in base64 decoded correctly.
    const mail = Buffer.from(
        'Content-Type: text/plain; charset=utf-16le\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=48=00=69=00'
    );
    const email = await PostalMime.parse(mail);
    // the decoder terminates each body line with a single LF byte, which is half a
    // UTF-16 code unit, so only the content itself is compared here
    assert.ok(email.text.startsWith('Hi'), JSON.stringify(email.text));
});

// format=flowed

test('space stuffing is removed before soft line breaks are joined', async () => {
    // RFC 3676 section 4.4 removes the stuffed space first. Removing it after the join
    // leaves it sitting in the middle of the joined paragraph.
    const email = await PostalMime.parse(
        'Content-Type: text/plain; format=flowed\r\n\r\nline one \r\n stuffed continuation\r\n'
    );
    assert.strictEqual(email.text.trim(), 'line one stuffed continuation');
});

// Input types

test('a DataView is accepted as input', async () => {
    const buffer = new TextEncoder().encode('Subject: hi\r\n\r\nBody');
    const email = await PostalMime.parse(new DataView(buffer.buffer));
    assert.strictEqual(email.subject, 'hi');
    assert.strictEqual(email.text.trim(), 'Body');
});

test('a typed array view over a larger buffer only reads its own range', async () => {
    const full = new TextEncoder().encode('XXXXSubject: hi\r\n\r\nBodyYYYY');
    const email = await PostalMime.parse(full.subarray(4, full.length - 4));
    assert.strictEqual(email.subject, 'hi');
    assert.strictEqual(email.text.trim(), 'Body');
});

// Limits

test('maxHeadersSize is counted across the whole message, not per part', async () => {
    const parts = [];
    for (let i = 0; i < 8; i++) {
        parts.push(['Content-Type: text/plain', `X-Pad: ${'a'.repeat(200 * 1024)}`, '', 'x']);
    }
    const mail = multipart('Content-Type: multipart/mixed; boundary="AAA"', ...parts);

    await assert.rejects(() => PostalMime.parse(mail, { maxHeadersSize: 1024 * 1024 }), /Maximum header size/);
});

// Formatting a forwarded message

test('an unparseable Date in a forwarded message does not reject the parse', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA"', [
            'Content-Type: message/rfc822',
            '',
            'Date: not a real date',
            'Subject: inner',
            '',
            'inner body'
        ])
    );
    assert.ok(email.text.includes('not a real date'));
    assert.ok(email.text.includes('inner body'));
});

test('group syntax in a forwarded From does not reject the parse', async () => {
    const mail = multipart(
        'Content-Type: multipart/alternative; boundary="AAA"',
        ['Content-Type: text/html', '', '<p>outer</p>'],
        [
            'Content-Type: message/rfc822',
            '',
            'From: Recipients:;',
            'Subject: inner',
            'Content-Type: text/html',
            '',
            '<b>inner</b>'
        ]
    );

    const email = await PostalMime.parse(mail);
    assert.ok(email.html.includes('Recipients'));
    assert.ok(email.html.includes('inner'));
});

// Performance. These all used to scale quadratically and are bounded well inside the
// default limits, so a regression shows up as a timeout rather than a slow test.

test('a multipart with many parts parses in linear time', async () => {
    const mail = 'Content-Type: multipart/mixed; boundary=b\r\n\r\n' + '--b\r\n'.repeat(20000);
    const started = Date.now();
    await PostalMime.parse(mail);
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});

test('a deeply folded header parses in linear time', async () => {
    const mail = 'Subject: x\r\n' + (' ' + 'y'.repeat(20) + '\r\n').repeat(40000) + '\r\nBody';
    const started = Date.now();
    await PostalMime.parse(mail);
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});

test('an address field with long whitespace runs parses in linear time', async () => {
    const started = Date.now();
    addressParser('x' + ' '.repeat(50000) + 'a'.repeat(50000));
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});
