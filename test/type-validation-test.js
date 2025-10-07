import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

/**
 * Runtime type validation - verifies actual output matches type definitions
 */

function validateHeader(header, context = 'Header') {
    assert.strictEqual(typeof header, 'object', `${context} must be object`);
    assert.strictEqual(typeof header.key, 'string', `${context}.key must be string`);
    assert.strictEqual(typeof header.value, 'string', `${context}.value must be string`);
}

function validateMailbox(mailbox, context = 'Mailbox') {
    assert.strictEqual(typeof mailbox, 'object', `${context} must be object`);
    assert.strictEqual(typeof mailbox.name, 'string', `${context}.name must be string`);
    assert.strictEqual(typeof mailbox.address, 'string', `${context}.address must be string`);
    assert.strictEqual(mailbox.group, undefined, `${context}.group must be undefined`);
}

function validateAddressGroup(group, context = 'AddressGroup') {
    assert.strictEqual(typeof group, 'object', `${context} must be object`);
    assert.strictEqual(typeof group.name, 'string', `${context}.name must be string`);
    assert.strictEqual(group.address, undefined, `${context}.address must be undefined`);
    assert.ok(Array.isArray(group.group), `${context}.group must be array`);
    group.group.forEach((m, i) => validateMailbox(m, `${context}.group[${i}]`));
}

function validateAddress(addr, context = 'Address') {
    assert.strictEqual(typeof addr, 'object', `${context} must be object`);
    if (addr.group !== undefined) {
        validateAddressGroup(addr, context);
    } else {
        validateMailbox(addr, context);
    }
}

function validateAttachment(att, context = 'Attachment') {
    assert.strictEqual(typeof att, 'object', `${context} must be object`);
    assert.ok(typeof att.filename === 'string' || att.filename === null, `${context}.filename must be string or null`);
    assert.strictEqual(typeof att.mimeType, 'string', `${context}.mimeType must be string`);
    assert.ok(
        att.disposition === 'attachment' || att.disposition === 'inline' || att.disposition === null,
        `${context}.disposition must be "attachment", "inline", or null`
    );
    assert.ok(
        att.content instanceof ArrayBuffer || typeof att.content === 'string',
        `${context}.content must be ArrayBuffer or string`
    );

    if (att.related !== undefined) {
        assert.strictEqual(typeof att.related, 'boolean', `${context}.related must be boolean`);
    }
    if (att.description !== undefined) {
        assert.strictEqual(typeof att.description, 'string', `${context}.description must be string`);
    }
    if (att.contentId !== undefined) {
        assert.strictEqual(typeof att.contentId, 'string', `${context}.contentId must be string`);
    }
    if (att.method !== undefined) {
        assert.strictEqual(typeof att.method, 'string', `${context}.method must be string`);
    }
    if (att.encoding !== undefined) {
        assert.ok(
            att.encoding === 'base64' || att.encoding === 'utf8',
            `${context}.encoding must be "base64" or "utf8"`
        );
    }
}

function validateEmail(email) {
    assert.strictEqual(typeof email, 'object', 'Email must be object');

    // Required fields
    assert.ok(Array.isArray(email.headers), 'Email.headers must be array');
    email.headers.forEach((h, i) => validateHeader(h, `Email.headers[${i}]`));

    assert.ok(Array.isArray(email.attachments), 'Email.attachments must be array');
    email.attachments.forEach((a, i) => validateAttachment(a, `Email.attachments[${i}]`));

    // Optional fields
    if (email.from !== undefined) validateAddress(email.from, 'Email.from');
    if (email.sender !== undefined) validateAddress(email.sender, 'Email.sender');
    if (email.replyTo !== undefined) {
        assert.ok(Array.isArray(email.replyTo), 'Email.replyTo must be array');
        email.replyTo.forEach((a, i) => validateAddress(a, `Email.replyTo[${i}]`));
    }
    if (email.to !== undefined) {
        assert.ok(Array.isArray(email.to), 'Email.to must be array');
        email.to.forEach((a, i) => validateAddress(a, `Email.to[${i}]`));
    }
    if (email.cc !== undefined) {
        assert.ok(Array.isArray(email.cc), 'Email.cc must be array');
        email.cc.forEach((a, i) => validateAddress(a, `Email.cc[${i}]`));
    }
    if (email.bcc !== undefined) {
        assert.ok(Array.isArray(email.bcc), 'Email.bcc must be array');
        email.bcc.forEach((a, i) => validateAddress(a, `Email.bcc[${i}]`));
    }
    if (email.deliveredTo !== undefined) {
        assert.strictEqual(typeof email.deliveredTo, 'string', 'Email.deliveredTo must be string');
    }
    if (email.returnPath !== undefined) {
        assert.strictEqual(typeof email.returnPath, 'string', 'Email.returnPath must be string');
    }
    if (email.subject !== undefined) {
        assert.strictEqual(typeof email.subject, 'string', 'Email.subject must be string');
    }
    if (email.messageId !== undefined) {
        assert.strictEqual(typeof email.messageId, 'string', 'Email.messageId must be string');
    }
    if (email.inReplyTo !== undefined) {
        assert.strictEqual(typeof email.inReplyTo, 'string', 'Email.inReplyTo must be string');
    }
    if (email.references !== undefined) {
        assert.strictEqual(typeof email.references, 'string', 'Email.references must be string');
    }
    if (email.date !== undefined) {
        assert.strictEqual(typeof email.date, 'string', 'Email.date must be string');
    }
    if (email.html !== undefined) {
        assert.strictEqual(typeof email.html, 'string', 'Email.html must be string');
    }
    if (email.text !== undefined) {
        assert.strictEqual(typeof email.text, 'string', 'Email.text must be string');
    }
}

