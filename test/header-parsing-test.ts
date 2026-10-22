import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime, { addressParser, decodeWords } from '../src/postal-mime.js';
import { decodeBase64 } from '../src/decode-strings.js';

const multipart = (contentType: string, ...parts: string[][]) =>
    [contentType, '', ...parts.flatMap(part => ['--AAA', ...part]), '--AAA--', ''].join('\r\n');

const bytes = (buffer: ArrayBuffer | Uint8Array) => [...new Uint8Array(buffer)];

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
    assert.strictEqual(email.text!.trim(), 'hello');
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

test('a line starting with Unicode whitespace is neither a fold nor a field', async () => {
    // Only SP and HTAB continue a folded header. A line opening with U+00A0 used to be
    // absorbed into the header above it, which hid it from both headers and headerLines,
    // and trimmed into a field name it put a ` From:` ahead of the genuine one as the
    // sender, since the first occurrence of a header wins. The line is no field, so it
    // ends the headers as it does for Python, and neither From names the sender
    for (const chr of [' ', '\u000b', '\u000c', ' ', '﻿', '　', ' ']) {
        const email = await PostalMime.parse(
            `Received: from mx.example.com\r\n${chr}From: security@paypal.example\r\n` +
                `From: attacker@evil.example\r\nSubject: hi\r\n\r\nBody`
        );
        assert.strictEqual(email.from, undefined, `spoofed via ${JSON.stringify(chr)}`);
        assert.deepStrictEqual(
            email.headers.map(h => h.key),
            ['received']
        );
        assert.strictEqual(email.headerLines.length, 1);
        // includes rather than startsWith, since the UTF-8 decoder drops a leading BOM
        assert.ok(email.text!.includes('From: security@paypal.example\nFrom: attacker@evil.example\n'));
    }
});

test('a Content-Type cannot be smuggled in on a Unicode whitespace line', async () => {
    const email = await PostalMime.parse(
        'From: a@b.example\r\nContent-Type: multipart/mixed; boundary=B\r\n\r\n' +
            '--B\r\n Content-Type: text/html\r\nContent-Type: text/plain\r\n\r\n' +
            '<script>alert(1)</script>\r\n--B--\r\n'
    );
    // the line ends the headers of the part, so the part is plain text holding both
    // lines, and it must not reach the caller as trusted HTML
    assert.strictEqual(email.html, undefined);
    assert.strictEqual(email.text, ' Content-Type: text/html\nContent-Type: text/plain\n\n<script>alert(1)</script>');
});

test('a field name keeps the SP and HTAB around it', async () => {
    // A first line that starts with whitespace is a fold of nothing, which Python drops and
    // Go rejects the message for, and whitespace between the name and the colon is
    // obsolete syntax that Go reads as a different name. Trimmed, either spelling placed
    // ahead of the genuine header became the canonical one and won as its first occurrence
    for (const [first, second] of [
        [' From: security@paypal.example', 'From: attacker@evil.example'],
        ['\tFrom: security@paypal.example', 'From: attacker@evil.example'],
        ['From : security@paypal.example', 'From: attacker@evil.example'],
        ['From\t: security@paypal.example', 'From: attacker@evil.example'],
        ['Received: from mx.example.com', 'From : security@paypal.example\r\nFrom: attacker@evil.example']
    ]) {
        const email = await PostalMime.parse(`${first}\r\n${second}\r\nSubject: hi\r\n\r\nBody`);
        assert.strictEqual(email.from!.address, 'attacker@evil.example', `spoofed via ${JSON.stringify(first)}`);
        assert.strictEqual(email.headers.filter(h => h.key === 'from').length, 1);
        // the line stays visible under the name as it was written
        const spelled = email.headers.find(h => h.key !== 'from' && h.key.trim() === 'from');
        assert.ok(spelled, `the line is kept for ${JSON.stringify(first)}`);
        assert.ok(/^[ \t]from$|^from[ \t]$/.test(spelled.key), spelled.key);
        assert.strictEqual(email.headerLines.filter(h => h.key === 'from').length, 1);
    }
});

test('a Content-Type is not read from a field name with whitespace around it', async () => {
    for (const spelling of [' Content-Type', 'Content-Type ']) {
        const email = await PostalMime.parse(
            `${spelling}: multipart/mixed; boundary=X\r\nContent-Type: text/plain\r\n\r\n` +
                '--X\r\nContent-Type: application/octet-stream; name=evil.exe\r\n\r\nMZ\r\n--X--\r\n'
        );
        // plain text to every other parser, so no attachment is found here either
        assert.strictEqual(email.attachments.length, 0, spelling);
        assert.ok(email.text!.includes('evil.exe'), spelling);
    }
});

