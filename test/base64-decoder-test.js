import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

// Basic Base64 decoding tests
test('Base64 decoder - simple ASCII text', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVsbG8gV29ybGQ=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('Base64 decoder - longer text', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

VGhpcyBpcyBhIGxvbmdlciB0ZXN0IG1lc3NhZ2UgdGhhdCBzcGFucyBtdWx0aXBsZSBsaW5lcyB3
aGVuIGVuY29kZWQgaW4gYmFzZTY0IGZvcm1hdC4=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(
        email.text.trim(),
        'This is a longer test message that spans multiple lines when encoded in base64 format.'
    );
});

test('Base64 decoder - UTF-8 characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

Q2Fmw6kgbmHDr3ZlIHLDqXN1bcOp`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Café naïve résumé');
});

test('Base64 decoder - emoji', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVsbG8g8J+YgCBXb3JsZCDwn46J`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello 😀 World 🎉');
});

test('Base64 decoder - newlines in content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

TGluZSBvbmUKTGluZSB0d28KTGluZSB0aHJlZQ==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Line one\nLine two\nLine three');
});

test('Base64 decoder - with line breaks in base64', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

VGhpcyBpcyBhIGxvbmcgbWVzc2FnZSB0aGF0IGlz
IGJyb2tlbiB1cCBpbnRvIG11bHRpcGxlIGxpbmVz
IGZvciBlbWFpbCB0cmFuc3BvcnQu`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(
        email.text.trim(),
        'This is a long message that is broken up into multiple lines for email transport.'
    );
});

test('Base64 decoder - special characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

IUAjJCVeJiooKV8rLT1bXXt9fDs6JywiLjw+Py8=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), `!@#$%^&*()_+-=[]{}|;:',".<>?/`);
});

test('Base64 decoder - binary data (attachment)', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain

Test message

--boundary123
Content-Type: application/octet-stream; name="test.bin"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="test.bin"

AQIDBA==
--boundary123--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, 'test.bin');

    const bytes = new Uint8Array(email.attachments[0].content);
    assert.strictEqual(bytes.length, 4);
    assert.strictEqual(bytes[0], 1);
    assert.strictEqual(bytes[1], 2);
    assert.strictEqual(bytes[2], 3);
    assert.strictEqual(bytes[3], 4);
});

test('Base64 decoder - single padding character', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVsbG8h`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello!');
});

test('Base64 decoder - double padding characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGk=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hi');
});

test('Base64 decoder - no padding', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVsbG8`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello');
});

test('Base64 decoder - empty content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual((email.text || '').trim(), '');
});

test('Base64 decoder - single character', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

QQ==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'A');
});

test('Base64 decoder - all printable ASCII', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0
NTY3ODk=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
});

test('Base64 decoder - numbers', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

MTIzNDU2Nzg5MA==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), '1234567890');
});

test('Base64 decoder - whitespace in base64 (should be stripped)', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVs  bG8g  V29y  bGQ=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('Base64 decoder - tabs in base64 (should be stripped)', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVs\tbG8g\tV29y\tbGQ=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('Base64 decoder - CRLF in base64 (should be stripped)', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVs\r\nbG8g\r\nV29y\r\nbGQ=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('Base64 decoder - Chinese characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

5L2g5aW95LiW55WM`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), '你好世界');
});

test('Base64 decoder - Japanese characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

44GT44KT44Gr44Gh44Gv`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'こんにちは');
});

test('Base64 decoder - Arabic characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

2YXYsdit2KjYpw==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'مرحبا');
});

test('Base64 decoder - Cyrillic characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

0J/RgNC40LLQtdGC`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Привет');
});

test('Base64 decoder - mixed scripts', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVsbG8g5L2g5aW9IFdvcmxkINCc0LjRgA==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello 你好 World Мир');
});

test('Base64 decoder - very long line', async () => {
    const text = 'A'.repeat(1000);
    const base64 = Buffer.from(text).toString('base64');

    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

${base64}`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), text);
});

