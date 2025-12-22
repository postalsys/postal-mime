import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import PostalMime from '../src/postal-mime.js';
import Path from 'node:path';

test('Parse mixed non-alternative content', async t => {
    const mail = await readFile(Path.join(process.cwd(), 'test', 'fixtures', 'mixed.eml'));

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(
        email.text,
        '\nThis e-mail message has been scanned for Viruses and Content and cleared\n\n\nGood Morning;\n\n\n'
    );
    assert.strictEqual(
        email.html,
        '<HTML><HEAD>\n</HEAD><BODY> \n\n<HR>\nThis e-mail message has been scanned for Viruses and Content and cleared\n<HR>\n</BODY></HTML>\n\n\n<div>Good Morning;</div>'
    );
});

test('Parse Flowed content. Quoted printable, DelSp', async t => {
    const encodedText =
        'Content-Type: text/plain; format=flowed; delsp=yes\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\nFoo =\n\nBar =\n\nBaz';
    const mail = Buffer.from(encodedText, 'utf-8');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text, 'FooBarBaz\n');
});

test('Parse long references', async t => {
    const encodedText = `Content-Type: text/plain
References:
    <831872163.433861.2199124418162.JavaMail.otbatch@blabla.bla.bla.com> 
    =?utf-8?q?=3CTY1PR0301MB1149CEFEA528CEA0045533B1FBA70=40TY1PR0301MB1149=2Ea?=
    =?utf-8?q?pcprd03=2Eprod=2Eoutlook=2Ecom=3E?=

Hello world`;
    const mail = Buffer.from(encodedText, 'utf-8');

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(
        email.references,
        '<831872163.433861.2199124418162.JavaMail.otbatch@blabla.bla.bla.com> <TY1PR0301MB1149CEFEA528CEA0045533B1FBA70@TY1PR0301MB1149.apcprd03.prod.outlook.com>'
    );
});

test('Parse mixed equal signs in quoted printable content', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

J=C3=B5geva,abcdeABCDE,a=b,b
`)
    ]);

    const expected = 'Jõgeva,abcdeABCDE,a=b,b';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge cases - invalid hex sequences', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Valid=C3=B5text=Z1invalid=GGnothex=1Xbad
`)
    ]);

    // Invalid sequences should be preserved as literals
    const expected = 'Validõtext=Z1invalid=GGnothex=1Xbad';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge cases - incomplete sequences', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

text=C3=B5end=C3
`)
    ]);

    // With the fix: =C3 at end is incomplete but has valid hex chars
    // It still gets processed and may result in replacement character
    const expected = 'textõend�';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge cases - single equal sign at end', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

text=C3=B5end=
`)
    ]);

    // With the new regex, trailing = is not a valid QP sequence
    // It gets treated as a soft line break and removed
    const expected = 'textõend';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge cases - multiple consecutive equal signs', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

a==b===c====d=====e
`)
    ]);

    const expected = 'a==b===c====d=====e';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge cases - mixed valid and invalid sequences', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=41BC=42=ZZ=43==44=G1=45
`)
    ]);

    // With the new regex:
    // =41 (A) is valid, BC stays as is, =42 (B) is valid
    // =ZZ is invalid (not split), stays with previous text as "B=ZZ"
    // =43 (C) is valid, = alone stays, =44 (D) is valid
    // =G1 is invalid (not split), stays with previous text as "D=G1"
    // =45 (E) is valid
    const expected = 'ABCB=ZZC=D=G1E';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge cases - case insensitive hex', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=41=42=43=61=62=63=4A=4a=6F=6f
`)
    ]);

    // Both uppercase and lowercase hex should work
    const expected = 'ABCabcJJoo';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge cases - equals in subject line', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

1+1=2 and 2+2=4
`)
    ]);

    const expected = '1+1=2 and 2+2=4';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge case - =AZ alone', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=AZ
`)
    ]);

    // With the fix: =AZ is not a valid QP sequence (Z is not hex)
    // The decoder now validates hex characters before decoding
    // So =AZ is preserved as literal text
    const expected = '=AZ';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('QP decoder edge case - various invalid 3-char sequences', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=G1=ZZ=@@=!X
`)
    ]);

    // All of these are invalid QP sequences and should be preserved
    const expected = '=G1=ZZ=@@=!X';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), expected);
});

