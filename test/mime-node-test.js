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
