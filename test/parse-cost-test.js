import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

// Parse paths that used to cost O(n²) in the input size,
// https://github.com/postalsys/postal-mime/issues/97
//
// Every input here took seconds or more before the fix and takes milliseconds after it,
// so a regression shows up as a failed bound rather than a slow test.

const LIMIT_MS = 5000;

const timed = async fn => {
    const started = Date.now();
    const result = await fn();
    const elapsed = Date.now() - started;
    assert.ok(elapsed < LIMIT_MS, `took ${elapsed}ms`);
    return result;
};

test('a header line with a long blank run is trimmed in linear time', async () => {
    const run = ' '.repeat(128 * 1024);
    const email = await timed(() => PostalMime.parse(`From: a@b\r\nSubject: a${run}b\r\na${run}b\r\n\r\nx`));

    assert.strictEqual(email.subject, `a${run}b`);
    assert.strictEqual(email.headers[2].key, `a${run}b`);
});

test('a header value is trimmed of SP and HTAB only', async () => {
    const email = await PostalMime.parse('Subject: \t \u00a0x\u00a0 \t \r\n\r\nx');
    assert.strictEqual(email.subject, '\u00a0x\u00a0');
});

test('a long format=flowed paragraph is unfolded in linear time', async () => {
    const lines = 250000;
    const email = await timed(() =>
        PostalMime.parse(`Content-Type: text/plain; format=flowed\r\n\r\n${'ab \r\n'.repeat(lines)}end\r\n`)
    );

    assert.strictEqual(email.text, 'ab '.repeat(lines) + 'end\n');
});

test('a long format=flowed delsp=yes paragraph is unfolded in linear time', async () => {
    const lines = 250000;
    const email = await timed(() =>
        PostalMime.parse(`Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\n${'ab \r\n'.repeat(lines)}end\r\n`)
    );

    assert.strictEqual(email.text, 'ab'.repeat(lines) + 'end\n');
});

test('format=flowed keeps the signature separator and empty lines', async () => {
    const email = await PostalMime.parse(
        'Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\n\r\na \r\nb\r\n-- \r\nsig \r\n \r\nx\r\n'
    );
    assert.strictEqual(email.text, '\nab\n-- \nsig\nx\n');
});
