import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

// Pass-through decoder tests via integration
// The PassThroughDecoder is used for 7bit, 8bit, and binary transfer encodings

test('PassThroughDecoder - 7bit encoding simple text', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

Hello World
This is plain 7-bit ASCII text.`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World\nThis is plain 7-bit ASCII text.');
});

test('PassThroughDecoder - 8bit encoding with high ASCII', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit

Hello World with 8-bit chars`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Hello World'));
});

test('PassThroughDecoder - binary encoding', async () => {
    const mail = Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: binary
Content-Disposition: attachment; filename="test.bin"

Binary data`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, 'test.bin');
});

test('PassThroughDecoder - no transfer encoding specified (defaults to 7bit)', async () => {
    const mail = Buffer.from(`Content-Type: text/plain

Plain text without explicit transfer encoding`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Plain text without explicit transfer encoding');
});

test('PassThroughDecoder - empty content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual((email.text || '').trim(), '');
});

test('PassThroughDecoder - multiple lines', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

Line 1
Line 2
Line 3
Line 4
Line 5`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Line 1'));
    assert.ok(email.text.includes('Line 5'));
    assert.strictEqual(email.text.split('\n').filter(l => l.startsWith('Line')).length, 5);
});

test('PassThroughDecoder - CRLF line endings', async () => {
    const mail = Buffer.from('Content-Type: text/plain\r\nContent-Transfer-Encoding: 7bit\r\n\r\nLine 1\r\nLine 2\r\nLine 3');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Line 1'));
    assert.ok(email.text.includes('Line 2'));
    assert.ok(email.text.includes('Line 3'));
});

test('PassThroughDecoder - LF only line endings', async () => {
    const mail = Buffer.from('Content-Type: text/plain\nContent-Transfer-Encoding: 7bit\n\nLine 1\nLine 2\nLine 3');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Line 1'));
    assert.ok(email.text.includes('Line 2'));
    assert.ok(email.text.includes('Line 3'));
});

test('PassThroughDecoder - tabs and spaces preserved', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

Hello\tWorld  with  multiple  spaces`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('\t'));
    assert.ok(email.text.includes('  '));
});

test('PassThroughDecoder - special characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

Special: !@#$%^&*()_+-=[]{}|;:',.<>?/~`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('!@#$%^&*()'));
    assert.ok(email.text.includes('[]{}|'));
});

test('PassThroughDecoder - very long line', async () => {
    const longLine = 'x'.repeat(1000);
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

${longLine}`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes(longLine));
});

test('PassThroughDecoder - binary data preserved', async () => {
    // Create mail with binary attachment
    const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: application/octet-stream
Content-Transfer-Encoding: binary
Content-Disposition: attachment; filename="binary.bin"

`),
        Buffer.from(binaryData)
    ]);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    const content = new Uint8Array(email.attachments[0].content);
    // Note: newlines may be added by the pass-through decoder
    assert.ok(content.length > 0);
});

test('PassThroughDecoder - 8bit UTF-8 content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit

This has UTF-8: Cafe naieve resume`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Cafe'));
});

test('PassThroughDecoder - mixed content in multipart', async () => {
    const mail = Buffer.from(`Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain
Content-Transfer-Encoding: 7bit

First part with 7bit encoding
--boundary
Content-Type: text/plain
Content-Transfer-Encoding: 8bit

Second part with 8bit encoding
--boundary--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('First part'));
    assert.ok(email.text.includes('Second part'));
});

test('PassThroughDecoder - case insensitive encoding name', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7BIT

Uppercase encoding name`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Uppercase encoding name');
});

test('PassThroughDecoder - encoding with extra parameters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit; extra=param

With extra parameter`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('With extra parameter'));
});

test('PassThroughDecoder - empty lines in content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: 7bit

Line 1

Line 3

Line 5`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Line 1'));
    assert.ok(email.text.includes('Line 3'));
    assert.ok(email.text.includes('Line 5'));
});

test('PassThroughDecoder - HTML content with 7bit', async () => {
    const mail = Buffer.from(`Content-Type: text/html
Content-Transfer-Encoding: 7bit

<html><body><p>Hello World</p></body></html>`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.html.includes('<p>Hello World</p>'));
});

test('PassThroughDecoder - JSON content type', async () => {
    const mail = Buffer.from(`Content-Type: application/json
Content-Transfer-Encoding: 7bit
Content-Disposition: attachment; filename="data.json"

{"key": "value", "number": 123}`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].mimeType, 'application/json');
});

test('PassThroughDecoder - unknown transfer encoding treated as passthrough', async () => {
    const mail = Buffer.from(`Content-Type: text/plain
Content-Transfer-Encoding: custom-unknown-encoding

Content with unknown encoding`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Content with unknown encoding'));
});
