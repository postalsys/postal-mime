import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

// MIME Node Header Parsing Tests
test('MimeNode - parse simple headers', async () => {
    const mail = Buffer.from(`From: sender@example.com
To: recipient@example.com
Subject: Test
Content-Type: text/plain

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.from.address, 'sender@example.com');
    assert.strictEqual(email.to[0].address, 'recipient@example.com');
    assert.strictEqual(email.subject, 'Test');
});

test('MimeNode - parse header with parameters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=utf-8; format=flowed

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Verify text was parsed (charset was recognized)
    assert.ok(email.text);
});

test('MimeNode - parse Content-Disposition header', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="test.pdf"

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, 'test.pdf');
    assert.strictEqual(email.attachments[0].disposition, 'attachment');
});

test('MimeNode - parse quoted filename', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="my file.pdf"

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].filename, 'my file.pdf');
});

test('MimeNode - parse filename with special characters', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="file (copy).pdf"

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].filename, 'file (copy).pdf');
});

test('MimeNode - parse multipart boundary', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="----BOUNDARY"

------BOUNDARY
Content-Type: text/plain

Part 1
------BOUNDARY
Content-Type: text/plain

Part 2
------BOUNDARY--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Part 1'));
    assert.ok(email.text.includes('Part 2'));
});

test('MimeNode - parse boundary without quotes', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary=BOUNDARY

--BOUNDARY
Content-Type: text/plain

Part 1
--BOUNDARY--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('MimeNode - parse nested multipart', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="outer"

--outer
Content-Type: multipart/alternative; boundary="inner"

--inner
Content-Type: text/plain

Plain text
--inner
Content-Type: text/html

<p>HTML</p>
--inner--
--outer--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
    assert.ok(email.html);
});

test('MimeNode - max nesting depth', async () => {
    // Create deeply nested structure beyond default 256 levels
    let mail = 'Content-Type: multipart/mixed; boundary="b0"\n\n--b0\n';

    for (let i = 1; i < 260; i++) {
        mail += `Content-Type: multipart/mixed; boundary="b${i}"\n\n--b${i}\n`;
    }

    mail += 'Content-Type: text/plain\n\nBody';

    const parser = new PostalMime();

    try {
        await parser.parse(Buffer.from(mail));
        assert.fail('Should have thrown error for max nesting depth');
    } catch (err) {
        assert.ok(err.message.includes('nesting depth'));
    }
});

test('MimeNode - custom max nesting depth', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="b1"

--b1
Content-Type: multipart/mixed; boundary="b2"

--b2
Content-Type: text/plain

Body
--b2--
--b1--`);

    const parser = new PostalMime({ maxNestingDepth: 1 });

    try {
        await parser.parse(mail);
        assert.fail('Should have thrown error for custom nesting depth');
    } catch (err) {
        assert.ok(err.message.includes('nesting depth'));
    }
});

test('MimeNode - max headers size', async () => {
    // Create very large header
    const longValue = 'x'.repeat(3 * 1024 * 1024); // 3MB
    const mail = Buffer.from(`X-Large-Header: ${longValue}

Body`);

    const parser = new PostalMime();

    try {
        await parser.parse(mail);
        assert.fail('Should have thrown error for max headers size');
    } catch (err) {
        assert.ok(err.message.includes('header'));
    }
});

test('MimeNode - custom max headers size', async () => {
    const mail = Buffer.from(`X-Header: ${'x'.repeat(100)}

Body`);

    const parser = new PostalMime({ maxHeadersSize: 50 });

    try {
        await parser.parse(mail);
        assert.fail('Should have thrown error for custom headers size');
    } catch (err) {
        assert.ok(err.message.includes('header'));
    }
});

test('MimeNode - parse folded headers', async () => {
    const mail = Buffer.from(`Subject: This is a very long subject
 that is folded across
 multiple lines

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.subject.includes('very long'));
    assert.ok(email.subject.includes('multiple lines'));
});

test('MimeNode - parse header with semicolon in value', async () => {
    const mail = Buffer.from(`Subject: Test; with semicolon

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.subject.includes(';'));
});

