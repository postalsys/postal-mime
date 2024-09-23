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

    assert.strictEqual(email.text, '\nThis e-mail message has been scanned for Viruses and Content and cleared\n\n\nGood Morning;\n\n\n');
    assert.strictEqual(
        email.html,
        '<HTML><HEAD>\n</HEAD><BODY> \n\n<HR>\nThis e-mail message has been scanned for Viruses and Content and cleared\n<HR>\n</BODY></HTML>\n\n\n<div>Good Morning;</div>'
    );
});

test('Parse Flowed content. Quoted printable, DelSp', async t => {
    const encodedText = 'Content-Type: text/plain; format=flowed; delsp=yes\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\nFoo =\n\nBar =\n\nBaz';
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
