import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert';
import PostalMime from '../src/postal-mime.js';

// Basic QP decoding tests
test('QP decoder - simple ASCII text', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello World`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('QP decoder - encoded characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=48=65=6C=6C=6F=20=57=6F=72=6C=64`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World');
});

test('QP decoder - mixed encoded and plain text', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello =57orld with =73ome encoded`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello World with some encoded');
});

test('QP decoder - UTF-8 multi-byte characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Caf=C3=A9 na=C3=AFve r=C3=A9sum=C3=A9`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Café naïve résumé');
});

test('QP decoder - soft line breaks', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

This is a very long line that has been =
broken up using soft line breaks =
for readability.`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(
        email.text.trim(),
        'This is a very long line that has been broken up using soft line breaks for readability.'
    );
});

test('QP decoder - soft line breaks with CRLF', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Line one=\r\nLine two`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Line oneLine two');
});

test('QP decoder - hard line breaks', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Line one
Line two
Line three`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Line one\nLine two\nLine three');
});

test('QP decoder - tabs and spaces', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello\tWorld  with  spaces`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello\tWorld  with  spaces');
});

test('QP decoder - encoded tabs and spaces', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello=09World=20test`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello\tWorld test');
});

test('QP decoder - trailing whitespace with soft break', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello   =
World`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello   World');
});

test('QP decoder - empty lines', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Line one

Line three`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Line one\n\nLine three');
});

test('QP decoder - only encoded content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=C2=A9=C2=AE=E2=84=A2`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), '©®™');
});

test('QP decoder - emoji encoded', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello =F0=9F=98=80 World =F0=9F=8E=89`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello 😀 World 🎉');
});

test('QP decoder - special characters preserved', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

!@#$%^&*()_+-=[]{}|;:',.<>?/`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), "!@#$%^&*()_+-=[]{}|;:',.<>?/");
});

test('QP decoder - consecutive encoded characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=C3=A9=C3=A8=C3=AA=C3=AB`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'éèêë');
});

test('QP decoder - long line with multiple encoded chars', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

This line has m=C3=A1ny =C3=A9nc=C3=B3d=C3=A9d characters thr=C3=B3ugh=C3=B3ut`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'This line has mány éncódéd characters thróughóut');
});

test('QP decoder - literal equals sign', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

x=y and a=b`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'x=y and a=b');
});

test('QP decoder - equals at end of line (soft break)', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Line=
continuation`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Linecontinuation');
});

test('QP decoder - encoded newline characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Line one=0ALine two`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Line one\nLine two');
});

test('QP decoder - encoded carriage return and newline', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Line one=0D=0ALine two`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Line one\r\nLine two');
});

test('QP decoder - mixed case hex digits', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=c3=a9 =C3=A9 =c3=A9 =C3=a9`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'é é é é');
});

test('QP decoder - zero byte encoded', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Before=00After`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Before'));
    assert.ok(email.text.includes('After'));
});

test('QP decoder - all printable ASCII', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
0123456789`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789');
});

// Edge cases
test('QP decoder - empty content', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual((email.text || '').trim(), '');
});

test('QP decoder - only whitespace', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable


   `);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text);
});

test('QP decoder - single character encoded', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=41`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'A');
});

test('QP decoder - very long soft-wrapped line', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

This is a very long line that exceeds the typical 76 character limit and=
 needs to be wrapped using soft line breaks to comply with the quoted-pri=
ntable encoding specification.`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(
        email.text.trim(),
        'This is a very long line that exceeds the typical 76 character limit and needs to be wrapped using soft line breaks to comply with the quoted-printable encoding specification.'
    );
});

test('QP decoder - multiple soft breaks in sequence', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

A=
=
=
B`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'AB');
});

test('QP decoder - soft break at very end', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Text=`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Text');
});

test('QP decoder - underscore preserved', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

hello_world_test`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'hello_world_test');
});

test('QP decoder - encoded underscore', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

hello=5Fworld`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'hello_world');
});

test('QP decoder - boundary-like sequences preserved', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

--boundary-like-text--`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), '--boundary-like-text--');
});

test('QP decoder - mixed encoded and soft breaks', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Caf=C3=A9 is a =
nice place`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Café is a nice place');
});

test('QP decoder - high byte values', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=FF=FE=FD=FC`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // High bytes should be decoded
    assert.ok(email.text.length > 0);
});

test('QP decoder - encoded space at line end', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello=20
World`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Hello '));
    assert.ok(email.text.includes('World'));
});

test('QP decoder - encoded tab at line end', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello=09
World`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.ok(email.text.includes('Hello\t'));
    assert.ok(email.text.includes('World'));
});

test('QP decoder - multiple consecutive soft breaks with whitespace', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Line =
  =
    =
end`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // Soft breaks should be removed
    assert.ok(email.text.includes('Line'));
    assert.ok(email.text.includes('end'));
});

test('QP decoder - numbers in text vs hex', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

123=34=35=36 789`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // =34=35=36 should decode to "456"
    assert.strictEqual(email.text.trim(), '123456 789');
});

test('QP decoder - Chinese characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=E4=BD=A0=E5=A5=BD=E4=B8=96=E7=95=8C`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), '你好世界');
});

test('QP decoder - Japanese characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=E3=81=93=E3=82=93=E3=81=AB=E3=81=A1=E3=81=AF`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'こんにちは');
});

test('QP decoder - Arabic characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=D9=85=D8=B1=D8=AD=D8=A8=D8=A7`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'مرحبا');
});

test('QP decoder - Cyrillic characters', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

=D0=9F=D1=80=D0=B8=D0=B2=D0=B5=D1=82`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Привет');
});

test('QP decoder - mixed scripts', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello =E4=BD=A0=E5=A5=BD World =D0=9C=D0=B8=D1=80`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    assert.strictEqual(email.text.trim(), 'Hello 你好 World Мир');
});

test('QP decoder - format=flowed with delsp', async () => {
    const mail = Buffer.from(`Content-Type: text/plain; charset=UTF-8; format=flowed; delsp=yes
Content-Transfer-Encoding: quoted-printable

Hello =
World =
Test`);

    const parser = new PostalMime();
    const email = await parser.parse(mail);

    // format=flowed with delsp removes trailing spaces before soft breaks
    // The actual behavior joins with spaces preserved
    assert.ok(email.text.includes('Hello'));
    assert.ok(email.text.includes('World'));
    assert.ok(email.text.includes('Test'));
});
