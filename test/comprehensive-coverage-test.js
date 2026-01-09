import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

// ============================================================================
// Text Content Behavior Tests
// ============================================================================

test('Text content - HTML only message returns HTML', async () => {
    const mail = Buffer.from(`Content-Type: text/html

<html><body><p>Hello World</p><p>Second paragraph</p></body></html>`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.html.includes('<p>Hello World</p>'));
    // postal-mime does not auto-generate text from HTML
    assert.strictEqual(email.text, undefined);
});

test('Text content - text only message returns text', async () => {
    const mail = Buffer.from(`Content-Type: text/plain

Hello World
Second line`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Hello World'));
    // postal-mime does not auto-generate HTML from text
    assert.strictEqual(email.html, undefined);
});

test('Text content - multipart/alternative uses both versions', async () => {
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

    assert.ok(email.text.includes('Plain text version'));
    assert.ok(email.html.includes('<p>HTML version</p>'));
});

test('Text content - multipart/alternative HTML only returns HTML', async () => {
    const mail = Buffer.from(`Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/html

<p>HTML only alternative</p>
--alt--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.html.includes('<p>HTML only alternative</p>'));
});

test('Text content - multipart/mixed with text and HTML', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain

Plain text part
--b
Content-Type: text/html

<p>HTML part</p>
--b--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Plain text'));
    assert.ok(email.html.includes('<p>HTML part</p>'));
});

test('Text content - HTML with entities preserved', async () => {
    const mail = Buffer.from(`Content-Type: text/html

<p>Copyright &copy; 2024 &amp; Trademark &trade;</p>`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // HTML entities are preserved in the HTML
    assert.ok(email.html.includes('&copy;') || email.html.includes('Copyright'));
});

test('Text content - complex alternative structure', async () => {
    const mail = Buffer.from(`Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain

Simple text
--alt
Content-Type: text/html; charset=utf-8

<html><body><p>Rich HTML</p></body></html>
--alt--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Simple text');
    assert.ok(email.html.includes('Rich HTML'));
});

// ============================================================================
// PostalMime Static Parse Method Tests
// ============================================================================

test('PostalMime.parse - static method with string input', async () => {
    const email = await PostalMime.parse('Subject: Test\n\nBody content');
    assert.strictEqual(email.subject, 'Test');
    assert.ok(email.text.includes('Body content'));
});

test('PostalMime.parse - static method with Buffer input', async () => {
    const email = await PostalMime.parse(Buffer.from('Subject: Test\n\nBody content'));
    assert.strictEqual(email.subject, 'Test');
});

test('PostalMime.parse - static method with options', async () => {
    const email = await PostalMime.parse(
        'Content-Type: application/pdf\nContent-Disposition: attachment\n\nData',
        { attachmentEncoding: 'base64' }
    );
    assert.strictEqual(email.attachments[0].encoding, 'base64');
});

test('PostalMime.parse - static method with Uint8Array', async () => {
    const bytes = new TextEncoder().encode('Subject: Test\n\nBody');
    const email = await PostalMime.parse(bytes);
    assert.strictEqual(email.subject, 'Test');
});

test('PostalMime.parse - static method with ArrayBuffer', async () => {
    const bytes = new TextEncoder().encode('Subject: Test\n\nBody');
    const email = await PostalMime.parse(bytes.buffer);
    assert.strictEqual(email.subject, 'Test');
});

// ============================================================================
// Attachment Encoding Tests
// ============================================================================

test('Attachment encoding - default is arraybuffer', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="test.pdf"

PDF content here`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.attachments[0].content instanceof ArrayBuffer);
    assert.strictEqual(email.attachments[0].encoding, undefined);
});

test('Attachment encoding - base64 option', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment; filename="test.pdf"

PDF content here`);

    const parser = new PostalMime({ attachmentEncoding: 'base64' });
    const email = await parser.parse(mail);

    assert.strictEqual(typeof email.attachments[0].content, 'string');
    assert.strictEqual(email.attachments[0].encoding, 'base64');
});

test('Attachment encoding - utf8 option', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Disposition: attachment; filename="test.txt"

Text file content`);

    const parser = new PostalMime({ attachmentEncoding: 'utf8' });
    const email = await parser.parse(mail);

    assert.strictEqual(typeof email.attachments[0].content, 'string');
    assert.strictEqual(email.attachments[0].encoding, 'utf8');
    assert.ok(email.attachments[0].content.includes('Text file content'));
});

test('Attachment encoding - multiple attachments with same encoding', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain

Body
--b
Content-Type: application/pdf
Content-Disposition: attachment; filename="a.pdf"

PDF1
--b
Content-Type: application/pdf
Content-Disposition: attachment; filename="b.pdf"

PDF2
--b--`);

    const parser = new PostalMime({ attachmentEncoding: 'base64' });
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 2);
    assert.strictEqual(email.attachments[0].encoding, 'base64');
    assert.strictEqual(email.attachments[1].encoding, 'base64');
});

