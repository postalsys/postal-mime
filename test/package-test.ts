import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// These tests exercise the compiled output in dist/ (built by the pretest script)
// through the package.json exports map, the same way an installed copy of the package
// is loaded. Node resolves the package name to the package itself when the specifier
// is used from inside the package.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = require.resolve('typescript/bin/tsc');

// A non-literal specifier keeps TypeScript from resolving the built types at type-check
// time, when dist/ may not exist yet
const packageName: string = 'postal-mime';

const message =
    'From: Sender <sender@example.com>\nSubject: =?utf-8?B?UGFja2FnZSB0ZXN0?=\nContent-Type: text/plain\n\nHello from the built package';

const distFile = (...parts: string[]): string => path.join(root, 'dist', ...parts);
const readDist = (...parts: string[]): string => fs.readFileSync(distFile(...parts), 'utf8');

test('Built package - ships both module formats with declarations and maps', () => {
    for (const format of ['esm', 'cjs']) {
        for (const name of [
            'postal-mime.js',
            'postal-mime.js.map',
            'postal-mime.d.ts',
            'postal-mime.d.ts.map',
            'types.d.ts'
        ]) {
            assert.ok(fs.existsSync(distFile(format, name)), format + '/' + name);
        }
        // the maps point at the shipped source
        for (const name of ['postal-mime.js.map', 'postal-mime.d.ts.map']) {
            const map = JSON.parse(readDist(format, name));
            assert.deepStrictEqual(map.sources, ['../../src/postal-mime.ts'], format + '/' + name);
        }
    }

    assert.deepStrictEqual(JSON.parse(readDist('esm', 'package.json')), { type: 'module' });
    assert.deepStrictEqual(JSON.parse(readDist('cjs', 'package.json')), { type: 'commonjs' });
});

test('Built package - points every exports map entry at a built file', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const [subpath, entry] of Object.entries(pkg.exports)) {
        // a condition maps to a path, or to nested conditions
        const targets: string[] = [];
        const collect = (value: unknown): void => {
            if (typeof value === 'string') {
                targets.push(value);
            } else {
                Object.values(value as Record<string, unknown>).forEach(collect);
            }
        };
        collect(entry);
        for (const target of targets) {
            assert.ok(fs.existsSync(path.join(root, target)), subpath + ' points at a missing file ' + target);
        }
    }
    for (const field of ['main', 'module', 'types']) {
        assert.ok(fs.existsSync(path.join(root, pkg[field])), field + ' points at a missing file ' + pkg[field]);
    }
    // the source maps refer to src/, so it has to be published with dist/
    for (const dir of ['dist', 'src']) {
        assert.ok(pkg.files.includes(dir), dir + ' is not published');
    }
});

test('Built package - keeps the parser internals out of the declarations', () => {
    for (const [format, classStart] of [
        ['esm', 'export default class PostalMime {'],
        ['cjs', 'declare class PostalMime {']
    ]) {
        const declaration = readDist(format, 'postal-mime.d.ts');
        const start = declaration.indexOf(classStart);
        assert.ok(start >= 0, format + ' declaration should declare the class as ' + classStart);
        const members = declaration.slice(start, declaration.indexOf('\n}', start));
        for (const internal of ['boundaries', 'processLine', 'readLine', 'collectNode', 'rfc822NestingDepth']) {
            assert.ok(!members.includes(internal), internal + ' leaked into the ' + format + ' declaration');
        }
        assert.match(members, /static parse\(buf: RawEmail, options\?: PostalMimeOptions\): Promise<Email>;/);
        assert.match(members, /constructor\(options\?: PostalMimeOptions\);/);
        assert.match(members, /^\s+parse\(buf: RawEmail\): Promise<Email>;/m);
    }
});

test('Built package - CommonJS declaration exports the class with export =', () => {
    const declaration = readDist('cjs', 'postal-mime.d.ts');
    assert.match(declaration, /^export = PostalMime;/m);
    assert.ok(!/^export default /m.test(declaration), 'export default must not remain');
});

test('Built package - require() resolves to the CommonJS entry point', () => {
    assert.strictEqual(require.resolve(packageName), distFile('cjs', 'postal-mime.js'));
});

