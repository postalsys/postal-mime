import test from 'node:test';
import assert from 'node:assert/strict';
import PostalMime from '../src/postal-mime.js';
import type { ErrorCode, PostalMimeOptions, RawEmail } from '../src/postal-mime.js';

const simple = 'Subject: test\r\n\r\nbody';

function nestMultipart(depth: number): string {
    let mail = 'Content-Type: text/plain\r\n\r\nleaf';
    for (let i = 0; i < depth; i++) {
        mail = `Content-Type: multipart/mixed; boundary=b${i}\r\n\r\n--b${i}\r\n${mail}\r\n--b${i}--\r\n`;
    }
    return mail;
}

const forward =
    'Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: message/rfc822\r\n\r\n' +
    'From: a@x\r\nTo: b@x, c@x\r\nSubject: fwd\r\n\r\nbody\r\n--b--\r\n';

function rejectsWith(code: ErrorCode, name: 'Error' | 'TypeError', buf: RawEmail, options?: PostalMimeOptions) {
    return assert.rejects(
        () => PostalMime.parse(buf, options),
        err => {
            assert.ok(err instanceof Error);
            assert.strictEqual(err.name, name);
            assert.strictEqual((err as { code?: unknown }).code, code);
            return true;
        }
    );
}

test('Errors - invalid limit options are EINVALIDOPTION TypeErrors', async () => {
    for (const option of [
        'maxNestingDepth',
        'maxHeadersSize',
        'maxPartCount',
        'maxRfc822NestingDepth',
        'maxForwardedAddresses'
    ]) {
        await rejectsWith('EINVALIDOPTION', 'TypeError', simple, { [option]: '10' } as PostalMimeOptions);
        await rejectsWith('EINVALIDOPTION', 'TypeError', simple, { [option]: -1 } as PostalMimeOptions);
    }
});

test('Errors - an unknown attachment encoding throws from the constructor', async () => {
    assert.throws(() => new PostalMime({ attachmentEncoding: 'binary' as any }), {
        name: 'TypeError',
        code: 'EINVALIDOPTION'
    });
    await rejectsWith('EINVALIDOPTION', 'TypeError', simple, { attachmentEncoding: 'binary' as any });

    // spelling variants are still accepted
    const email = await PostalMime.parse(simple, { attachmentEncoding: 'Base-64' as any });
    assert.strictEqual(email.subject, 'test');
});

test('Errors - unsupported input types are EINVALIDINPUT TypeErrors', async () => {
    await rejectsWith('EINVALIDINPUT', 'TypeError', 42 as any);
    await rejectsWith('EINVALIDINPUT', 'TypeError', { length: 4 } as any);
    await rejectsWith('EINVALIDINPUT', 'TypeError', [1, 2, 3] as any);

    // empty values still parse to an empty message
    for (const input of [null, undefined, '']) {
        const email = await PostalMime.parse(input as any);
        assert.deepStrictEqual(email.headers, []);
    }
});

test('Errors - a stream with non byte chunks is EINVALIDINPUT and gets cancelled', async () => {
    let cancelReason: unknown;
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue('Subject: text chunk\r\n\r\nbody');
        },
        cancel(reason) {
            cancelReason = reason;
        }
    });
    await rejectsWith('EINVALIDINPUT', 'TypeError', stream as any);
    assert.strictEqual((cancelReason as { code?: unknown }).code, 'EINVALIDINPUT');

    // a source that fails on cancel does not replace the error
    const failing = new ReadableStream({
        start(controller) {
            controller.enqueue(123);
        },
        cancel() {
            throw new Error('cancel failed');
        }
    });
    await rejectsWith('EINVALIDINPUT', 'TypeError', failing as any);
});

test('Errors - streams of byte views of any kind are accepted', async () => {
    const bytes = new TextEncoder().encode('Subject: from stream\r\n\r\nbody');
    const stream = new ReadableStream({
        start(controller) {
            // a view into the middle of a larger buffer, and a DataView
            const padded = new Uint8Array(bytes.length + 8);
            padded.set(bytes.subarray(0, 10), 4);
            controller.enqueue(padded.subarray(4, 14));
            controller.enqueue(new DataView(bytes.buffer, 10));
            controller.close();
        }
    });
    const email = await PostalMime.parse(stream as any);
    assert.strictEqual(email.subject, 'from stream');
});

test('Errors - reusing a parser is EPARSERREUSED', async () => {
    const parser = new PostalMime();
    await parser.parse(simple);
    await assert.rejects(() => parser.parse(simple), { name: 'Error', code: 'EPARSERREUSED' });
});

test('Errors - resource limits have their own codes', async () => {
    await rejectsWith('EMAXNESTINGDEPTH', 'Error', nestMultipart(3), { maxNestingDepth: 2 });
    await rejectsWith('EMAXHEADERSIZE', 'Error', simple, { maxHeadersSize: 10 });
    await rejectsWith('EMAXPARTCOUNT', 'Error', nestMultipart(3), { maxPartCount: 3 });
    await rejectsWith('EMAXFORWARDEDADDRESSES', 'Error', forward, { maxForwardedAddresses: 2 });

    // the same messages parse within the limits
    await PostalMime.parse(nestMultipart(3), { maxNestingDepth: 3, maxPartCount: 4 });
    await PostalMime.parse(forward, { maxForwardedAddresses: 3 });
});
