import test from 'node:test';
import assert from 'node:assert';
import BoundaryStack from '../src/boundary-stack.js';
import PostalMime from '../src/postal-mime.js';
import type MimeNode from '../src/mime-node.js';

const bytes = (text: string): Uint8Array => Uint8Array.from(text, c => c.charCodeAt(0));
// the stack only hands the nodes back, so any distinct object stands for one
const node = (name: string): MimeNode => ({ name }) as unknown as MimeNode;

const matchOf = (stack: BoundaryStack, line: string) => {
    const match = stack.match(bytes(line));
    return match && { node: (match.node as unknown as { name: string }).name, isTerminator: match.isTerminator };
};

test('BoundaryStack - matches a delimiter and a terminator, with trailing whitespace', () => {
    const stack = new BoundaryStack();
    stack.push('abc', node('a'));

    assert.deepStrictEqual(matchOf(stack, '--abc'), { node: 'a', isTerminator: false });
    assert.deepStrictEqual(matchOf(stack, '--abc \t '), { node: 'a', isTerminator: false });
    assert.deepStrictEqual(matchOf(stack, '--abc--'), { node: 'a', isTerminator: true });
    assert.deepStrictEqual(matchOf(stack, '--abc-- \t'), { node: 'a', isTerminator: true });

    for (const line of [
        '--ab',
        '--abcd',
        '--abc-',
        '--abc---',
        '--abc --',
        '--abc--x',
        '-abc',
        '--',
        'abc',
        '--abc\v'
    ]) {
        assert.strictEqual(stack.match(bytes(line)), null, line);
    }
});

test('BoundaryStack - a line is compared byte for byte', () => {
    const stack = new BoundaryStack();
    stack.push('abc', node('a'));

    // a UTF-8 BOM, or a byte that does not decode, is not dropped from the line
    assert.strictEqual(stack.match(bytes('--\xef\xbb\xbfabc')), null);
    assert.strictEqual(stack.match(bytes('--ab\xffc')), null);
    assert.strictEqual(stack.match(bytes('--ABC')), null);
});

test('BoundaryStack - the outermost of the boundaries a line matches wins', () => {
    // `--X--` is the terminator of X and the delimiter of X--
    const outerX = new BoundaryStack();
    outerX.push('X', node('outer'));
    outerX.push('X--', node('inner'));
    assert.deepStrictEqual(matchOf(outerX, '--X--'), { node: 'outer', isTerminator: true });

    const outerDashes = new BoundaryStack();
    outerDashes.push('X--', node('outer'));
    outerDashes.push('X', node('inner'));
    assert.deepStrictEqual(matchOf(outerDashes, '--X--'), { node: 'outer', isTerminator: false });
    assert.deepStrictEqual(matchOf(outerDashes, '--X'), { node: 'inner', isTerminator: false });

    // the same value declared twice
    const repeated = new BoundaryStack();
    repeated.push('X', node('outer'));
    repeated.push('X', node('inner'));
    assert.deepStrictEqual(matchOf(repeated, '--X'), { node: 'outer', isTerminator: false });
    repeated.remove(node('unknown'));
    assert.strictEqual(repeated.size, 2);
});

test('BoundaryStack - a removed boundary no longer matches', () => {
    const stack = new BoundaryStack();
    const outer = node('outer');
    const inner = node('inner');
    const sibling = node('sibling');
    stack.push('X', outer);
    stack.push('X', inner);
    stack.push('Y', sibling);

    stack.remove(outer);
    assert.deepStrictEqual(matchOf(stack, '--X'), { node: 'inner', isTerminator: false });
    stack.remove(inner);
    assert.strictEqual(matchOf(stack, '--X'), null);
    assert.deepStrictEqual(matchOf(stack, '--Y--'), { node: 'sibling', isTerminator: true });
    stack.remove(sibling);
    assert.strictEqual(stack.size, 0);
    assert.strictEqual(matchOf(stack, '--Y'), null);
});

test('a nested multipart closed by its terminator stops matching its boundary', async () => {
    const email = await PostalMime.parse(
        'Content-Type: multipart/mixed; boundary=outer\r\n\r\n' +
            '--outer\r\nContent-Type: multipart/mixed; boundary=inner\r\n\r\n' +
            '--inner\r\nContent-Type: text/plain\r\n\r\nfirst\r\n--inner--\r\n' +
            '--outer\r\nContent-Type: text/plain\r\n\r\nsecond\r\n--inner\r\nstill second\r\n--outer--\r\n'
    );
    assert.strictEqual(email.text, 'first\nsecond\n--inner\nstill second');
});