test('Built package - require() returns the class with the named exports attached', () => {
    const PostalMime = require(packageName);
    assert.strictEqual(typeof PostalMime, 'function');
    assert.strictEqual(PostalMime.name, 'PostalMime');
    assert.strictEqual(typeof PostalMime.parse, 'function');
    assert.strictEqual(typeof PostalMime.addressParser, 'function');
    assert.strictEqual(typeof PostalMime.decodeWords, 'function');
    // interop for transpiled default imports
    assert.strictEqual(PostalMime.default, PostalMime);
    assert.strictEqual(PostalMime.__esModule, true);
    assert.deepStrictEqual(Object.keys(PostalMime).sort(), ['addressParser', 'decodeWords']);

    const { addressParser, decodeWords } = require(packageName);
    assert.deepStrictEqual(addressParser('Name <name@example.com>'), [{ address: 'name@example.com', name: 'Name' }]);
    assert.strictEqual(decodeWords('=?utf-8?Q?caf=C3=A9?='), 'café');
});

test('Built package - every CommonJS module has the shape its declaration announces', () => {
    const cjsRoot = distFile('cjs');
    const files = fs.readdirSync(cjsRoot).filter(name => name.endsWith('.js'));
    assert.ok(files.length >= 10, 'expected the compiled modules under dist/cjs');
    for (const name of files) {
        const declaration = readDist('cjs', name.replace(/\.js$/, '.d.ts'));
        const hasDefault = /^export default /m.test(declaration) || /^export = /m.test(declaration);
        const mod = require(path.join(cjsRoot, name));
        if (hasDefault) {
            assert.strictEqual(typeof mod, 'function', name + ' should load as its default export');
            assert.strictEqual(mod.default, mod, name + ' should alias .default to itself');
        } else {
            assert.strictEqual(typeof mod, 'object', name + ' should load as an exports object');
            assert.strictEqual(mod.__esModule, true, name);
            assert.ok(!('default' in mod), name + ' should not have a default export');
        }
    }
});

test('Built package - CommonJS build parses a message', async () => {
    const PostalMime = require(packageName);
    const email = await PostalMime.parse(message);
    assert.strictEqual(email.subject, 'Package test');
    assert.deepStrictEqual(email.from, { address: 'sender@example.com', name: 'Sender' });
    assert.strictEqual(email.text, 'Hello from the built package\n');
    const viaInstance = await new PostalMime({ attachmentEncoding: 'base64' }).parse(message);
    assert.strictEqual(viaInstance.subject, 'Package test');
});

test('Built package - import resolves to the ES module entry point', async () => {
    const url = new URL('../dist/esm/postal-mime.js', import.meta.url).href;
    const direct = await import(url);
    const byName = await import(packageName);
    assert.strictEqual(byName.default, direct.default);
    assert.strictEqual(byName.addressParser, direct.addressParser);
});

test('Built package - ES module exposes the class as the default export next to the named exports', async () => {
    const mod = await import(packageName);
    assert.deepStrictEqual(Object.keys(mod).sort(), ['addressParser', 'decodeWords', 'default']);
    assert.strictEqual(typeof mod.default, 'function');
    assert.strictEqual(mod.default.name, 'PostalMime');
    assert.deepStrictEqual(mod.addressParser('Name <name@example.com>'), [
        { address: 'name@example.com', name: 'Name' }
    ]);
    assert.strictEqual(mod.decodeWords('=?utf-8?Q?caf=C3=A9?='), 'café');
});

test('Built package - ES module build parses a message', async () => {
    const { default: PostalMime } = await import(packageName);
    const email = await PostalMime.parse(new Blob([message]));
    assert.strictEqual(email.subject, 'Package test');
    assert.strictEqual(email.text, 'Hello from the built package\n');
});