test('Type validation - basic email', async () => {
    const parser = new PostalMime();
    const email = await parser.parse('Subject: Test\n\nBody');
    validateEmail(email);
});

test('Type validation - full email with all fields', async () => {
    const mail = Buffer.from(`From: Sender <sender@example.com>
To: recipient@example.com
Subject: Test
Date: Mon, 01 Jan 2024 00:00:00 +0000
Message-ID: <msg@example.com>
Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain

Text
--b
Content-Type: application/pdf
Content-Disposition: attachment; filename="test.pdf"

Data
--b--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);
    validateEmail(email);

    assert.ok(email.from);
    assert.ok(email.to);
    assert.ok(email.subject);
    assert.ok(email.date);
    assert.ok(email.messageId);
    assert.ok(email.text);
    assert.strictEqual(email.attachments.length, 1);
});

test('Type validation - address groups', async () => {
    const parser = new PostalMime();
    const email = await parser.parse('To: Team: member@example.com;\n\nBody');
    validateEmail(email);
});

test('Type validation - attachment encoding options', async () => {
    const mail = 'Content-Type: application/pdf\nContent-Disposition: attachment\n\nData';

    const parser1 = new PostalMime({ attachmentEncoding: 'base64' });
    const email1 = await parser1.parse(mail);
    validateEmail(email1);
    assert.strictEqual(email1.attachments[0].encoding, 'base64');
    assert.strictEqual(typeof email1.attachments[0].content, 'string');

    const parser2 = new PostalMime({ attachmentEncoding: 'utf8' });
    const email2 = await parser2.parse(mail);
    validateEmail(email2);
    assert.strictEqual(email2.attachments[0].encoding, 'utf8');
    assert.strictEqual(typeof email2.attachments[0].content, 'string');

    const parser3 = new PostalMime();
    const email3 = await parser3.parse(mail);
    validateEmail(email3);
    assert.ok(email3.attachments[0].content instanceof ArrayBuffer);
});

test('Type validation - static parse method', async () => {
    const email = await PostalMime.parse('Subject: Test\n\nBody');
    validateEmail(email);
});

test('Type validation - input as string', async () => {
    const parser = new PostalMime();
    const email = await parser.parse('Subject: Test\n\nBody');
    validateEmail(email);
});

test('Type validation - input as Buffer', async () => {
    const parser = new PostalMime();
    const email = await parser.parse(Buffer.from('Subject: Test\n\nBody'));
    validateEmail(email);
});

test('Type validation - input as Uint8Array', async () => {
    const parser = new PostalMime();
    const email = await parser.parse(new TextEncoder().encode('Subject: Test\n\nBody'));
    validateEmail(email);
});

test('Type validation - input as ArrayBuffer', async () => {
    const parser = new PostalMime();
    const email = await parser.parse(new TextEncoder().encode('Subject: Test\n\nBody').buffer);
    validateEmail(email);
});

test('Type validation - input as ReadableStream', async () => {
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('Subject: Test\n\nBody'));
            controller.close();
        }
    });
    const parser = new PostalMime();
    const email = await parser.parse(stream);
    validateEmail(email);
});
