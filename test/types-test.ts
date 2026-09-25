import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime, { addressParser, decodeWords } from '../src/postal-mime.js';
import type {
    RawEmail,
    Email,
    Address,
    AddressGroup,
    Mailbox,
    Header,
    HeaderLine,
    Attachment,
    AttachmentEncoding,
    PostalMimeOptions,
    AddressParserOptions
} from '../src/postal-mime.js';

/**
 * Type checks of the public API against src/. The suite runs through tsx, which strips
 * types instead of checking them, so `npm run lint` type-checks this file with tsc, and
 * the assertions below only keep the values in use. test/package-test.ts checks the
 * built declarations the same way, including a sweep for optional properties that lack
 * `| undefined`.
 */

// Type guard for Address
function isMailbox(addr: Address): addr is Mailbox {
    return addr.group === undefined;
}

test('Types - every documented input type is a RawEmail', () => {
    const inputs: RawEmail[] = [
        'string',
        Buffer.from('test'),
        new Uint8Array(),
        new ArrayBuffer(0),
        new DataView(new ArrayBuffer(0)),
        new Blob(['test']),
        new ReadableStream<Uint8Array>()
    ];
    assert.strictEqual(inputs.length, 7);
});

test('Types - result objects can be built by hand', () => {
    const header: Header = { key: 'subject', originalKey: 'Subject', value: 'Test' };
    const headerLine: HeaderLine = { key: 'subject', line: 'Subject: Test' };
    const mailbox: Mailbox = { name: 'John', address: 'john@example.com' };
    const group: AddressGroup = { name: 'Team', group: [mailbox] };
    const addresses: Address[] = [mailbox, group];

    const attachment: Attachment = {
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        disposition: 'attachment',
        content: new ArrayBuffer(0)
    };

    const encoded: Attachment = {
        filename: null,
        mimeType: 'text/plain',
        disposition: null,
        content: 'SGVsbG8=',
        encoding: 'base64',
        related: undefined,
        rfc822DepthExceeded: undefined
    };

    const email: Email = {
        headers: [header],
        headerLines: [headerLine],
        attachments: [attachment, encoded],
        from: mailbox,
        to: addresses,
        date: undefined
    };

    assert.strictEqual(email.attachments.length, 2);
    assert.strictEqual(email.to?.length, 2);
});

test('Types - parse results narrow as documented', async () => {
    const encoding: AttachmentEncoding = 'base64';
    const options: PostalMimeOptions = { attachmentEncoding: encoding, maxNestingDepth: 100 };
    const addressOptions: AddressParserOptions = { flatten: true };
    assert.deepStrictEqual(addressParser('Team: a@example.com;', addressOptions), [
        { address: 'a@example.com', name: '' }
    ]);
    const email: Email = await PostalMime.parse(
        'From: Team: a@example.com;\nTo: b@example.com\nSubject: Hi\n\nBody',
        options
    );
    const viaInstance: Email = await new PostalMime(options).parse(Buffer.from('Subject: Hi\n\nBody'));
    assert.strictEqual(viaInstance.subject, 'Hi');

    // Optional fields
    if (email.subject !== undefined) {
        const subject: string = email.subject;
        assert.strictEqual(subject, 'Hi');
    }

    // Address type narrowing
    assert.ok(email.from);
    if (isMailbox(email.from)) {
        const addr: string = email.from.address;
        assert.fail('expected a group, got ' + addr);
    } else {
        const members: Mailbox[] = email.from.group;
        assert.strictEqual(members[0].address, 'a@example.com');
    }

    // Array handling
    assert.ok(email.to);
    email.to.forEach(addr => {
        if (isMailbox(addr)) {
            assert.strictEqual(addr.address, 'b@example.com');
        } else {
            addr.group.forEach(m => assert.ok(m.address));
        }
    });

    // Attachment encoding
    email.attachments.forEach(att => {
        if (att.encoding === 'base64' || att.encoding === 'utf8') {
            const str: string = att.content as string;
            assert.strictEqual(typeof str, 'string');
        }
    });

    // Required fields
    const headers: Header[] = email.headers;
    const headerLines: HeaderLine[] = email.headerLines;
    const attachments: Attachment[] = email.attachments;
    assert.strictEqual(headers.length, headerLines.length);
    assert.strictEqual(attachments.length, 0);

    const decoded: string = decodeWords('=?utf-8?Q?caf=C3=A9?=');
    assert.strictEqual(decoded, 'café');
});