// A consumer that uses every part of the public API the way the README shows it
const consumer = `
import PostalMime, { addressParser, decodeWords } from 'postal-mime';
import type { Address, AddressGroup, AddressParserOptions, Attachment, AttachmentDisposition, AttachmentEncoding, Email, Header, HeaderLine, Mailbox, PostalMimeOptions, RawEmail } from 'postal-mime';

function isMailbox(addr: Address): addr is Mailbox {
    return addr.group === undefined;
}

export async function run(raw: RawEmail): Promise<string[]> {
    const options: PostalMimeOptions = { attachmentEncoding: 'base64', maxNestingDepth: 100 };
    const email: Email = await PostalMime.parse(raw, options);
    const again: Email = await new PostalMime().parse(raw);
    const encoding: AttachmentEncoding = 'utf8';
    const parserOptions: AddressParserOptions = { flatten: true };
    const addresses: Address[] = addressParser('Team: a@example.com;', parserOptions);
    const decoded: string = decodeWords('=?utf-8?Q?x?=');
    const headers: Header[] = email.headers;
    const lines: HeaderLine[] = again.headerLines;
    const attachments: Attachment[] = email.attachments;

    const out: string[] = [decoded, encoding, String(headers.length + lines.length + attachments.length)];
    for (const address of [email.from, email.sender, ...(email.to || []), ...addresses]) {
        if (!address) {
            continue;
        }
        if (isMailbox(address)) {
            out.push(address.address);
        } else {
            const group: AddressGroup = address;
            out.push(...group.group.map(member => member.name));
        }
    }
    for (const attachment of attachments) {
        // the known dispositions narrow, and any other token is still a string
        const disposition: AttachmentDisposition | null = attachment.disposition;
        if (disposition === 'inline' || disposition === 'attachment') {
            out.push(disposition);
        } else if (disposition !== null) {
            out.push(disposition.toUpperCase());
        }
        if (attachment.encoding === 'base64') {
            out.push(attachment.content as string);
        } else {
            out.push(String((attachment.content as ArrayBuffer).byteLength));
        }
        if (attachment.rfc822DepthExceeded) {
            await PostalMime.parse(attachment.content);
        }
    }
    return out;
}
`;

// The CommonJS form of the same consumer. \`import = require\` binds the class, and the
// named exports and the types are members of it. The file exports with \`export =\` as
// well, since verbatimModuleSyntax rejects ES export syntax in a CommonJS file
const requireConsumer = `
import PostalMime = require('postal-mime');

async function run(raw: PostalMime.RawEmail): Promise<PostalMime.Email> {
    const options: PostalMime.PostalMimeOptions = { attachmentEncoding: 'base64' };
    const email: PostalMime.Email = await PostalMime.parse(raw, options);
    const parser = new PostalMime(options);
    const again: PostalMime.Email = await parser.parse(raw);
    const addresses: PostalMime.Address[] = PostalMime.addressParser('Name <name@example.com>');
    const decoded: string = PostalMime.decodeWords('=?utf-8?Q?x?=');
    const attachment: PostalMime.Attachment | undefined = again.attachments[0];
    const disposition: PostalMime.AttachmentDisposition | null = attachment ? attachment.disposition : null;
    const headers: PostalMime.Header[] = again.headers;
    const mailbox: PostalMime.Mailbox | undefined = addresses[0] && addresses[0].group === undefined ? addresses[0] : undefined;
    void [decoded, disposition, headers, mailbox];
    return email;
}

export = { run };
`;

// Type-level checks of the declaration shapes.
//
// Every optional property is declared as \`T | undefined\` so that an explicit undefined is
// still accepted under exactOptionalPropertyTypes. OptionalKeys picks the keys that may be
// left out, and MissingUndefined keeps the ones that do not accept undefined, so that one
// added without \`| undefined\` fails here rather than in a consumer project.
//
// Every object type is a type alias rather than an interface, so that it keeps the
// implicit index signature the hand-written 3.0.1 declarations had and stays assignable
// to \`Record<string, unknown>\`, which is how consumers hand a parsed message to loggers
// and storage helpers. Indexable fails for an interface
const exactOptionalConsumer = `
import PostalMime, { addressParser } from 'postal-mime';
import type { AddressGroup, AddressParserOptions, Attachment, AttachmentEncoding, Email, Header, HeaderLine, Mailbox, PostalMimeOptions } from 'postal-mime';

declare const maybeNumber: number | undefined;
declare const maybeBoolean: boolean | undefined;
declare const maybeEncoding: AttachmentEncoding | undefined;

void PostalMime.parse('', { maxNestingDepth: maybeNumber, rfc822Attachments: maybeBoolean, attachmentEncoding: maybeEncoding });
void addressParser('', { flatten: maybeBoolean });

type OptionalKeys<T> = Extract<{ [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T], string>;
type MissingUndefined<T> = { [K in OptionalKeys<T>]-?: { [P in K]: undefined } extends Pick<T, K> ? never : K }[OptionalKeys<T>];
type NoneMissing<T extends never> = T;
type Indexable<T extends Record<string, unknown>> = T;

export type Checks = [
    NoneMissing<MissingUndefined<PostalMimeOptions>>,
    NoneMissing<MissingUndefined<AddressParserOptions>>,
    NoneMissing<MissingUndefined<Email>>,
    NoneMissing<MissingUndefined<Attachment>>,
    NoneMissing<MissingUndefined<Mailbox>>,
    NoneMissing<MissingUndefined<AddressGroup>>,
    Indexable<Email>,
    Indexable<Header>,
    Indexable<HeaderLine>,
    Indexable<Attachment>,
    Indexable<Mailbox>,
    Indexable<AddressGroup>,
    Indexable<PostalMimeOptions>,
    Indexable<AddressParserOptions>
];
`;