test('a nested multipart cannot reuse the boundary of an ancestor', async () => {
    // The outer delimiter is the one every other parser reads such a line as, so the
    // nested multipart has no parts and what follows the outer terminator is the epilogue
    for (const inner of ['X', 'X--']) {
        const email = await PostalMime.parse(
            'From: a@b.example\r\nContent-Type: multipart/mixed; boundary="X"\r\n\r\n' +
                `--X\r\nContent-Type: multipart/alternative; boundary="${inner}"\r\n\r\n` +
                `--${inner}\r\nContent-Type: text/plain\r\n\r\ntext\r\n` +
                '--X--\r\n' +
                '--X\r\nContent-Type: application/octet-stream; name=evil.exe\r\n\r\nMZ\r\n--X--\r\n'
        );
        assert.strictEqual(email.attachments.length, 0, inner);
        assert.strictEqual(email.html, undefined, inner);
        if (inner === 'X') {
            // the text part is a part of the outer multipart, as in Python
            assert.strictEqual(email.text!.trim(), 'text', inner);
        } else {
            // `--X--` ends the outer multipart before any part of the nested one
            assert.strictEqual(email.text, undefined, inner);
        }
    }
});

test('a bare CR does not survive into a header value', async () => {
    const email = await PostalMime.parse('Subject: hello\rBcc: victim@example.com\r\n\r\nBody');
    assert.ok(!email.subject!.includes('\r'));
    assert.strictEqual(email.subject, 'hello Bcc: victim@example.com');
    assert.strictEqual(email.bcc, undefined);
});

// End of the header block

test('a line that is neither a field nor a fold ends the headers', async () => {
    // Python reads such a line as the first line of a text/plain body and Go rejects the
    // message, so a From or a Content-Type behind it was honoured here alone
    const email = await PostalMime.parse(
        'Subject: x\r\njunk line\r\nFrom: evil@example.com\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>\r\n'
    );
    assert.strictEqual(email.subject, 'x');
    assert.strictEqual(email.from, undefined);
    assert.deepStrictEqual(
        email.headers.map(h => h.key),
        ['subject']
    );
    assert.strictEqual(email.html, undefined);
    assert.strictEqual(
        email.text,
        'junk line\nFrom: evil@example.com\nContent-Type: text/html\n\n<script>alert(1)</script>\n'
    );
});

test('a byte order mark in front of the first field name ends the headers', async () => {
    // Python has no headers for such a message at all, Go and mailparser read the From
    const email = await PostalMime.parse('﻿X-Foo: bar\r\nFrom: evil@example.com\r\n\r\nbody');
    assert.strictEqual(email.headers.length, 0);
    assert.strictEqual(email.from, undefined);
    assert.ok(email.text!.includes('X-Foo: bar\nFrom: evil@example.com\n\nbody\n'));
});

test('a header wrapped without folding whitespace ends the headers at the wrap', async () => {
    // the continuation is no field, so it starts the body, as Python reads it
    const email = await PostalMime.parse('Subject: a long\r\nsubject\r\nX-After: 1\r\n\r\nbody');
    assert.strictEqual(email.subject, 'a long');
    assert.ok(!email.headers.some(h => h.key === 'x-after'));
    assert.strictEqual(email.text, 'subject\nX-After: 1\n\nbody\n');
});

test('an empty field name, a space before the colon and an mbox From line stay headers', async () => {
    // the shapes Python's header pattern lets through, with the `From :` that Go and
    // mailparser tolerate as well
    const email = await PostalMime.parse(
        'From sender@example.com Mon Jan  1 00:00:00 2024\r\n' +
            'Subject: x\r\n' +
            ': empty name\r\n' +
            'X-Spaced : 1\r\n' +
            'Content-Type: text/html\r\n\r\n<p>html</p>'
    );
    assert.strictEqual(email.subject, 'x');
    assert.deepStrictEqual(
        email.headers.map(h => h.key),
        ['from sender@example.com mon jan  1 00', 'subject', '', 'x-spaced ', 'content-type']
    );
    assert.strictEqual(email.from, undefined);
    assert.strictEqual(email.html, '<p>html</p>\n');
});