test('MimeNode - parse Content-ID header', async () => {
    const mail = Buffer.from(`Content-Type: image/png
Content-ID: <image123@example.com>
Content-Disposition: inline

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].contentId, '<image123@example.com>');
});

test('MimeNode - parse Content-Description header', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Description: Important Document
Content-Disposition: attachment

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].description, 'Important Document');
});

test('MimeNode - parse charset parameter', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset="iso-8859-1"

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('MimeNode - default content type', async () => {
    const mail = Buffer.from(`From: sender@example.com

Body without content-type`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Should default to text/plain
    assert.ok(email.text);
});

test('MimeNode - parse message/rfc822 inline', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain

Outer message
--boundary
Content-Type: message/rfc822

From: inner@example.com
Subject: Inner message

Inner body
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Outer message'));
    assert.ok(email.text.includes('Inner message'));
});

test('MimeNode - parse message/rfc822 as attachment', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: message/rfc822
Content-Disposition: attachment

From: inner@example.com
Subject: Attached message

Attached body
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'message/rfc822');
});

test('MimeNode - force rfc822 attachments option', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: message/rfc822

From: inner@example.com

Body
--boundary--`);

    const parser = new PostalMime({ forceRfc822Attachments: true });
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
});

test('MimeNode - rfc822 attachments option', async () => {
    const mail = Buffer.from(`Content-Type: message/rfc822

From: sender@example.com

Body`);

    const parser = new PostalMime({ rfc822Attachments: true });
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
});

// Build a message/rfc822 chain `levels` deep around a plain text body.
function nestRfc822(levels, inner = 'Content-Type: text/plain\r\n\r\ninnermost body') {
    let mail = inner;
    for (let i = 0; i < levels; i++) {
        mail = `Content-Type: message/rfc822\r\nSubject: level ${i}\r\n\r\n` + mail;
    }
    return mail;
}

test('MimeNode - deeply nested message/rfc822 is bounded', async () => {
    // Each nesting level is parsed by a new sub-parser that retains the whole
    // nested message, so the MIME nesting depth limit does not apply and memory
    // grows with every level. Nesting beyond the limit becomes an attachment.
    const email = await PostalMime.parse(nestRfc822(200));

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'message/rfc822');
    // attachment content is the raw nested message
    const inner = Buffer.from(email.attachments[0].content).toString();
    assert.ok(inner.startsWith('Content-Type: message/rfc822'));
});

test('MimeNode - moderate message/rfc822 nesting is still parsed inline', async () => {
    const email = await PostalMime.parse(nestRfc822(5));

    assert.ok(email.text.includes('innermost body'));
    assert.strictEqual(email.attachments.length, 0);
});

test('MimeNode - message/rfc822 nesting at exactly the default limit is parsed inline', async () => {
    // Pins the boundary: 10 levels is the last depth that is still inlined.
    const email = await PostalMime.parse(nestRfc822(10));

    assert.ok(email.text.includes('innermost body'));
    assert.strictEqual(email.attachments.length, 0);
});

test('MimeNode - message/rfc822 nesting one past the default limit is an attachment', async () => {
    const email = await PostalMime.parse(nestRfc822(11));

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'message/rfc822');
    assert.ok(!email.text.includes('innermost body'));
});

test('MimeNode - maxRfc822NestingDepth option', async () => {
    const email = await PostalMime.parse(nestRfc822(5), { maxRfc822NestingDepth: 2 });

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'message/rfc822');
});

test('MimeNode - maxRfc822NestingDepth boundary for a custom value', async () => {
    const inlined = await PostalMime.parse(nestRfc822(3), { maxRfc822NestingDepth: 3 });
    assert.strictEqual(inlined.attachments.length, 0);
    assert.ok(inlined.text.includes('innermost body'));

    const capped = await PostalMime.parse(nestRfc822(4), { maxRfc822NestingDepth: 3 });
    assert.strictEqual(capped.attachments.length, 1);
});

test('MimeNode - maxRfc822NestingDepth of 0 disables inline parsing', async () => {
    // 0 must mean "never parse inline", not "fall back to the default".
    const email = await PostalMime.parse(nestRfc822(5), { maxRfc822NestingDepth: 0 });

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'message/rfc822');
    assert.ok(!(email.text || '').includes('innermost body'));
});

