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

// RFC 2046 compliance tests

test('Parse boundary with trailing whitespace (RFC 2046)', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="test"\r\n\r\n' +
            '--test   \r\n' + // trailing spaces after boundary
            'Content-Type: text/plain\r\n\r\n' +
            'Hello\r\n' +
            '--test--\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Hello');
});

test('Parse boundary with trailing tabs (RFC 2046)', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="testbound"\r\n\r\n' +
            '--testbound\t\t\r\n' + // trailing tabs after boundary
            'Content-Type: text/plain\r\n\r\n' +
            'World\r\n' +
            '--testbound--\t\r\n' // trailing tab on terminator too
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'World');
});

test('Parse multipart/digest with default message/rfc822 (RFC 2046 Section 5.1.5)', async t => {
    // In multipart/digest, parts without Content-Type should default to message/rfc822
    // and be parsed as inline nested messages (their content is extracted)
    const mail = Buffer.from(
        'Content-Type: multipart/digest; boundary="digestbound"\r\n\r\n' +
            '--digestbound\r\n' +
            '\r\n' + // No Content-Type header - should default to message/rfc822
            'From: nested@example.com\r\n' +
            'Subject: Nested Message\r\n\r\n' +
            'Body of nested message\r\n' +
            '--digestbound--\r\n'
    );
    const email = await PostalMime.parse(mail);
    // The nested message should be parsed and its content inlined
    assert.ok(email.text.includes('nested@example.com'));
    assert.ok(email.text.includes('Nested Message'));
    assert.ok(email.text.includes('Body of nested message'));
});

test('Parse multipart/digest with rfc822Attachments option', async t => {
    // With rfc822Attachments option, nested messages become attachments
    const mail = Buffer.from(
        'Content-Type: multipart/digest; boundary="digestbound"\r\n\r\n' +
            '--digestbound\r\n' +
            '\r\n' + // No Content-Type header - should default to message/rfc822
            'From: nested@example.com\r\n' +
            'Subject: Nested Message\r\n\r\n' +
            'Body of nested message\r\n' +
            '--digestbound--\r\n'
    );
    const email = await PostalMime.parse(mail, { rfc822Attachments: true });
    // With rfc822Attachments, nested message should be an attachment
    assert.ok(email.attachments.length > 0);
    assert.strictEqual(email.attachments[0].mimeType, 'message/rfc822');
});

test('Parse Content-Type with RFC 822 comment', async t => {
    const mail = Buffer.from('Content-Type: text/plain (this is a comment); charset=utf-8\r\n\r\nHello');
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Hello');
});

test('Parse Content-Type with nested RFC 822 comments', async t => {
    const mail = Buffer.from(
        'Content-Type: text/html (outer (nested) comment); charset=utf-8\r\n\r\n' + '<p>Hello</p>'
    );
    const email = await PostalMime.parse(mail);
    assert.ok(email.html.includes('<p>Hello</p>'));
});

test('Parse Content-Type with comment containing special characters', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain (comment with \\) escaped paren); charset=iso-8859-1\r\n\r\nTest'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Test');
});

test('Parse Content-Type with comment but parentheses in quoted string preserved', async t => {
    // Parentheses inside quoted strings should NOT be treated as comments
    const mail = Buffer.from(
        'Content-Type: text/plain; name="file (1).txt"\r\n' +
            'Content-Disposition: attachment; filename="file (1).txt"\r\n\r\n' +
            'Content'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.attachments[0].filename, 'file (1).txt');
});

// RFC 3676 Format=Flowed tests

test('Flowed text - basic soft line break', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain; format=flowed\r\n\r\n' + 'This is a long line that \r\n' + 'continues here.\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text, 'This is a long line that continues here.\n');
});

test('Flowed text - signature separator not joined (RFC 3676)', async t => {
    // The signature separator "-- " should not be joined with following lines
    // even though it ends with a space
    const mail = Buffer.from(
        'Content-Type: text/plain; format=flowed\r\n\r\n' + 'Body text \r\n' + 'continues.\r\n' + '-- \r\n' + 'Signature\r\n'
    );
    const email = await PostalMime.parse(mail);
    // Signature separator should remain on its own line
    assert.ok(email.text.includes('-- \n') || email.text.includes('--\n'));
});

test('Flowed text - DelSp=yes removes trailing space', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\n' + 'Hello \r\n' + 'World\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text, 'HelloWorld\n');
});

