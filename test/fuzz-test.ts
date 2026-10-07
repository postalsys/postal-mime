import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Path from 'node:path';
import PostalMime from '../src/postal-mime.js';
import { createRandom, pick } from './helpers.js';

// Mutation fuzzing. The fixtures are damaged in random but reproducible ways and parsed,
// and whatever comes back has to be a well formed result: the parser is handed mail from
// unknown sources and may reject a message only for exceeding a limit, never by throwing
// on its shape. The seed is fixed, so a failure here reproduces, and the damaged message
// that caused it is written out for inspection.

const fixturesDir = Path.join(import.meta.dirname, 'fixtures');
const fixtures = readdirSync(fixturesDir)
    .filter(name => name.endsWith('.eml'))
    .map(name => readFileSync(Path.join(fixturesDir, name)).toString('latin1'));

// a small message that exercises every decoder and header encoding the fixtures may not
fixtures.push(
    'From: =?utf-8?Q?J=C3=B6rg?= <a@b.c>\r\n' +
        'Subject: =?iso-8859-1?B?SGVsbG8=?=\r\n' +
        'Content-Type: multipart/mixed; boundary="b"\r\n\r\n' +
        '--b\r\nContent-Type: text/plain; charset=utf-8; format=flowed\r\n' +
        'Content-Transfer-Encoding: quoted-printable\r\n\r\nH=C3=A9llo =\r\nworld \r\n-- \r\nsig\r\n' +
        '--b\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\nPGEgaHJlZj0ieCI+bGluazwvYT4=\r\n' +
        '--b\r\nContent-Type: message/rfc822\r\n\r\nSubject: inner\r\n\r\ninner body\r\n' +
        "--b\r\nContent-Disposition: attachment; filename*0*=utf-8''a%20b; filename*1*=.txt\r\n" +
        'Content-Transfer-Encoding: base64\r\n\r\nAAEC\r\n--b--\r\n'
);

// the pieces a mutation splices in, the characters the parser gives meaning to
const SPECIALS = [
    '\r',
    '\n',
    '\r\n',
    ' ',
    '\t',
    '=',
    '?',
    '"',
    '(',
    ')',
    '<',
    '>',
    '@',
    ',',
    ';',
    ':',
    '\\',
    '[',
    ']',
    '--',
    '=?utf-8?Q?',
    '?=',
    '%',
    '*',
    '\x00',
    '\xff',
    '\xef\xbb\xbf',
    'boundary=',
    'Content-Type:',
    // U+2028, a line terminator to a regex and to `.`, but not to the parser
    String.fromCharCode(0x2028)
];

const LINE_ENDINGS = ['\n', '\r\n', '\r', '\n\r'];

function mutate(source: string, random: () => number): string {
    let str = source;
    const count = 1 + Math.floor(random() * 6);

    for (let i = 0; i < count; i++) {
        const pos = Math.floor(random() * str.length);
        switch (Math.floor(random() * 7)) {
            case 0:
                str = str.slice(0, pos) + pick(random, SPECIALS) + str.slice(pos);
                break;
            case 1:
                str = str.slice(0, pos) + str.slice(pos + 1 + Math.floor(random() * 20));
                break;
            case 2:
                str = str.slice(0, pos) + String.fromCharCode(Math.floor(random() * 256)) + str.slice(pos + 1);
                break;
            case 3: {
                const len = Math.floor(random() * 200);
                str = str.slice(0, pos) + str.slice(pos, pos + len) + str.slice(pos);
                break;
            }
            case 4:
                str = str.slice(0, pos);
                break;
            case 5: {
                const lines = str.split('\n');
                const a = Math.floor(random() * lines.length);
                const b = Math.floor(random() * lines.length);
                [lines[a], lines[b]] = [lines[b], lines[a]];
                str = lines.join('\n');
                break;
            }
            case 6:
                str = str.replace(/\r\n/g, pick(random, LINE_ENDINGS));
                break;
        }
    }

    return str;
}

const ITERATIONS = 300;
// generous, a single damaged message of a few kilobytes parses in well under a millisecond
const LIMIT_MS = 5000;
const ENCODINGS = ['arraybuffer', 'base64', 'utf8'] as const;

test('mutated messages parse into a well formed result or are rejected by a limit', async () => {
    const random = createRandom(2026);

    for (let i = 0; i < ITERATIONS; i++) {
        const input = Buffer.from(mutate(pick(random, fixtures), random), 'latin1');
        const attachmentEncoding = pick(random, ENCODINGS);

        const started = Date.now();
        try {
            const email = await PostalMime.parse(input, { attachmentEncoding });

            assert.ok(Array.isArray(email.headers));
            assert.strictEqual(email.headers.length, email.headerLines.length);
            assert.ok(Array.isArray(email.attachments));
            for (const attachment of email.attachments) {
                assert.ok(attachment.filename === null || typeof attachment.filename === 'string');
                assert.strictEqual(typeof attachment.mimeType, 'string');
                assert.ok(attachment.content !== undefined && attachment.content !== null);
            }
            for (const key of ['subject', 'text', 'html', 'date', 'messageId'] as const) {
                assert.ok(email[key] === undefined || typeof email[key] === 'string', key);
            }
        } catch (err) {
            if (!(err instanceof Error) || !/^Maximum /.test(err.message)) {
                const file = Path.join(tmpdir(), `postal-mime-fuzz-failure-${i}.eml`);
                writeFileSync(file, input);
                throw new Error(`iteration ${i} threw, input written to ${file}`, { cause: err });
            }
        }

        const elapsed = Date.now() - started;
        assert.ok(elapsed < LIMIT_MS, `iteration ${i} took ${elapsed}ms`);
    }
});