test('MimeNode - invalid limit options throw a catchable error', async () => {
    // A string or NaN limit disables the limit altogether, because every
    // `size > limit` comparison against such a value is false. A non-finite limit
    // would abort the process with an OOM that no caller can catch. Both have to be
    // rejected up front, since callers forward request supplied option objects.
    const invalid = [Infinity, -Infinity, NaN, -1, 2.5, '3', true, {}, []];

    for (const option of ['maxNestingDepth', 'maxHeadersSize', 'maxRfc822NestingDepth']) {
        for (const value of invalid) {
            assert.throws(
                () => new PostalMime({ [option]: value }),
                TypeError,
                `${option} should reject ${String(value)}`
            );
        }
    }
});

test('MimeNode - a string maxHeadersSize does not silently disable the limit', async () => {
    const mail = 'X-Pad: ' + 'a'.repeat(200000) + '\r\nContent-Type: text/plain\r\n\r\nbody';

    // a numeric string used to make every `headerSize > limit` comparison false,
    // which disabled the cap instead of enforcing it
    await assert.rejects(() => PostalMime.parse(mail, { maxHeadersSize: '1000' }), TypeError);
    await assert.rejects(() => PostalMime.parse(mail, { maxHeadersSize: 1000 }), /header size/);

    // the static entry point must reject rather than throw synchronously, so that a
    // `.catch()` chain still sees the error
    await PostalMime.parse(mail, { maxHeadersSize: '1000' }).then(
        () => assert.fail('should have rejected'),
        err => assert.ok(err instanceof TypeError)
    );
});

test('MimeNode - unset limit options fall back to the defaults', async () => {
    for (const options of [undefined, {}, { maxRfc822NestingDepth: undefined }, { maxRfc822NestingDepth: null }]) {
        const parser = new PostalMime(options);
        assert.strictEqual(parser.maxRfc822NestingDepth, 10);
        assert.strictEqual(parser.mimeOptions.maxNestingDepth, 256);
        assert.strictEqual(parser.mimeOptions.maxHeadersSize, 2 * 1024 * 1024);
    }
});

test('MimeNode - rfc822 nesting depth cannot be seeded through the options', async () => {
    // The recursion counter is internal state, not a public option. If it could be
    // set by a caller, forwarding a request supplied options object would disable
    // the limit entirely.
    const email = await PostalMime.parse(nestRfc822(5), {
        maxRfc822NestingDepth: 2,
        _rfc822NestingDepth: -50
    });

    assert.strictEqual(email.attachments.length, 1);
    assert.ok(!(email.text || '').includes('innermost body'));
});

test('MimeNode - capped message/rfc822 attachment is flagged as truncated', async () => {
    const capped = await PostalMime.parse(nestRfc822(11));
    assert.strictEqual(capped.attachments[0].rfc822DepthExceeded, true);

    // parts that were parsed inline must not carry the flag
    const inlined = await PostalMime.parse(nestRfc822(3));
    assert.strictEqual(inlined.attachments.length, 0);

    // neither must an ordinary attachment
    const plain = await PostalMime.parse(
        'Content-Type: multipart/mixed; boundary=B\r\n\r\n' +
            '--B\r\nContent-Type: text/plain\r\n\r\nhello\r\n' +
            '--B\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=a.pdf\r\n\r\nPDF\r\n--B--\r\n'
    );
    assert.strictEqual(plain.attachments[0].rfc822DepthExceeded, undefined);
});

test('MimeNode - capped message/rfc822 does not join the related cid map', async () => {
    // A nested message that was never parsed is not a renderable inline resource.
    // Marking it related would let a renderer substitute a raw RFC822 blob into
    // an <img src="cid:...">.
    const mail =
        'Content-Type: multipart/related; boundary=R\r\n\r\n' +
        '--R\r\nContent-Type: text/html\r\n\r\n<img src="cid:img1"><img src="cid:sub1">\r\n' +
        '--R\r\nContent-Type: image/png\r\nContent-ID: <img1>\r\n\r\nPNGDATA\r\n' +
        '--R\r\nContent-Type: message/rfc822\r\nContent-ID: <sub1>\r\n\r\n' +
        'Content-Type: text/plain\r\n\r\nnested body\r\n' +
        '--R--\r\n';

    const email = await PostalMime.parse(mail, { maxRfc822NestingDepth: 0 });

    const image = email.attachments.find(a => a.contentId === '<img1>');
    const sub = email.attachments.find(a => a.contentId === '<sub1>');

    assert.strictEqual(image.related, true);
    assert.strictEqual(sub.mimeType, 'message/rfc822');
    assert.notStrictEqual(sub.related, true);
    assert.strictEqual(sub.rfc822DepthExceeded, true);
});