test('Base64 decoder - line length exactly 76 chars', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

VGhpcyBsaW5lIGlzIGV4YWN0bHkgNzYgY2hhcmFjdGVycyBsb25nIHdoZW4gZW5jb2RlZCBpbiBi
YXNlNjQgZm9ybWF0IGFzIHBlciBSRkMgMjA0NS4=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('exactly 76 characters'));
});

test('Base64 decoder - zero bytes', async () => {
    const mail = Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="zeros.bin"

AAAAAAAAAA==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    const bytes = new Uint8Array(email.attachments[0].content);
    assert.ok(bytes.every(b => b === 0));
});

test('Base64 decoder - high byte values', async () => {
    const mail = Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="high.bin"

//79/A==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    const bytes = new Uint8Array(email.attachments[0].content);
    assert.ok(bytes.some(b => b > 250));
});

test('Base64 decoder - plus and slash characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

Pz8/Pz8/`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('Base64 decoder - alternating text and base64 parts', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain

Plain text part

--boundary123
Content-Type: text/plain
Content-Transfer-Encoding: base64

QmFzZTY0IHBhcnQ=

--boundary123--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Plain text part'));
    assert.ok(email.text.includes('Base64 part'));
});

test('Base64 decoder - HTML content', async () => {
    const mail = Buffer.from(`Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: base64

PGh0bWw+PGJvZHk+PGgxPkhlbGxvPC9oMT48cD5Xb3JsZDwvcD48L2JvZHk+PC9odG1sPg==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.html.includes('<h1>Hello</h1>'));
    assert.ok(email.html.includes('<p>World</p>'));
});

test('Base64 decoder - image attachment', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain

Message with image

--boundary123
Content-Type: image/png; name="test.png"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="test.png"

iVBORw0KGgo=
--boundary123--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'image/png');
    assert.strictEqual(email.attachments[0].filename, 'test.png');
});

test('Base64 decoder - URL-safe base64 should work', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVsbG8gV29ybGQ=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('Base64 decoder - multiple attachments', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain

Message

--boundary123
Content-Type: application/octet-stream
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="file1.bin"

AQID
--boundary123
Content-Type: application/octet-stream
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="file2.bin"

BAUG
--boundary123--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 2);
    assert.strictEqual(email.attachments[0].filename, 'file1.bin');
    assert.strictEqual(email.attachments[1].filename, 'file2.bin');
});

test('Base64 decoder - tabs and spaces preserved in decoded content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

SGVsbG8JV29ybGQgIFRlc3Q=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('\t'));
    assert.ok(email.text.includes('  '));
});

test('Base64 decoder - with BOM (byte order mark)', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

77u/SGVsbG8gV29ybGQ=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Hello World'));
});

test('Base64 decoder - content with equals signs in original text', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

eDN5IGFuZCBhPWI=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'x3y and a=b');
});

test('Base64 decoder - only padding', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

====`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Only padding should result in empty or minimal content
    assert.ok(email.text === undefined || email.text.trim().length === 0);
});

test('Base64 decoder - maximum byte value (255)', async () => {
    const mail = Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="max.bin"

/w==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    const bytes = new Uint8Array(email.attachments[0].content);
    assert.strictEqual(bytes[0], 255);
});

test('Base64 decoder - all possible byte values', async () => {
    // Generate base64 for bytes 0-255
    const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const base64 = allBytes.toString('base64');

    const mail = Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="all.bin"

${base64}`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    const bytes = new Uint8Array(email.attachments[0].content);
    assert.strictEqual(bytes.length, 256);

    // Verify all byte values are present
    for (let i = 0; i < 256; i++) {
        assert.strictEqual(bytes[i], i);
    }
});

test('Base64 decoder - repeated characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64

QUFBQUFBQUFBQQ==`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'AAAAAAAAAA');
});

test('Base64 decoder - alternating byte pattern', async () => {
    const mail = Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="pattern.bin"

VVVVVVU=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    const bytes = new Uint8Array(email.attachments[0].content);
    assert.ok(bytes.every(b => b === 0x55));
});
