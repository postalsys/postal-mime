import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';
import type { PostalMimeError } from '../src/postal-mime.js';

// Charset alias handling
test('Charset - iso-8859-8-i body decodes Hebrew', async () => {
    // raw iso-8859-8 bytes for "שלום עולם" placed directly in an 8bit body
    const mail = Buffer.concat([
        Buffer.from('Content-Type: text/plain; charset="iso-8859-8-i"\r\n\r\n'),
        Buffer.from('+ezl7SDy5ezt', 'base64')
    ]);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text!.trim(), 'שלום עולם');
    assert.ok(!email.text!.includes('�'));
});

test('Charset - iso-8859-8-e body decodes Hebrew', async () => {
    const mail = Buffer.concat([
        Buffer.from('Content-Type: text/plain; charset="iso-8859-8-e"\r\n\r\n'),
        Buffer.from('+ezl7SDy5ezt', 'base64')
    ]);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text!.trim(), 'שלום עולם');
    assert.ok(!email.text!.includes('�'));
});

test('Charset - cp932 body and subject decode Japanese', async () => {
    // cp932 is not a label TextDecoder accepts, so before it was aliased to shift_jis
    // both the body and the encoded word decoded as windows-1252 without any error.
    const mail = Buffer.concat([
        Buffer.from('Content-Type: text/plain; charset="cp932"\r\nSubject: =?cp932?B?k/qWe4zq?=\r\n\r\n'),
        Buffer.from('k/qWe4zq', 'base64')
    ]);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject!.trim(), '日本語');
    assert.strictEqual(email.text!.trim(), '日本語');
});

// Boundary Detection Edge Cases
test('Edge case - boundary-like content in body', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain

This text contains --boundary but it's not a real boundary
--boundary
Content-Type: text/plain

Another part
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text!.includes('--boundary'));
    assert.ok(email.text!.includes('Another part'));
});

test('Edge case - boundary without double dash', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

boundary
This should not be treated as a boundary

--boundary
Content-Type: text/plain

Real part
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Single "boundary" text is in preamble and not included in parsed text
    assert.ok(email.text!.includes('Real part'));
});

test('Edge case - boundary with extra dashes', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain

Part 1
----boundary
Not a terminator
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text!.includes('----boundary'));
});

test('Edge case - missing boundary terminator', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain

Part without terminator`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Edge case - empty multipart section', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
--boundary
Content-Type: text/plain

Part 2
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Edge case - multipart with only preamble', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

This is preamble text before any boundaries
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email);
});

test('Edge case - multipart with epilogue', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain

Part
--boundary--
This is epilogue text after the final boundary`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Edge case - boundary at start of line only', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain

Text with --boundary in middle of line
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text!.includes('--boundary in middle'));
});

// Malformed MIME Messages
test('Edge case - no Content-Type header', async () => {
    const mail = Buffer.from(`From: sender@example.com
To: recipient@example.com

Body without content-type`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Edge case - malformed Content-Type', async () => {
    const mail = Buffer.from(`Content-Type: invalid

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email);
});

test('Edge case - Content-Type without subtype', async () => {
    const mail = Buffer.from(`Content-Type: text

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email);
});

test('Edge case - empty message', async () => {
    const mail = Buffer.from('\n');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email);
    assert.ok(Array.isArray(email.headers));
});

test('Edge case - only headers no body', async () => {
    const mail = Buffer.from(`From: sender@example.com
Subject: Test`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject, 'Test');
});