test('MimeNode - attachments inside an inline message/rfc822 survive every attachmentEncoding', async () => {
    // The sub-parser is forced to arraybuffer so the parent encodes each attachment
    // exactly once. Inheriting the caller's encoding here would double-encode and
    // silently produce empty content.
    const mail =
        'Content-Type: message/rfc822\r\n\r\n' +
        'Content-Type: multipart/mixed; boundary=B\r\n\r\n' +
        '--B\r\nContent-Type: text/plain\r\n\r\nhello\r\n' +
        '--B\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=a.bin\r\n\r\n' +
        'PAYLOAD\r\n--B--\r\n';

    for (const attachmentEncoding of ['arraybuffer', 'base64', 'utf8']) {
        const email = await PostalMime.parse(mail, { attachmentEncoding });
        const attachment = email.attachments.find(a => a.filename === 'a.bin');

        assert.ok(attachment, `missing attachment for ${attachmentEncoding}`);

        let content;
        switch (attachmentEncoding) {
            case 'base64':
                assert.strictEqual(attachment.encoding, 'base64');
                content = Buffer.from(attachment.content, 'base64').toString();
                break;
            case 'utf8':
                assert.strictEqual(attachment.encoding, 'utf8');
                content = attachment.content;
                break;
            default:
                content = Buffer.from(attachment.content).toString();
        }

        assert.ok(content.includes('PAYLOAD'), `content lost for ${attachmentEncoding}`);
    }
});

// An explicitly inline message/rfc822 wrapping a sub-message that itself contains a
// message/rfc822 part. The outer part is parsed regardless of the classification
// options, which is what creates the sub-parser the inner part is classified by.
const NESTED_RFC822_FIXTURE =
    'Content-Type: message/rfc822\r\nContent-Disposition: inline\r\n\r\n' +
    'Content-Type: multipart/mixed; boundary=B\r\n\r\n' +
    '--B\r\nContent-Type: text/plain\r\n\r\nsub body\r\n' +
    '--B\r\nContent-Type: message/rfc822\r\n\r\nContent-Type: text/plain\r\n\r\ndeep body\r\n' +
    '--B--\r\n';

test('MimeNode - rfc822Attachments does not leak into nested parsers', async () => {
    // The option decides how this parser classifies its own message/rfc822 parts.
    // A sub-parser must not inherit it, or nested text silently becomes an attachment.
    const email = await PostalMime.parse(NESTED_RFC822_FIXTURE, { rfc822Attachments: true });

    // the inner part has no disposition of its own, so it stays inline
    assert.strictEqual(email.attachments.length, 0);
    assert.ok(email.text.includes('sub body'));
    assert.ok(email.text.includes('deep body'));
});

test('MimeNode - forceRfc822Attachments does not leak into nested parsers', async () => {
    // forceRfc822Attachments applies to the parser it was given to. The outer part
    // is inline, so the sub-parser must classify the inner part on its own.
    const email = await PostalMime.parse(NESTED_RFC822_FIXTURE, { forceRfc822Attachments: true });

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'message/rfc822');
});

test('MimeNode - nesting limits apply inside an inline message/rfc822', async () => {
    // Each sub-message is parsed by its own parser, so the limits bound each
    // sub-message individually rather than the message as a whole.
    const mail =
        'Content-Type: message/rfc822\r\n\r\n' +
        'Content-Type: multipart/mixed; boundary=B\r\n\r\n' +
        '--B\r\nContent-Type: multipart/mixed; boundary=C\r\n\r\n' +
        '--C\r\nContent-Type: text/plain\r\n\r\nsub body\r\n--C--\r\n' +
        '--B--\r\n';

    await assert.rejects(() => PostalMime.parse(mail, { maxNestingDepth: 1 }), /nesting depth/);

    const email = await PostalMime.parse(mail, { maxNestingDepth: 16 });
    assert.ok(email.text.includes('sub body'));
});