test('a whitespace-only line stays a fold when a field follows it', async () => {
    const email = await PostalMime.parse('Subject: a\r\n \t\r\nX-After: 1\r\n\r\nbody');
    assert.strictEqual(email.subject, 'a');
    assert.ok(email.headers.some(h => h.key === 'x-after'));
    assert.strictEqual(email.text, 'body\n');
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
    assert.strictEqual(email.from!.address, 'first@example.com');
    assert.strictEqual(email.subject, 'first subject');
    // both are still listed, in the order they were sent
    assert.deepStrictEqual(
        email.headers.filter(h => h.key === 'from').map(h => h.value),
        ['first@example.com', 'second@example.com']
    );
});

test('an empty duplicate does not hide the real sender', async () => {
    const email = await PostalMime.parse('From: real@example.com\r\nFrom:\r\n\r\nBody');
    assert.strictEqual(email.from!.address, 'real@example.com');
});

test('multi value address headers keep document order', async () => {
    const email = await PostalMime.parse('To: a@example.com\r\nTo: b@example.com\r\n\r\nBody');
    assert.deepStrictEqual(
        email.to!.map(a => a.address),
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
    assert.strictEqual(email.text!.trim(), 'hello');
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
    assert.strictEqual(email.text!.trim(), 'Body');
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
        assert.strictEqual(email.text!.trim(), 'hello', contentType);
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
    assert.strictEqual(email.text!.trim(), 'Café');
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
    assert.strictEqual(email.text!.trim(), 'hello');
});

test('a parameter named after an Object prototype member is kept', async () => {
    const email = await PostalMime.parse('Content-Type: text/plain; constructor=x; charset=utf-8\r\n\r\nBody');
    assert.strictEqual(email.text!.trim(), 'Body');
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
    assert.strictEqual(email.text!.trim(), 'hello');
});

test('junk behind a closed quoted string does not reopen the quoting', async () => {
    // The junk was dropped by a test at the foot of the branches, so each branch above it
    // was a way around it. A second `"` reopened quoting, which both carried the whitespace
    // in front of it into the value and took the `;` that ends the parameter along, so the
    // boundary registered as `AAA ` and every delimiter in the message stopped matching:
    // the text and the attachment below both vanished without an error, while a parser that
    // reads the boundary correctly still saw them.
    const email = await PostalMime.parse(
        multipart(
            'Content-Type: multipart/mixed; boundary="AAA" "; boundary=BBB"',
            ['Content-Type: text/plain', '', 'hello'],
            ['Content-Type: text/plain', 'Content-Disposition: attachment; filename="payload.txt"', '', 'x']
        )
    );

    assert.strictEqual(email.text!.trim(), 'hello');
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, 'payload.txt');
});

test('a second quoted run does not leak whitespace into the value before it', async () => {
    for (const contentType of [
        'Content-Type: multipart/mixed; boundary="AAA" "junk"',
        'Content-Type: multipart/mixed; boundary="AAA" "BBB"'
    ]) {
        const email = await PostalMime.parse(multipart(contentType, ['Content-Type: text/plain', '', 'hello']));
        assert.strictEqual(email.text!.trim(), 'hello', contentType);
    }
});

test('an escape behind a closed quoted string does not append to the value', async () => {
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; boundary="AAA" "\\j\\u\\n\\k"', [
            'Content-Type: text/plain',
            '',
            'hello'
        ])
    );
    assert.strictEqual(email.text!.trim(), 'hello');
});

test('a continuation does not override the plain parameter of the same name', async () => {
    // The join writes the key it builds, which is the one write here that could take a name
    // another parameter already holds. Both orders resolve to the plain parameter, so the
    // reading does not come down to which spelling the sender put first
    for (const disposition of [
        'Content-Disposition: attachment; filename="plain.txt"; filename*0="cont.txt"',
        'Content-Disposition: attachment; filename*0="cont.txt"; filename="plain.txt"'
    ]) {
        const email = await PostalMime.parse(
            multipart('Content-Type: multipart/mixed; boundary="AAA"', [
                'Content-Type: application/pdf',
                disposition,
                '',
                'x'
            ])
        );
        assert.strictEqual(email.attachments[0].filename, 'plain.txt', disposition);
    }
});