test('Edge case - no From header', async () => {
    const mail = Buffer.from(`To: recipient@example.com
Subject: Test

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.from, undefined);
    assert.ok(email.to);
});

test('Edge case - duplicate headers', async () => {
    const mail = Buffer.from(`Subject: First Subject
Subject: Second Subject

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Should use first occurrence for single-value headers
    assert.ok(email.subject);
});

test('Edge case - header with no value', async () => {
    const mail = Buffer.from(`X-Empty-Header:
Subject: Test

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject, 'Test');
});

test('Edge case - very long line', async () => {
    const longLine = 'x'.repeat(10000);
    const mail = Buffer.from(`Content-Type: text/plain

${longLine}`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text!.includes('x'));
});

test('Edge case - line with only spaces', async () => {
    const mail = Buffer.from(`Content-Type: text/plain

Line 1

Line 3`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text!.includes('Line 1'));
    assert.ok(email.text!.includes('Line 3'));
});

test('Edge case - CRLF and LF mixed', async () => {
    const mail = Buffer.from('Content-Type: text/plain\r\n\nLine 1\nLine 2\r\nLine 3');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text!.includes('Line 1'));
    assert.ok(email.text!.includes('Line 2'));
    assert.ok(email.text!.includes('Line 3'));
});

test('Edge case - only CR line endings', async () => {
    const mail = Buffer.from('Content-Type: text/plain\n\nLine 1\nLine 2');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
    assert.ok(email.text.includes('Line 1'));
});

// Character Encoding Edge Cases
test('Edge case - unknown charset', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=unknown-charset

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Should fallback gracefully
    assert.ok(email.text);
});

test('Edge case - charset without quotes', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=utf-8

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Edge case - mixed encodings in attachments', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain
Content-Transfer-Encoding: base64

SGVsbG8=
--b
Content-Type: text/plain
Content-Transfer-Encoding: quoted-printable

World
--b--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text!.includes('Hello'));
    assert.ok(email.text!.includes('World'));
});

test('Edge case - 7bit encoding', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

Plain text`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text!.trim(), 'Plain text');
});

test('Edge case - 8bit encoding', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 8bit

Text with 8-bit chars`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Edge case - binary encoding', async () => {
    const mail = Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: binary

Binary data`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
});

test('Edge case - unknown transfer encoding', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: unknown

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Edge case - a transfer encoding is matched whole, not as a substring', async () => {
    // base64 of "<script>alert(1)</script>", which Python and mailparser keep as it is
    // under any of these, so it must not be decoded into markup here
    const body = 'PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
    for (const encoding of [
        'x-base64',
        'base64x',
        '7bit-base64',
        'xquoted-printable',
        'quoted-printable-x',
        // a quoted token is raw base64 to Python and mailparser, so it is not decoded
        '"base64"',
        "'base64'",
        'x "base64"',
        '"quoted-printable"'
    ]) {
        const email = await PostalMime.parse(
            `Content-Type: text/html\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${body}`
        );
        assert.strictEqual(email.html, body + '\n', encoding);
    }
    // the exact tokens still decode, in any case, with comments around them and behind
    // them whatever Python decodes them behind
    for (const encoding of ['BASE64', '(x) base64', 'base64 (x)', 'base64;', 'base64; x=1', 'base64 x']) {
        const email = await PostalMime.parse(
            `Content-Type: text/html\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${body}`
        );
        assert.strictEqual(email.html, '<script>alert(1)</script>', encoding);
    }
});