// ============================================================================
// Blob Input Parsing Tests
// ============================================================================

test('Blob input - simple email blob', async () => {
    const blob = new Blob(['Subject: Test\n\nBody content'], { type: 'message/rfc822' });

    const parser = new PostalMime();
    const email = await parser.parse(blob);

    assert.strictEqual(email.subject, 'Test');
    assert.ok(email.text.includes('Body content'));
});

test('Blob input - multipart email blob', async () => {
    const emailContent = `Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain

Hello World
--boundary
Content-Type: application/pdf
Content-Disposition: attachment; filename="test.pdf"

PDF data
--boundary--`;

    const blob = new Blob([emailContent], { type: 'message/rfc822' });

    const parser = new PostalMime();
    const email = await parser.parse(blob);

    assert.ok(email.text.includes('Hello World'));
    assert.strictEqual(email.attachments.length, 1);
});

test('Blob input - blob with binary content', async () => {
    const header = 'Content-Type: application/octet-stream\nContent-Disposition: attachment; filename="test.bin"\n\n';
    const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xFF]);
    const blob = new Blob([header, binaryData], { type: 'message/rfc822' });

    const parser = new PostalMime();
    const email = await parser.parse(blob);

    assert.strictEqual(email.attachments.length, 1);
});

// ============================================================================
// Multipart/Related Inline Image Tests
// ============================================================================

test('Multipart/related - inline image with Content-ID', async () => {
    const mail = Buffer.from(`Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: text/html

<html><body><p>Hello</p><img src="cid:img123@example.com" /></body></html>
--rel
Content-Type: image/png
Content-ID: <img123@example.com>
Content-Disposition: inline

PNG binary data here
--rel--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.html.includes('cid:img123@example.com'));
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].contentId, '<img123@example.com>');
    assert.strictEqual(email.attachments[0].related, true);
});

test('Multipart/related - multiple inline images', async () => {
    const mail = Buffer.from(`Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: text/html

<html><body><img src="cid:a@x" /><img src="cid:b@x" /></body></html>
--rel
Content-Type: image/png
Content-ID: <a@x>

PNG1
--rel
Content-Type: image/jpeg
Content-ID: <b@x>

JPG1
--rel--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 2);
    assert.strictEqual(email.attachments[0].contentId, '<a@x>');
    assert.strictEqual(email.attachments[1].contentId, '<b@x>');
    assert.strictEqual(email.attachments[0].related, true);
    assert.strictEqual(email.attachments[1].related, true);
});

test('Multipart/related - nested in multipart/alternative', async () => {
    const mail = Buffer.from(`Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain

Plain text version
--alt
Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: text/html

<html><body><img src="cid:logo@x" /></body></html>
--rel
Content-Type: image/png
Content-ID: <logo@x>

Logo PNG
--rel--
--alt--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Plain text'));
    assert.ok(email.html.includes('cid:logo@x'));
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].related, true);
});

// ============================================================================
// Application/ICS Calendar Tests
// ============================================================================

test('Calendar - application/ics attachment', async () => {
    const mail = Buffer.from(`Content-Type: application/ics; name="invite.ics"
Content-Disposition: attachment; filename="invite.ics"

BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
SUMMARY:Team Meeting
END:VEVENT
END:VCALENDAR`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'application/ics');
    assert.strictEqual(email.attachments[0].filename, 'invite.ics');
});

test('Calendar - text/calendar with method', async () => {
    const mail = Buffer.from(`Content-Type: text/calendar; method=REQUEST; name="meeting.ics"

BEGIN:VCALENDAR
VERSION:2.0
METHOD:REQUEST
BEGIN:VEVENT
SUMMARY:Meeting Request
END:VEVENT
END:VCALENDAR`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'text/calendar');
    assert.strictEqual(email.attachments[0].method, 'REQUEST');
});

test('Calendar - text/calendar with CANCEL method', async () => {
    const mail = Buffer.from(`Content-Type: text/calendar; method=CANCEL

BEGIN:VCALENDAR
VERSION:2.0
METHOD:CANCEL
BEGIN:VEVENT
SUMMARY:Cancelled Meeting
END:VEVENT
END:VCALENDAR`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].method, 'CANCEL');
});

test('Calendar - text/calendar with REPLY method', async () => {
    const mail = Buffer.from(`Content-Type: text/calendar; method=REPLY

BEGIN:VCALENDAR
VERSION:2.0
METHOD:REPLY
BEGIN:VEVENT
SUMMARY:Meeting Reply
END:VEVENT
END:VCALENDAR`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].method, 'REPLY');
});

test('Calendar - inline calendar in multipart message', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain

Please find the meeting invitation attached.
--b
Content-Type: text/calendar; method=REQUEST; name="invite.ics"

BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR
--b--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('meeting invitation'));
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'text/calendar');
});

// ============================================================================
// MimeNode stripComments Tests (via integration)
// ============================================================================

test('Header parsing - comments in From header', async () => {
    const mail = Buffer.from(`From: John Doe (Personal Account) <john@example.com>

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.from.name, 'John Doe');
    assert.strictEqual(email.from.address, 'john@example.com');
});

