import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

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

    assert.ok(email.text.includes('--boundary'));
    assert.ok(email.text.includes('Another part'));
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
    assert.ok(email.text.includes('Real part'));
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

    assert.ok(email.text.includes('----boundary'));
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

    assert.ok(email.text.includes('--boundary in middle'));
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

    assert.ok(email.text.includes('x'));
});

test('Edge case - line with only spaces', async () => {
    const mail = Buffer.from(`Content-Type: text/plain

Line 1

Line 3`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Line 1'));
    assert.ok(email.text.includes('Line 3'));
});

test('Edge case - CRLF and LF mixed', async () => {
    const mail = Buffer.from('Content-Type: text/plain\r\n\nLine 1\nLine 2\r\nLine 3');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Line 1'));
    assert.ok(email.text.includes('Line 2'));
    assert.ok(email.text.includes('Line 3'));
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

    assert.ok(email.text.includes('Hello'));
    assert.ok(email.text.includes('World'));
});

test('Edge case - 7bit encoding', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

Plain text`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Plain text');
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
        assert.ok(err.message.includes('reuse'));
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