test('Edge case - trailing whitespace of a boundary parameter is not part of it', async () => {
    // Python strips it and finds the parts, so an attachment it shows is not hidden here
    for (const boundary of ['abc ', 'abc\t', 'abc  ']) {
        const email = await PostalMime.parse(
            `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
                '--abc\r\nContent-Type: text/plain\r\n\r\ntext\r\n' +
                '--abc\r\nContent-Type: application/octet-stream; name=evil.exe\r\n\r\nMZ\r\n--abc--\r\n'
        );
        assert.strictEqual(email.text!.trim(), 'text', JSON.stringify(boundary));
        assert.strictEqual(email.attachments.length, 1, JSON.stringify(boundary));
        assert.strictEqual(email.attachments[0].filename, 'evil.exe');
    }
    // a boundary of nothing but whitespace is no boundary
    const email = await PostalMime.parse('Content-Type: multipart/mixed; boundary=" "\r\n\r\n--\r\ntext\r\n');
    assert.strictEqual(email.text, '--\ntext\n');
});

test('Edge case - a boundary holding a non-ASCII character is no boundary', async () => {
    // RFC 2046 bchars are ASCII, and Python matches no line against such a boundary. A
    // header line that is not UTF-8 is read as windows-1252 and the boundary re-encoded
    // as UTF-8, so `boundary="ab\xE9cd"` matched lines of `--ab\xC3\xA9cd` that Python
    // and Go never find, and with \xE9 on both sides nothing matched and the body was
    // dropped without a trace
    const parts = (boundary: Buffer): Buffer =>
        Buffer.concat([
            Buffer.from('--'),
            boundary,
            Buffer.from('\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>\r\n--'),
            boundary,
            Buffer.from('\r\nContent-Type: application/octet-stream; name=x.exe\r\n\r\nMZ\r\n--'),
            boundary,
            Buffer.from('--\r\n')
        ]);
    const message = (header: Buffer, body: Buffer): Buffer =>
        Buffer.concat([
            Buffer.from('Content-Type: multipart/mixed; boundary="'),
            header,
            Buffer.from('"\r\n\r\n'),
            parts(body)
        ]);
    const latin1 = Buffer.from([0x61, 0x62, 0xe9, 0x63, 0x64]);
    const utf8 = Buffer.from('abécd');

    for (const [name, header, body] of [
        ['windows-1252 header, UTF-8 body', latin1, utf8],
        ['windows-1252 header and body', latin1, latin1],
        ['UTF-8 header and body', utf8, utf8]
    ] as const) {
        const email = await PostalMime.parse(message(header, body));
        assert.strictEqual(email.html, undefined, name);
        assert.strictEqual(email.attachments.length, 0, name);
        // the body reads as plain text, as that of a multipart without a boundary does
        assert.ok(email.text!.includes('<script>alert(1)</script>'), name);
        assert.ok(email.text!.includes('name=x.exe'), name);
    }

    // the ASCII specials a boundary may carry still make one
    const ascii = Buffer.from("b#$@'()+_,-./:=?");
    const email = await PostalMime.parse(message(ascii, ascii));
    assert.strictEqual(email.html, '<script>alert(1)</script>');
    assert.strictEqual(email.attachments.length, 1);
});

test('Edge case - the disposition type ends at the first whitespace', async () => {
    // `attachment garbage` is an attachment to Python and mailparser, so the html is not
    // the body here either
    for (const disposition of ['attachment garbage', 'attachment\tgarbage', 'attachment junk; filename=a.html']) {
        const email = await PostalMime.parse(
            `Content-Type: multipart/mixed; boundary=b\r\n\r\n` +
                `--b\r\nContent-Type: text/html\r\nContent-Disposition: ${disposition}\r\n\r\n<p>hi</p>\r\n--b--\r\n`
        );
        assert.strictEqual(email.html, undefined, disposition);
        assert.strictEqual(email.attachments.length, 1, disposition);
        assert.strictEqual(email.attachments[0].disposition, 'attachment', disposition);
    }
});

test('Edge case - a charset of the replacement encoding decodes to the replacement character', async () => {
    // The bytes are an ISO-2022-KR shift to Hangul around ASCII, which Python decodes as
    // Hangul and a browser as U+FFFD. Read as UTF-8 they are the markup inside
    const body = '\x1b$)C\x0e<img src=x onerror=alert(1)>\x0f';
    for (const charset of [
        'iso-2022-kr',
        'ISO-2022-KR',
        'csISO2022KR',
        'hz-gb-2312',
        'iso-2022-cn',
        'iso-2022-cn-ext'
    ]) {
        const email = await PostalMime.parse(`Content-Type: text/html; charset=${charset}\r\n\r\n${body}`);
        assert.strictEqual(email.html, '�', charset);
    }
    // in an encoded word and in an RFC 2231 parameter as well
    const email = await PostalMime.parse(
        'Subject: =?iso-2022-kr?Q?<b>x</b>?=\r\n' +
            'Content-Type: application/octet-stream\r\n' +
            "Content-Disposition: attachment; filename*=iso-2022-kr''%3Cb%3E\r\n\r\nx"
    );
    assert.strictEqual(email.subject, '�');
    assert.strictEqual(email.attachments[0].filename, '�');
    // the html prescan reads the label the same way
    const sniffed = await PostalMime.parse(`Content-Type: text/html\r\n\r\n<meta charset="iso-2022-kr">${body}`);
    assert.strictEqual(sniffed.html, '�');
    // an empty text is empty
    const empty = await PostalMime.parse('Content-Type: text/plain; charset=iso-2022-kr\r\n\r\n');
    assert.strictEqual(empty.text, undefined);
});

// a utf-16 document in both byte orders, and a parse of it under a charset label, as
// base64 so that no line break of the transport is appended
const UTF16_MARKUP = '<img src=x onerror=alert(1)>';
const UTF16_LE = Buffer.from(UTF16_MARKUP, 'utf16le');
const UTF16_BE = Buffer.from(UTF16_LE).swap16();
const parseUtf16 = (label: string, bytes: Buffer, bom: readonly number[] = []) =>
    PostalMime.parse(
        `Content-Type: text/html; charset=${label}\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
            Buffer.concat([Buffer.from(bom), bytes]).toString('base64')
    );

test('Edge case - a byte order mark decides the byte order of a utf-16 label', async () => {
    // a document under a label that leaves the byte order open, which read as little
    // endian without the mark
    for (const label of ['utf-16', 'UTF-16', 'utf16', 'utf_16']) {
        assert.strictEqual((await parseUtf16(label, UTF16_BE, [0xfe, 0xff])).html, UTF16_MARKUP, label);
        assert.strictEqual((await parseUtf16(label, UTF16_LE, [0xff, 0xfe])).html, UTF16_MARKUP, label);
    }
    // A label that names the order is read as it says, as Python and mailparser read it,
    // and no label honours a UTF-8 mark. A scanner built on either sees CJK text in these,
    // so none of them may be markup here
    for (const [label, bom, bytes] of [
        ['utf-16le', [0xfe, 0xff], UTF16_BE],
        ['utf-16be', [0xff, 0xfe], UTF16_LE],
        ['utf-16', [0xef, 0xbb, 0xbf], Buffer.from(UTF16_MARKUP)],
        ['utf-16be', [0xef, 0xbb, 0xbf], Buffer.from(UTF16_MARKUP)]
    ] as const) {
        const email = await parseUtf16(label, bytes, bom);
        assert.ok(
            !email.html!.includes('<img'),
            `${label} with ${bom.map(b => b.toString(16)).join(' ')}: ${email.html}`
        );
    }
    // without a mark the label decides, as before
    assert.strictEqual((await parseUtf16('utf-16', UTF16_LE)).html, UTF16_MARKUP);
    assert.strictEqual((await parseUtf16('utf-16be', UTF16_BE)).html, UTF16_MARKUP);
    // a mark does not override a single byte charset
    const latin = await parseUtf16('iso-8859-1', Buffer.from('A'), [0xfe, 0xff]);
    assert.strictEqual(latin.html, 'þÿA');
});

test('Edge case - a utf-16 label Python and iconv-lite do not both know is not utf-16', async () => {
    // The Encoding Standard reads the first five as UTF-16 and Python raises LookupError
    // on every one of them, as it does on ucs-2, ucs2, utf16le and utf16be, which
    // iconv-lite alone knows, and ucs-2 as little endian whatever mark the bytes carry.
    // Under any of them a scanner built on one of the two sees NUL interleaved single
    // byte text where the markup rendered here. x-utf-16 and x-utf16 only reach a UTF-16
    // label through the vendor prefix being stripped, which neither reader does
    for (const label of [
        'unicode',
        'csunicode',
        'iso-10646-ucs-2',
        'unicodefeff',
        'unicodefffe',
        'ucs-2',
        'ucs2',
        'utf16le',
        'utf16be',
        'x-unicode',
        'x-utf-16',
        'x-utf16',
        'x-ucs2'
    ]) {
        const email = await parseUtf16(label, UTF16_LE);
        assert.ok(!email.html!.includes('<img'), `${label}: ${email.html}`);
        // read as single byte text, the ASCII letters are still there
        assert.ok(email.html!.includes('i\u0000m\u0000g\u0000'), label);
    }
});

// Attachment Edge Cases
test('Edge case - attachment without filename', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment

Data`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, null);
});

test('Edge case - inline disposition without Content-ID', async () => {
    const mail = Buffer.from(`Content-Type: image/png
Content-Disposition: inline

Data`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].disposition, 'inline');
});

test('Edge case - attachment with base64 encoding option', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="test.pdf"

Data`);

    const parser = new PostalMime({ attachmentEncoding: 'base64' });
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].encoding, 'base64');
    assert.strictEqual(typeof email.attachments[0].content, 'string');
});