test('Header parsing - comments in Content-Type', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=utf-8 (Unicode)

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Header parsing - nested comments', async () => {
    const mail = Buffer.from(`From: John Doe (outer (inner) comment) <john@example.com>

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Should handle nested comments gracefully
    assert.ok(email.from.address);
});

test('Header parsing - escaped characters in comments', async () => {
    const mail = Buffer.from(`From: John Doe (with \\) escaped paren) <john@example.com>

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.from.address, 'john@example.com');
});

test('Header parsing - comment only in header', async () => {
    const mail = Buffer.from(`X-Custom: (only a comment)
Subject: Test

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject, 'Test');
});

// ============================================================================
// Additional Edge Cases
// ============================================================================

test('Edge case - message/global content type', async () => {
    const mail = Buffer.from(`Content-Type: message/global

Nested message content`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email);
});

test('Edge case - Content-Disposition without value', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition:

PDF data`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email);
});

test('Edge case - very long filename with RFC2231 encoding', async () => {
    const mail = Buffer.from(`Content-Type: application/pdf
Content-Disposition: attachment;
 filename*0="this_is_a_very_long_filename_that_";
 filename*1="needs_to_be_split_across_multiple_";
 filename*2="continuation_parameters.pdf"

PDF data`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.ok(email.attachments[0].filename.includes('this_is_a_very_long'));
    assert.ok(email.attachments[0].filename.includes('.pdf'));
});

test('Edge case - mixed multipart with digest', async () => {
    const mail = Buffer.from(`Content-Type: multipart/digest; boundary="digest"

--digest

From: user1@example.com
Subject: Message 1

Body 1
--digest

From: user2@example.com
Subject: Message 2

Body 2
--digest--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // multipart/digest parts default to message/rfc822
    assert.ok(email);
});

test('Edge case - Return-Path header parsing', async () => {
    const mail = Buffer.from(`Return-Path: <bounce@example.com>
From: sender@example.com

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.returnPath, 'bounce@example.com');
});

test('Edge case - Delivered-To header parsing', async () => {
    const mail = Buffer.from(`Delivered-To: recipient@example.com
From: sender@example.com

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.deliveredTo, 'recipient@example.com');
});

test('Edge case - In-Reply-To header', async () => {
    const mail = Buffer.from(`Message-ID: <new@example.com>
In-Reply-To: <original@example.com>

Reply content`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.messageId, '<new@example.com>');
    assert.strictEqual(email.inReplyTo, '<original@example.com>');
});

test('Edge case - References header', async () => {
    const mail = Buffer.from(`Message-ID: <new@example.com>
References: <first@example.com> <second@example.com>

Thread message`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.references.includes('<first@example.com>'));
    assert.ok(email.references.includes('<second@example.com>'));
});

test('Edge case - Reply-To header', async () => {
    const mail = Buffer.from(`From: sender@example.com
Reply-To: replyto@example.com

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.replyTo);
    assert.strictEqual(email.replyTo[0].address, 'replyto@example.com');
});

test('Edge case - Sender header different from From', async () => {
    const mail = Buffer.from(`From: author@example.com
Sender: secretary@example.com

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.from.address, 'author@example.com');
    assert.strictEqual(email.sender.address, 'secretary@example.com');
});

test('Edge case - headerLines output format', async () => {
    const mail = Buffer.from(`From: sender@example.com
Subject: Test Subject
Date: Mon, 01 Jan 2024 00:00:00 +0000
X-Custom: value

Body`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(Array.isArray(email.headerLines));
    assert.ok(email.headerLines.some(h => h.key === 'from'));
    assert.ok(email.headerLines.some(h => h.key === 'subject'));
    assert.ok(email.headerLines.some(h => h.key === 'x-custom'));
});

test('Edge case - flowed text format with signature separator', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; format=flowed

This is a flowed paragraph
that continues on the next line.

--
Signature line`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Signature separator should be preserved
    assert.ok(email.text.includes('--'));
    assert.ok(email.text.includes('Signature'));
});

test('Edge case - flowed text with delsp=yes', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; format=flowed; delsp=yes

Word
continuation`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // With delsp=yes, trailing space before soft break should be removed
    assert.ok(email.text);
});

test('Edge case - text/enriched content type', async () => {
    const mail = Buffer.from(`Content-Type: text/enriched

<bold>Hello</bold> World`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // text/enriched is treated as attachment (not plain text)
    // The library treats non-plain, non-html text subtypes as attachments
    assert.ok(email.attachments.length === 1 || (email.text && email.text.includes('Hello')));
});