// Type-checks consumer files against the built declarations in dist/ the way an installed
// copy is resolved: the package is linked into a temporary project so that the specifiers
// go through the package.json exports map
const typeCheckConsumer = (
    files: Record<string, string>,
    compilerOptions: { [key: string]: unknown },
    type: string,
    include: string[] = Object.keys(files)
): void => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postal-mime-types-'));
    try {
        fs.mkdirSync(path.join(dir, 'node_modules'));
        // link the package itself and the node typings a real consumer has, so that
        // the specifiers resolve the way they do in an installed project
        fs.symlinkSync(root, path.join(dir, 'node_modules', 'postal-mime'), 'dir');
        fs.symlinkSync(path.join(root, 'node_modules', '@types'), path.join(dir, 'node_modules', '@types'), 'dir');
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'consumer', type }));
        for (const [name, source] of Object.entries(files)) {
            fs.writeFileSync(path.join(dir, name), source);
        }
        fs.writeFileSync(
            path.join(dir, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: {
                    target: 'ES2022',
                    lib: ['ES2022', 'DOM'],
                    types: ['node'],
                    strict: true,
                    noEmit: true,
                    skipLibCheck: true,
                    esModuleInterop: true,
                    ...compilerOptions
                },
                include
            })
        );

        const result = spawnSync(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json')], { encoding: 'utf8' });
        assert.strictEqual(result.status, 0, 'tsc reported\n' + result.stdout + result.stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const typeCheckOptions = { timeout: 120 * 1000 };

// node16 is what an installed copy resolves through the exports map, in a CommonJS and in
// an ES module project, bundler is what the common front end tool chains use, and node10
// is what older CommonJS projects still compile with. The exactOptionalPropertyTypes sweep
// and the \`import = require\` consumer ride along with the CommonJS projects, and the
// latter also has to pass under verbatimModuleSyntax, which rejects every other import form
// in a CommonJS file
const node16 = { module: 'node16', moduleResolution: 'node16' };
const projects = [
    {
        name: 'node16 CommonJS with exactOptionalPropertyTypes',
        type: 'commonjs',
        options: { ...node16, exactOptionalPropertyTypes: true },
        files: {
            'consumer.ts': consumer,
            'exact-optional.ts': exactOptionalConsumer,
            'require-consumer.ts': requireConsumer
        }
    },
    { name: 'node16 ES module', type: 'module', options: node16, files: { 'consumer.ts': consumer } },
    {
        name: 'bundler',
        type: 'module',
        options: { module: 'esnext', moduleResolution: 'bundler' },
        files: { 'consumer.ts': consumer }
    },
    {
        name: 'node10 CommonJS',
        type: 'commonjs',
        options: { module: 'commonjs', moduleResolution: 'node10', ignoreDeprecations: '6.0' },
        files: { 'consumer.ts': consumer, 'require-consumer.ts': requireConsumer }
    },
    {
        name: 'node16 CommonJS with verbatimModuleSyntax',
        type: 'commonjs',
        options: { ...node16, verbatimModuleSyntax: true },
        files: { 'require-consumer.ts': requireConsumer }
    }
];

for (const project of projects) {
    test('Built package types - ' + project.name + ' consumer', typeCheckOptions, () => {
        typeCheckConsumer(project.files, project.options, project.type);
    });
}

// stripInternal drops a tagged declaration without checking whether a kept one still
// refers to it, and the consumer checks above run with skipLibCheck, which hides the
// dangling reference. This type-checks every built declaration file itself instead.
// The declarations reference only ES and DOM globals, so the Node typings stay out
test('Built package types - the built declarations type-check on their own', typeCheckOptions, () => {
    typeCheckConsumer({}, { ...node16, skipLibCheck: false, types: [] }, 'commonjs', [distFile('**', '*.d.ts')]);
});