test('a parameter with no name is dropped', async () => {
    // a name is a token and a token is never empty, so the nameless one names nothing
    const email = await PostalMime.parse(
        multipart('Content-Type: multipart/mixed; =v; boundary="AAA"', ['Content-Type: text/plain', '', 'hello'])
    );
    assert.strictEqual(email.text!.trim(), 'hello');
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

test('a Content-Transfer-Encoding behind a comment still decodes, a quoted one does not', async () => {
    for (const header of [
        'Content-Transfer-Encoding: (comment) base64',
        'Content-Transfer-Encoding:  base64 (comment)'
    ]) {
        const email = await PostalMime.parse(`Content-Type: text/plain\r\n${header}\r\n\r\naGVsbG8=\r\n`);
        assert.strictEqual(email.text, 'hello', header);
    }

    // Python and mailparser hand the body of a quoted token through as it is
    const email = await PostalMime.parse(
        'Content-Type: text/plain\r\nContent-Transfer-Encoding: "base64"\r\n\r\naGVsbG8=\r\n'
    );
    assert.strictEqual(email.text, 'aGVsbG8=\n');
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
    assert.ok(!email.subject!.includes('\u0000'));
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
    assert.deepStrictEqual(bytes(email.attachments[0].content as ArrayBuffer), [1, 2, 3, 4, 5, 6]);
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
    assert.ok(email.text!.startsWith('Hi'), JSON.stringify(email.text));
});

// format=flowed

test('space stuffing is removed before soft line breaks are joined', async () => {
    // RFC 3676 section 4.4 removes the stuffed space first. Removing it after the join
    // leaves it sitting in the middle of the joined paragraph.
    const email = await PostalMime.parse(
        'Content-Type: text/plain; format=flowed\r\n\r\nline one \r\n stuffed continuation\r\n'
    );
    assert.strictEqual(email.text!.trim(), 'line one stuffed continuation');
});

// Input types

test('a DataView is accepted as input', async () => {
    const buffer = new TextEncoder().encode('Subject: hi\r\n\r\nBody');
    const email = await PostalMime.parse(new DataView(buffer.buffer));
    assert.strictEqual(email.subject, 'hi');
    assert.strictEqual(email.text!.trim(), 'Body');
});

test('a typed array view over a larger buffer only reads its own range', async () => {
    const full = new TextEncoder().encode('XXXXSubject: hi\r\n\r\nBodyYYYY');
    const email = await PostalMime.parse(full.subarray(4, full.length - 4));
    assert.strictEqual(email.subject, 'hi');
    assert.strictEqual(email.text!.trim(), 'Body');
});

// Limits

test('maxHeadersSize is counted across the whole message, not per part', async () => {
    const parts: string[][] = [];
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
    assert.ok(email.text!.includes('not a real date'));
    assert.ok(email.text!.includes('inner body'));
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
    assert.ok(email.html!.includes('Recipients'));
    assert.ok(email.html!.includes('inner'));
});

test('a line break in an RFC 2231 filename is folded into a space', async () => {
    // the raw header had its line breaks folded before it got here, so a filename that
    // smuggles them in through the encoding is folded the same way, see foldLineBreaks
    const email = await PostalMime.parse(
        "Content-Disposition: attachment; filename*=utf-8''line%0D%0Abreak.txt\r\n\r\nx"
    );
    assert.strictEqual(email.attachments[0].filename, 'line break.txt');
});

test('a line break in an RFC 2231 boundary still makes the boundary unmatchable', async () => {
    // Folding the boundary would turn a message that has no parts for any other parser into
    // one with parts here, and hand a scanner evasion to whoever hid them
    const mail =
        "Content-Type: multipart/mixed; boundary*=utf-8''b%0Ac\r\n\r\n" +
        '--b c\r\nContent-Type: text/plain\r\n\r\nvisible text\r\n' +
        '--b c\r\nContent-Type: application/octet-stream; name=payload.exe\r\n\r\nMZ\r\n' +
        '--b c--\r\n';
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text, undefined);
    assert.deepStrictEqual(email.attachments, []);
});

// Performance. These all used to scale quadratically and are bounded well inside the
// limits, so a regression shows up as a timeout rather than a slow test.

test('a multipart with many parts parses in linear time', async () => {
    const mail = 'Content-Type: multipart/mixed; boundary=b\r\n\r\n' + '--b\r\n'.repeat(20000);
    const started = Date.now();
    // more parts than the default part count allows, the walk is what is under test here
    await PostalMime.parse(mail, { maxPartCount: 30000 });
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});

test('a deeply folded header parses in linear time', async () => {
    // every line counts for at least 64 bytes of the header budget, so this many stay inside it
    const mail = 'Subject: x\r\n' + (' ' + 'y'.repeat(20) + '\r\n').repeat(30000) + '\r\nBody';
    const started = Date.now();
    await PostalMime.parse(mail);
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});

test('an address field with long whitespace runs parses in linear time', async () => {
    const started = Date.now();
    addressParser('x' + ' '.repeat(50000) + 'a'.repeat(50000));
    assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});