test('Edge case - attachment with utf8 encoding option', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Disposition: attachment; filename="test.txt"

Text content`);

    const parser = new PostalMime({ attachmentEncoding: 'utf8' });
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].encoding, 'utf8');
    assert.strictEqual(typeof email.attachments[0].content, 'string');
});

test('Edge case - attachment with arraybuffer encoding (default)', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="test.pdf"

Data`);

    const parser = new PostalMime({ attachmentEncoding: 'arraybuffer' });
    const email = await parser.parse(mail);

    assert.ok(email.attachments[0].content instanceof ArrayBuffer);
});

// Alternative Text Handling
test('Edge case - alternative with no HTML', async () => {
    const mail = Buffer.from(`Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain

Plain text only
--alt--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
    assert.strictEqual(email.html, undefined);
});

test('Edge case - alternative with no plain text', async () => {
    const mail = Buffer.from(`Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/html

<p>HTML only</p>
--alt--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.html);
    assert.ok(email.html.includes('HTML only'));
});

test('Edge case - nested alternatives', async () => {
    const mail = Buffer.from(`Content-Type: multipart/alternative; boundary="outer"

--outer
Content-Type: multipart/alternative; boundary="inner"

--inner
Content-Type: text/plain

Plain
--inner
Content-Type: text/html

<p>HTML1</p>
--inner--
--outer
Content-Type: text/html

<p>HTML2</p>
--outer--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
    assert.ok(email.html);
});

// Date Parsing Edge Cases
test('Edge case - invalid date format', async () => {
    const mail = Buffer.from(`Date: Not a valid date
Subject: Test

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Should keep original string if invalid
    assert.ok(email.date);
});

test('Edge case - no Date header', async () => {
    const mail = Buffer.from(`Subject: Test

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.date, undefined);
});

test('Edge case - multiple Date headers', async () => {
    const mail = Buffer.from(`Date: Mon, 01 Jan 2024 00:00:00 +0000
Date: Tue, 02 Jan 2024 00:00:00 +0000

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.date);
});

// Input Format Edge Cases
test('Edge case - parse from ReadableStream', async () => {
    const text = 'Subject: Test\n\nBody';
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        }
    });

    const parser = new PostalMime();
    const email = await parser.parse(stream);

    assert.strictEqual(email.subject, 'Test');
});

