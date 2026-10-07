import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import MailComposer from 'nodemailer/lib/mail-composer';
import PostalMime from '../src/postal-mime.js';
import { attachmentBytes, createRandom, pick } from './helpers.js';

// Round trips. Messages are built by Nodemailer, an independent encoder, and parsed back,
// and what went in has to come out whatever transfer encoding, line ending and header
// encoding the composer picked. The fixtures test the decoders on messages written by
// hand, this tests them against an encoder that makes its own choices.

type MailOptions = ConstructorParameters<typeof MailComposer>[0];

async function roundTrip(mail: MailOptions) {
    const raw = await new MailComposer(mail).compile().build();
    return { raw, email: await PostalMime.parse(raw) };
}

const SUBJECT = 'Tere, maailm! Привет, мир! こんにちは世界 😀 ' + 'x'.repeat(40) + ' end';

const TEXT = [
    'Plain text with trailing space ',
    'tabs\tand = signs, =3D stays literal',
    'a long line that has to be soft wrapped ' + 'word '.repeat(40) + 'end',
    'Ümlauts äöü, õ, ß, ellipsis … and “curly quotes”',
    '',
    '-- ',
    'signature'
].join('\n');

const HTML = '<p>Hello <b>world</b> ümlauts &amp; entities</p>\n<p>😀 second paragraph</p>';

const LONG_FILENAME = 'Отчёт за 2026 год, very long file name with spaces and ümlauts, über 60 Zeichen lang.pdf';

for (const textEncoding of ['quoted-printable', 'base64'] as const) {
    for (const newline of ['\r\n', '\n']) {
        test(`round trip - ${textEncoding} text with ${JSON.stringify(newline)} line endings`, async () => {
            const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0x00, 0xff, 0x0a, 0x0d, 0x3d, 0x20]);
            const innerMessage = 'Subject: inner\r\n\r\nline one\r\nline two\r\n';

            const { email } = await roundTrip({
                from: { name: 'Jörg Müller, Jr.', address: 'jorg@example.com' },
                to: [{ name: '李雷', address: 'li@example.com' }, 'plain@example.com'],
                cc: '"Doe, Jane" <jane@example.com>',
                subject: SUBJECT,
                text: TEXT,
                html: HTML,
                textEncoding,
                newline,
                attachments: [
                    { filename: LONG_FILENAME, content: pdf, contentType: 'application/pdf' },
                    {
                        filename: 'notes.txt',
                        content: 'first line\nsecond line\n',
                        contentType: 'text/plain; charset=utf-8',
                        contentTransferEncoding: '8bit'
                    },
                    {
                        filename: 'forwarded.eml',
                        content: Buffer.from(innerMessage),
                        contentType: 'message/rfc822',
                        contentTransferEncoding: '7bit',
                        // Nodemailer marks a message/rfc822 part inline, and an inline
                        // message is parsed into the body rather than kept as an attachment
                        contentDisposition: 'attachment'
                    },
                    {
                        cid: 'logo@example',
                        filename: 'logo.gif',
                        content: Buffer.from('GIF89a'),
                        contentType: 'image/gif'
                    }
                ]
            });

            assert.strictEqual(email.subject, SUBJECT);
            assert.deepStrictEqual(email.from, { name: 'Jörg Müller, Jr.', address: 'jorg@example.com' });
            assert.deepStrictEqual(email.to, [
                { name: '李雷', address: 'li@example.com' },
                { name: '', address: 'plain@example.com' }
            ]);
            assert.deepStrictEqual(email.cc, [{ name: 'Doe, Jane', address: 'jane@example.com' }]);

            // text is normalized to LF, so it reads the same whatever the message used
            assert.strictEqual(email.text!.replace(/\n$/, ''), TEXT);
            assert.strictEqual(email.html!.replace(/\n$/, ''), HTML);

            // the inline image sits in a multipart/related ahead of the other attachments,
            // so the attachments are looked up by name rather than by position
            const byName = new Map(email.attachments.map(attachment => [attachment.filename, attachment]));
            assert.deepStrictEqual(
                [...byName.keys()].sort(),
                [LONG_FILENAME, 'forwarded.eml', 'logo.gif', 'notes.txt'].sort()
            );
            assert.deepStrictEqual(attachmentBytes(byName.get(LONG_FILENAME)!), pdf);
            // 7bit and 8bit content is sent with the line endings of the message and comes
            // back with them, byte for byte
            assert.strictEqual(
                attachmentBytes(byName.get('notes.txt')!).toString(),
                'first line\nsecond line\n'.replace(/\n/g, newline)
            );
            assert.strictEqual(
                attachmentBytes(byName.get('forwarded.eml')!).toString(),
                innerMessage.replace(/\r\n/g, newline)
            );
            assert.strictEqual(byName.get('forwarded.eml')!.mimeType, 'message/rfc822');
            assert.strictEqual(byName.get('logo.gif')!.contentId, '<logo@example>');
            assert.strictEqual(byName.get('logo.gif')!.related, true);
            assert.strictEqual(attachmentBytes(byName.get('logo.gif')!).toString(), 'GIF89a');
        });
    }
}

// Characters from the classes an encoder treats differently: ASCII that quoted-printable
// leaves alone, the `=` it has to escape, the whitespace it has to protect at the end of a
// line, and multi byte characters of 2, 3 and 4 bytes that a soft break may split
const ALPHABET = [
    ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 .,;:!?=_-+*/()[]<>"\'\t',
    'äöüõ',
    'Привет',
    '日本語',
    '😀🙂',
    '…“”'
].join('');
const CHARS = Array.from(ALPHABET);

function randomText(random: () => number): string {
    const lines: string[] = [];
    const lineCount = 1 + Math.floor(random() * 8);
    for (let i = 0; i < lineCount; i++) {
        const length = Math.floor(random() * 200);
        let line = '';
        for (let j = 0; j < length; j++) {
            line += pick(random, CHARS);
        }
        lines.push(line);
    }
    return lines.join('\n');
}

test('round trip - random text survives both transfer encodings', async () => {
    const random = createRandom(7);

    for (let i = 0; i < 40; i++) {
        const text = randomText(random);
        for (const textEncoding of ['quoted-printable', 'base64'] as const) {
            const { email } = await roundTrip({ from: 'a@example.com', subject: `case ${i}`, text, textEncoding });
            assert.strictEqual(
                (email.text || '').replace(/\n$/, ''),
                text.replace(/\n$/, ''),
                `${textEncoding} case ${i}: ${JSON.stringify(text)}`
            );
        }
    }
});