test('Flowed text - space stuffing removed', async t => {
    // Lines starting with space, ">", or "From " are space-stuffed
    const mail = Buffer.from(
        'Content-Type: text/plain; format=flowed\r\n\r\n' + ' >quoted\r\n' + ' From someone\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.ok(email.text.includes('>quoted'));
    assert.ok(email.text.includes('From someone'));
});

// RFC 2231 Parameter Value Continuations tests

test('RFC 2231 - simple continuation', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain\r\n' +
            "Content-Disposition: attachment;\r\n filename*0=long;\r\n filename*1=file;\r\n filename*2=name.txt\r\n\r\n" +
            'Content'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.attachments[0].filename, 'longfilename.txt');
});

test('RFC 2231 - encoded continuation with charset', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain\r\n' +
            "Content-Disposition: attachment;\r\n filename*0*=utf-8''%C3%A4bc;\r\n filename*1*=%C3%B6%C3%BC.txt\r\n\r\n" +
            'Content'
    );
    const email = await PostalMime.parse(mail);
    // Should decode UTF-8 percent-encoded characters (ä, ö, ü)
    assert.strictEqual(email.attachments[0].filename, 'äbcöü.txt');
});

test('RFC 2231 - single encoded parameter (no continuation)', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain\r\n' +
            "Content-Disposition: attachment; filename*=utf-8''%E2%9C%93check.txt\r\n\r\n" +
            'Content'
    );
    const email = await PostalMime.parse(mail);
    // Checkmark character
    assert.ok(email.attachments[0].filename.includes('check.txt'));
});

// Boundary edge case tests

test('Boundary - empty MIME part', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="bound"\r\n\r\n' +
            '--bound\r\n' +
            'Content-Type: text/plain\r\n\r\n' +
            '\r\n' + // empty content
            '--bound\r\n' +
            'Content-Type: text/plain\r\n\r\n' +
            'Second part\r\n' +
            '--bound--\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.ok(email.text.includes('Second part'));
});

test('Boundary - with preamble and epilogue', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="bound"\r\n\r\n' +
            'This is the preamble (should be ignored)\r\n' +
            '--bound\r\n' +
            'Content-Type: text/plain\r\n\r\n' +
            'Body content\r\n' +
            '--bound--\r\n' +
            'This is the epilogue (should be ignored)\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Body content');
    assert.ok(!email.text.includes('preamble'));
    assert.ok(!email.text.includes('epilogue'));
});

test('Boundary - special characters in boundary string', async t => {
    const mail = Buffer.from(
        "Content-Type: multipart/mixed; boundary=\"=_Part_123_+special'\"\r\n\r\n" +
            "--=_Part_123_+special'\r\n" +
            'Content-Type: text/plain\r\n\r\n' +
            'Content\r\n' +
            "--=_Part_123_+special'--\r\n"
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Content');
});

test('Boundary - very long boundary string', async t => {
    const boundary = 'a'.repeat(70); // Max allowed is 70 chars
    const mail = Buffer.from(
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
            `--${boundary}\r\n` +
            'Content-Type: text/plain\r\n\r\n' +
            'Content\r\n' +
            `--${boundary}--\r\n`
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Content');
});

// Nested multipart structure tests

test('Nested multipart - alternative inside mixed', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="outer"\r\n\r\n' +
            '--outer\r\n' +
            'Content-Type: multipart/alternative; boundary="inner"\r\n\r\n' +
            '--inner\r\n' +
            'Content-Type: text/plain\r\n\r\n' +
            'Plain text\r\n' +
            '--inner\r\n' +
            'Content-Type: text/html\r\n\r\n' +
            '<p>HTML text</p>\r\n' +
            '--inner--\r\n' +
            '--outer\r\n' +
            'Content-Type: text/plain\r\n' +
            'Content-Disposition: attachment; filename="test.txt"\r\n\r\n' +
            'Attachment content\r\n' +
            '--outer--\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.ok(email.text.includes('Plain text'));
    assert.ok(email.html.includes('<p>HTML text</p>'));
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, 'test.txt');
});

test('Nested multipart - related with inline image', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/related; boundary="related"\r\n\r\n' +
            '--related\r\n' +
            'Content-Type: text/html\r\n\r\n' +
            '<html><body><img src="cid:image1"/></body></html>\r\n' +
            '--related\r\n' +
            'Content-Type: image/png\r\n' +
            'Content-ID: <image1>\r\n' +
            'Content-Transfer-Encoding: base64\r\n\r\n' +
            'iVBORw0KGgo=\r\n' +
            '--related--\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.ok(email.html.includes('cid:image1'));
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].contentId, '<image1>');
    assert.strictEqual(email.attachments[0].related, true);
});