test('Edge case - parse from Uint8Array', async () => {
    const text = 'Subject: Test\n\nBody';
    const uint8 = new TextEncoder().encode(text);

    const parser = new PostalMime();
    const email = await parser.parse(uint8);

    assert.strictEqual(email.subject, 'Test');
});

test('Edge case - parse from ArrayBuffer', async () => {
    const text = 'Subject: Test\n\nBody';
    const buffer = new TextEncoder().encode(text).buffer;

    const parser = new PostalMime();
    const email = await parser.parse(buffer);

    assert.strictEqual(email.subject, 'Test');
});

test('Edge case - parse from string', async () => {
    const text = 'Subject: Test\n\nBody';

    const parser = new PostalMime();
    const email = await parser.parse(text);

    assert.strictEqual(email.subject, 'Test');
});

test('Edge case - reuse parser instance', async () => {
    const parser = new PostalMime();
    await parser.parse('Subject: Test 1\n\nBody');

    try {
        await parser.parse('Subject: Test 2\n\nBody');
        assert.fail('Should not allow parser reuse');
    } catch (err) {
        assert.ok((err as Error).message.includes('reuse'));
        assert.strictEqual((err as PostalMimeError).code, 'EPARSERREUSED');
    }
});

// Message/Delivery-Status Edge Cases
test('Edge case - message/delivery-status forces attachment', async () => {
    const mail = Buffer.from(`Content-Type: multipart/report; boundary="b"

--b
Content-Type: message/delivery-status

Status: delivered
--b
Content-Type: message/rfc822

From: test@example.com

Body
--b--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // message/rfc822 should be treated as attachment due to delivery-status
    assert.ok(email.attachments.length > 0);
});

test('Edge case - message/feedback-report forces attachment', async () => {
    const mail = Buffer.from(`Content-Type: multipart/report; boundary="b"

--b
Content-Type: message/feedback-report

Feedback-Type: abuse
--b
Content-Type: message/rfc822

From: test@example.com

Body
--b--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.attachments.length > 0);
});

test('From header with a quoted local part keeps the quotes in the parsed address', async () => {
    const mail =
        'From: "user@evil.com"@good.com\r\nTo: Name <to@example.com(x)evil.com>\r\nSubject: test\r\n\r\nbody\r\n';
    const email = await PostalMime.parse(mail);
    assert.deepStrictEqual(email.from, { address: '"user@evil.com"@good.com', name: '' });
    assert.deepStrictEqual(email.to, [{ address: 'to@example.com', name: 'Name evil.com' }]);
});