test('MimeNode - parse empty headers', async () => {
    const mail = Buffer.from(`
Body with no headers`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email);
});

test('MimeNode - parse header without colon', async () => {
    const mail = Buffer.from(`From: sender@example.com
InvalidHeader
Subject: Test

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject, 'Test');
});

test('MimeNode - parse multiple same headers', async () => {
    const mail = Buffer.from(`Received: from server1
Received: from server2
Received: from server3

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.headers.length >= 3);
    const receivedHeaders = email.headers.filter(h => h.key === 'received');
    assert.strictEqual(receivedHeaders.length, 3);
});

test('MimeNode - parse header with equals in value', async () => {
    const mail = Buffer.from(`X-Equation: E=mc^2

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    const header = email.headers.find(h => h.key === 'x-equation');
    assert.ok(header.value.includes('E=mc^2'));
});

test('MimeNode - parse boundary with special characters', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="--==_Boundary_123"

----==_Boundary_123
Content-Type: text/plain

Part 1
----==_Boundary_123--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('MimeNode - parse parameter with asterisk (RFC2231)', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset*=utf-8''test

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('MimeNode - parse filename from Content-Type name parameter', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf; name="document.pdf"
Content-Disposition: attachment

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].filename, 'document.pdf');
});

test('MimeNode - Content-Disposition filename takes precedence', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf; name="old-name.pdf"
Content-Disposition: attachment; filename="new-name.pdf"

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].filename, 'new-name.pdf');
});

test('MimeNode - parse MIME encoded filename', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="=?utf-8?Q?Caf=C3=A9.pdf?="

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments[0].filename, 'Café.pdf');
});

test('MimeNode - parse multipart/alternative', async () => {
    const mail = Buffer.from(`Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain

Plain text version
--alt
Content-Type: text/html

<p>HTML version</p>
--alt--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
    assert.ok(email.html);
});

test('MimeNode - parse multipart/related', async () => {
    const mail = Buffer.from(`Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: text/html

<p>HTML with image</p>
--rel
Content-Type: image/png
Content-ID: <img1>

ImageData
--rel--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.html);
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].related, true);
});

test('MimeNode - parse calendar event', async () => {
    const mail = Buffer.from(`Content-Type: text/calendar; method=REQUEST

BEGIN:VCALENDAR
END:VCALENDAR`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'text/calendar');
    assert.strictEqual(email.attachments[0].method, 'REQUEST');
});

test('MimeNode - parse text/csv as attachment', async () => {
    const mail = Buffer.from(`Content-Type: text/csv
Content-Disposition: attachment; filename="data.csv"

col1,col2
val1,val2`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, 'data.csv');
});

test('MimeNode - parse text/calendar without disposition as attachment', async () => {
    const mail = Buffer.from(`Content-Type: text/calendar

BEGIN:VCALENDAR
END:VCALENDAR`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
});

// Coverage gap tests
test('MimeNode - parseStructuredHeader with empty param after semicolons', async () => {
    const mail = Buffer.from('Content-Type: text/plain; ;charset=utf-8\r\n\r\nBody');
    const parser = new PostalMime();
    const email = await parser.parse(mail);
    assert.ok(email.text.includes('Body'));
});

test('MimeNode - parseStructuredHeader with key without value', async () => {
    const mail = Buffer.from('Content-Type: text/plain; charset\r\n\r\nBody');
    const parser = new PostalMime();
    const email = await parser.parse(mail);
    assert.ok(email.text.includes('Body'));
});

test('MimeNode - stripComments with unmatched paren', async () => {
    const mail = Buffer.from('From: sender@example.com (Unclosed comment\r\n\r\nBody');
    const parser = new PostalMime();
    const email = await parser.parse(mail);
    assert.ok(email.from);
});

test('MimeNode - getTextContent with no content returns empty', async () => {
    const mail = Buffer.from('Content-Type: text/plain\r\n\r\n');
    const parser = new PostalMime();
    const email = await parser.parse(mail);
    assert.strictEqual(email.text, undefined);
});