test('Parse ISO-2022-JP text', async t => {
    const mail = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=ISO-2022-JP
Subject: =?ISO-2022-JP?B?GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC?=

`),
        Buffer.from('GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC', 'base64')
    ]);

    const expected = '学校技術員研修検討会報告';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject.trim(), expected);
    assert.strictEqual(email.text.trim(), expected);
});

test('Parse ISO-2022-JP subject', async t => {
    const mail = Buffer.from(`Subject: =?ISO-2022-JP?B?UGFzc3dvcmQ6GyRCIVYbKEJSRTogGyRCRUUbKEI=?=
  =?ISO-2022-JP?B?GyRCO1IlYSE8JWs+cEpzTzMxTEJQOnYlNyU5JUYlYCVGGyhC?=
  =?ISO-2022-JP?B?GyRCJTklSCVhITwlayRHJDkhIyFXGyhC?=

hello world
`);

    const expected = 'Password:「RE: 電子メール情報漏洩対策システムテストメールです。」';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject.trim(), expected);
});

test('Parse ISO-2022-JP split subject', async t => {
    const mail = Buffer.from(`Subject: =?ISO-2022-JP?B?UGFzc3dvcmQ6GyRCIVYbKEJSRTogGyRC?=
  =?ISO-2022-JP?B?RUU7UiVhITwlaz5wSnNPMzFMQlA6diU3?=
  =?ISO-2022-JP?B?JTklRiVgJUYlOSVIJWEhPCVrJEckOSEjIVcbKEI=?=

hello world
`);

    const expected = 'Password:「RE: 電子メール情報漏洩対策システムテストメールです。」';

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.subject.trim(), expected);
});

test('Parse double encoded address string', async t => {
    const mail = Buffer.from(
        `From: test@example.com
To: =?utf-8?B?IlJ5ZGVsIiA8UnlkZWxrYWxvdEAxN2d1YWd1YS5jb20+?=, andris@tr.ee

test`
    );

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.deepEqual(email.to, [
        { address: 'Rydelkalot@17guagua.com', name: 'Rydel' },
        { address: 'andris@tr.ee', name: '' }
    ]);
});

test('Parse mimetorture email', async t => {
    const mail = await readFile(Path.join(process.cwd(), 'test', 'fixtures', 'mimetorture.eml'));

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 9);
});

test('Parse mimetorture email as attachments', async t => {
    const mail = await readFile(Path.join(process.cwd(), 'test', 'fixtures', 'mimetorture.eml'));

    const parser = new PostalMime({ forceRfc822Attachments: true });
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 10);
});

test('Parse calendar email', async t => {
    const mail = await readFile(Path.join(process.cwd(), 'test', 'fixtures', 'calendar-event.eml'));

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 2);
    assert.deepStrictEqual(email.attachments[0].content, email.attachments[1].content);
    assert.strictEqual(email.attachments[0].method, 'REQUEST');
    assert.ok(!email.attachments[1].method);
});

test('Parse bounce email inline', async t => {
    const mail = await readFile(Path.join(process.cwd(), 'test', 'fixtures', 'bounce.eml'));

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 2);
});

test('Parse bounce email attachment', async t => {
    const mail = await readFile(Path.join(process.cwd(), 'test', 'fixtures', 'bounce.eml'));

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.attachments.length, 2);
});

// headerLines tests

test('headerLines contains raw header lines', async t => {
    const mail = `From: sender@example.com
To: recipient@example.com
Subject: =?UTF-8?B?SGVsbG8gV29ybGQ=?=
Content-Type: text/plain; charset=utf-8

Hello`;

    const email = await PostalMime.parse(mail);

    assert.ok(Array.isArray(email.headerLines));
    assert.strictEqual(email.headerLines.length, 4);

    const fromHeader = email.headerLines.find(h => h.key === 'from');
    assert.ok(fromHeader);
    assert.strictEqual(fromHeader.line, 'From: sender@example.com');

    const subjectHeader = email.headerLines.find(h => h.key === 'subject');
    assert.ok(subjectHeader);
    // Raw line should preserve encoded words (not decoded)
    assert.strictEqual(subjectHeader.line, 'Subject: =?UTF-8?B?SGVsbG8gV29ybGQ=?=');
});

test('headerLines handles folded headers', async t => {
    const mail = `From: sender@example.com
Subject: This is a very long subject line that
 has been folded across multiple lines
Content-Type: text/plain

Body`;

    const email = await PostalMime.parse(mail);

    const subjectHeader = email.headerLines.find(h => h.key === 'subject');
    assert.ok(subjectHeader);
    // Folded lines should be merged with newline preserved
    assert.ok(subjectHeader.line.includes('\n'));
    assert.ok(subjectHeader.line.startsWith('Subject: This is a very long'));
});

test('headerLines order matches headers array', async t => {
    const mail = `From: a@example.com
To: b@example.com
Subject: Test

Body`;

    const email = await PostalMime.parse(mail);

    assert.strictEqual(email.headerLines.length, email.headers.length);
    for (let i = 0; i < email.headers.length; i++) {
        assert.strictEqual(email.headerLines[i].key, email.headers[i].key);
    }
});

test('headerLines handles malformed header without colon', async t => {
    const mail = `From: test@example.com
MalformedHeaderNoColon
Subject: Test

Body`;

    const email = await PostalMime.parse(mail);

    const malformed = email.headerLines.find(h => h.key === 'malformedheadernocolon');
    assert.ok(malformed);
    assert.strictEqual(malformed.line, 'MalformedHeaderNoColon');
});

test('headerLines handles header with empty value', async t => {
    const mail = `From: test@example.com
X-Empty-Header:
Subject: Test

Body`;

    const email = await PostalMime.parse(mail);

    const emptyHeader = email.headerLines.find(h => h.key === 'x-empty-header');
    assert.ok(emptyHeader);
    assert.strictEqual(emptyHeader.line, 'X-Empty-Header:');
});

test('headerLines preserves duplicate headers', async t => {
    const mail = `From: test@example.com
Received: from server1
Received: from server2
Subject: Test

Body`;

    const email = await PostalMime.parse(mail);

    const receivedHeaders = email.headerLines.filter(h => h.key === 'received');
    assert.strictEqual(receivedHeaders.length, 2);
    assert.strictEqual(receivedHeaders[0].line, 'Received: from server1');
    assert.strictEqual(receivedHeaders[1].line, 'Received: from server2');
});

test('headerLines preserves original whitespace', async t => {
    const mail = `From: test@example.com
Subject: Hello    World
Content-Type: text/plain

Body`;

    const email = await PostalMime.parse(mail);

    const subjectHeader = email.headerLines.find(h => h.key === 'subject');
    assert.ok(subjectHeader);
    // Raw line preserves multiple spaces
    assert.strictEqual(subjectHeader.line, 'Subject: Hello    World');

    // Compare with headers which normalizes whitespace
    const normalizedSubject = email.headers.find(h => h.key === 'subject');
    assert.strictEqual(normalizedSubject.value, 'Hello World');
});

test('headers array order unchanged after headerLines addition', async t => {
    const mail = `From: first@example.com
To: second@example.com
Subject: third
Date: Mon, 1 Jan 2024 00:00:00 +0000
Content-Type: text/plain

Body`;

    const email = await PostalMime.parse(mail);

    // Headers should be in original order (From, To, Subject, Date, Content-Type)
    assert.strictEqual(email.headers[0].key, 'from');
    assert.strictEqual(email.headers[1].key, 'to');
    assert.strictEqual(email.headers[2].key, 'subject');
    assert.strictEqual(email.headers[3].key, 'date');
    assert.strictEqual(email.headers[4].key, 'content-type');
});

test('headerLines handles tab-folded headers', async t => {
    const mail = `From: sender@example.com
Subject: This is a subject
\tthat is folded with a tab
Content-Type: text/plain

Body`;

    const email = await PostalMime.parse(mail);

    const subjectHeader = email.headerLines.find(h => h.key === 'subject');
    assert.ok(subjectHeader);
    // Tab-folded lines should be merged with newline preserved
    assert.ok(subjectHeader.line.includes('\n'));
    assert.ok(subjectHeader.line.includes('\t'));
    assert.ok(subjectHeader.line.startsWith('Subject: This is a subject'));
});

test('headerLines handles multi-line folded headers (3+ lines)', async t => {
    const mail = `From: sender@example.com
Subject: This is a very long subject
 that continues on the second line
 and even on a third line
 and a fourth line too
Content-Type: text/plain

Body`;

    const email = await PostalMime.parse(mail);

    const subjectHeader = email.headerLines.find(h => h.key === 'subject');
    assert.ok(subjectHeader);
    // Should contain three newlines (four lines merged)
    assert.strictEqual((subjectHeader.line.match(/\n/g) || []).length, 3);
    assert.ok(subjectHeader.line.includes('fourth line'));
});

test('headerLines handles CRLF line endings', async t => {
    const mail = Buffer.from(
        'From: sender@example.com\r\n' +
        'Subject: Test with CRLF\r\n' +
        'Content-Type: text/plain\r\n' +
        '\r\n' +
        'Body'
    );

    const email = await PostalMime.parse(mail);

    assert.strictEqual(email.headerLines.length, 3);
    const subjectHeader = email.headerLines.find(h => h.key === 'subject');
    assert.ok(subjectHeader);
    assert.strictEqual(subjectHeader.line, 'Subject: Test with CRLF');
});

test('headerLines not exposed for nested MIME parts', async t => {
    const mail = `From: sender@example.com
Subject: Main message
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain
X-Nested-Header: should not appear in headerLines

This is the body
--boundary123--`;

    const email = await PostalMime.parse(mail);

    // headerLines should only contain root message headers
    assert.strictEqual(email.headerLines.length, 3);
    assert.ok(email.headerLines.find(h => h.key === 'from'));
    assert.ok(email.headerLines.find(h => h.key === 'subject'));
    assert.ok(email.headerLines.find(h => h.key === 'content-type'));

    // Nested MIME part headers should NOT be in headerLines
    const nestedHeader = email.headerLines.find(h => h.key === 'x-nested-header');
    assert.strictEqual(nestedHeader, undefined);
});

test('headerLines with headers near max size limit', async t => {
    // Create a header value that's large but under the default 2MB limit
    const longValue = 'x'.repeat(10000);
    const mail = `From: sender@example.com
Subject: ${longValue}
Content-Type: text/plain

Body`;

    const email = await PostalMime.parse(mail);

    const subjectHeader = email.headerLines.find(h => h.key === 'subject');
    assert.ok(subjectHeader);
    assert.strictEqual(subjectHeader.line, `Subject: ${longValue}`);
    assert.strictEqual(subjectHeader.line.length, 10009); // "Subject: " + 10000 x's
});