// RFC 2046 5.1.1: the CRLF in front of a boundary belongs to the boundary, not to the part
// before it. Base64 parts always got this right, other encodings used to keep it as content.
function boundaryMessage(parts: string[], closing = '--B--\r\n'): string {
    return (
        ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="B"', ''].join('\r\n') +
        '\r\n' +
        parts.map(part => `--B\r\n${part}\r\n`).join('') +
        closing
    );
}

function attachmentPart(cte: string, body: string): string {
    return [
        'Content-Type: text/plain; name="x.txt"',
        'Content-Disposition: attachment; filename="x.txt"',
        `Content-Transfer-Encoding: ${cte}`,
        '',
        body
    ].join('\r\n');
}

async function attachmentText(mail: string, index = 0): Promise<string> {
    const email = await PostalMime.parse(mail);
    return new TextDecoder().decode(email.attachments[index].content as ArrayBuffer);
}

test('Boundary line break - is not content for any transfer encoding', async () => {
    for (const [cte, body] of [
        ['7bit', 'abc'],
        ['8bit', 'abc'],
        ['binary', 'abc'],
        ['quoted-printable', 'abc'],
        ['base64', 'YWJj']
    ]) {
        assert.strictEqual(await attachmentText(boundaryMessage([attachmentPart(cte, body)])), 'abc', cte);
    }
});

test('Boundary line break - inner and trailing blank lines are kept', async () => {
    // with the line endings the message used, an attachment is the bytes as sent
    const mail = boundaryMessage([attachmentPart('7bit', 'a\r\n\r\nb\r\n')]);
    assert.strictEqual(await attachmentText(mail), 'a\r\n\r\nb\r\n');

    const qp = boundaryMessage([attachmentPart('quoted-printable', 'a=3D\r\nb\r\n')]);
    assert.strictEqual(await attachmentText(qp), 'a=\r\nb\r\n');
});

test('Boundary line break - a part holding one empty line is empty', async () => {
    assert.strictEqual(await attachmentText(boundaryMessage([attachmentPart('7bit', '')])), '');
    assert.strictEqual(await attachmentText(boundaryMessage([attachmentPart('quoted-printable', '')])), '');
});

test('Boundary line break - quoted-printable soft break before the boundary', async () => {
    const mail = boundaryMessage([attachmentPart('quoted-printable', 'ab=\r\nc=')]);
    assert.strictEqual(await attachmentText(mail), 'abc');
});

test('Boundary line break - text parts end where the boundary starts', async () => {
    const text = await PostalMime.parse(boundaryMessage(['Content-Type: text/plain\r\n\r\nhello']));
    assert.strictEqual(text.text, 'hello');

    const html = await PostalMime.parse(boundaryMessage(['Content-Type: text/html\r\n\r\n<p>hi</p>']));
    assert.strictEqual(html.html, '<p>hi</p>');
});

test('Boundary line break - every part before a boundary, not only the last one', async () => {
    const mail = boundaryMessage([attachmentPart('7bit', 'one'), attachmentPart('quoted-printable', 'two')]);
    assert.strictEqual(await attachmentText(mail, 0), 'one');
    assert.strictEqual(await attachmentText(mail, 1), 'two');
});

test('Boundary line break - nested multipart closed by the outer boundary', async () => {
    const inner = [
        'Content-Type: multipart/mixed; boundary="C"',
        '',
        '--C',
        attachmentPart('7bit', 'inner'),
        // no closing --C-- here, the outer boundary ends the inner part
        '--B',
        attachmentPart('7bit', 'outer')
    ].join('\r\n');
    const mail = boundaryMessage([inner]);
    assert.strictEqual(await attachmentText(mail, 0), 'inner');
    assert.strictEqual(await attachmentText(mail, 1), 'outer');
});

test('Boundary line break - a part ended by the end of input keeps its line break', async () => {
    // no closing boundary, nothing owns the final line break
    const unclosed = boundaryMessage([attachmentPart('7bit', 'abc')], '');
    assert.strictEqual(await attachmentText(unclosed), 'abc\r\n');

    const unclosedQp = boundaryMessage([attachmentPart('quoted-printable', 'abc')], '');
    assert.strictEqual(await attachmentText(unclosedQp), 'abc\r\n');

    // single part messages are unchanged
    const single = await PostalMime.parse('Content-Type: text/plain\r\n\r\nabc\r\n');
    assert.strictEqual(single.text, 'abc\n');

    const singleQp = await PostalMime.parse(
        'Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nab=\r\nc\r\n'
    );
    assert.strictEqual(singleQp.text, 'abc\n');
});