// Malformed email permissive parsing tests

test('Malformed - missing final boundary terminator', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="bound"\r\n\r\n' +
            '--bound\r\n' +
            'Content-Type: text/plain\r\n\r\n' +
            'Content without terminator\r\n'
        // Missing --bound--
    );
    const email = await PostalMime.parse(mail);
    assert.ok(email.text.includes('Content without terminator'));
});

test('Malformed - extra whitespace in headers', async t => {
    const mail = Buffer.from(
        'Content-Type:   text/plain;   charset=utf-8  \r\n\r\n' + // extra spaces
            'Content'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Content');
});

test('Malformed - LF only line endings (no CR)', async t => {
    const mail = Buffer.from('Content-Type: text/plain\n\nBody with LF only');
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Body with LF only');
});

test('Malformed - mixed CRLF and LF line endings', async t => {
    const mail = Buffer.from('Content-Type: text/plain\r\n\nBody\r\nMore body\n');
    const email = await PostalMime.parse(mail);
    assert.ok(email.text.includes('Body'));
    assert.ok(email.text.includes('More body'));
});

test('Malformed - header without value', async t => {
    const mail = Buffer.from('Content-Type: text/plain\r\nX-Empty-Header:\r\n\r\nBody');
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Body');
    const emptyHeader = email.headers.find(h => h.key === 'x-empty-header');
    assert.ok(emptyHeader);
    assert.strictEqual(emptyHeader.value, '');
});

test('Malformed - duplicate Content-Type headers (last wins)', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain\r\n' + 'Content-Type: text/html\r\n\r\n' + '<p>Content</p>'
    );
    const email = await PostalMime.parse(mail);
    // Last Content-Type is used (headers processed in reverse order)
    assert.ok(email.html);
    assert.ok(email.html.includes('Content'));
});

// Additional edge case tests

test('Edge case - empty email', async t => {
    const mail = Buffer.from('');
    const email = await PostalMime.parse(mail);
    assert.ok(email);
    assert.strictEqual(email.text, undefined);
});

test('Edge case - headers only, no body', async t => {
    const mail = Buffer.from('From: test@example.com\r\nSubject: Test\r\n');
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.from.address, 'test@example.com');
    assert.strictEqual(email.subject, 'Test');
});

test('Edge case - body only, no headers', async t => {
    const mail = Buffer.from('\r\nJust a body');
    const email = await PostalMime.parse(mail);
    assert.ok(email.text.includes('Just a body'));
});

test('Edge case - very long subject line (folded)', async t => {
    const longSubject = 'Word '.repeat(100);
    const mail = Buffer.from(`Subject: ${longSubject}\r\n\r\nBody`);
    const email = await PostalMime.parse(mail);
    assert.ok(email.subject.includes('Word'));
});

test('Edge case - Content-Type with multiple parameters', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain; charset=utf-8; format=flowed; delsp=yes; reply-type=original\r\n\r\n' +
            'Flowed \r\n' +
            'text\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text, 'Flowedtext\n');
});

test('Edge case - attachment with no filename', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="bound"\r\n\r\n' +
            '--bound\r\n' +
            'Content-Type: application/octet-stream\r\n' +
            'Content-Transfer-Encoding: base64\r\n\r\n' +
            'SGVsbG8=\r\n' +
            '--bound--\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.attachments.length, 1);
    assert.strictEqual(email.attachments[0].filename, null);
});

test('Edge case - multiple text/plain parts concatenated', async t => {
    const mail = Buffer.from(
        'Content-Type: multipart/mixed; boundary="bound"\r\n\r\n' +
            '--bound\r\n' +
            'Content-Type: text/plain\r\n\r\n' +
            'First part\r\n' +
            '--bound\r\n' +
            'Content-Type: text/plain\r\n\r\n' +
            'Second part\r\n' +
            '--bound--\r\n'
    );
    const email = await PostalMime.parse(mail);
    assert.ok(email.text.includes('First part'));
    assert.ok(email.text.includes('Second part'));
});

test('Edge case - Content-Transfer-Encoding case insensitive', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain\r\n' + 'Content-Transfer-Encoding: BASE64\r\n\r\n' + 'SGVsbG8gV29ybGQ='
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('Edge case - quoted-printable with literal equals sign', async t => {
    const mail = Buffer.from(
        'Content-Type: text/plain\r\n' + 'Content-Transfer-Encoding: quoted-printable\r\n\r\n' + '1+1=3D2'
    );
    const email = await PostalMime.parse(mail);
    assert.strictEqual(email.text.trim(), '1+1=2');
});
