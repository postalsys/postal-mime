import { describe, it } from 'node:test';
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

describe('Built package', { timeout: 30 * 1000 }, () => {
    it('ships both module formats with type declarations', () => {
        for (const format of ['esm', 'cjs']) {
            assert.ok(fs.existsSync(path.join(root, 'dist', format, 'postal-mime.js')), format + ' entry point');
            assert.ok(
                fs.existsSync(path.join(root, 'dist', format, 'postal-mime.d.ts')),
                format + ' type declarations'
            );
        }
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'esm', 'package.json'), 'utf8')), {
            type: 'module'
        });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'cjs', 'package.json'), 'utf8')), {
            type: 'commonjs'
        });
    });

    it('points every exports map entry at a built file', () => {
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
    });

    it('keeps the parser internals out of the declarations', () => {
        const declaration = fs.readFileSync(path.join(root, 'dist', 'esm', 'postal-mime.d.ts'), 'utf8');
        const members = declaration.slice(declaration.indexOf('export default class PostalMime'));
        for (const internal of ['boundaries', 'processLine', 'readLine', 'processNodeTree', 'rfc822NestingDepth']) {
            assert.ok(!members.includes(internal), internal + ' leaked into the public declaration');
        }
        assert.match(members, /static parse\(buf: RawEmail, options\?: PostalMimeOptions\): Promise<Email>;/);
        assert.match(members, /constructor\(options\?: PostalMimeOptions\);/);
        assert.match(members, /^\s+parse\(buf: RawEmail\): Promise<Email>;/m);
    });

    describe('CommonJS build', () => {
        it('resolves require() to the CommonJS entry point', () => {
            assert.strictEqual(require.resolve(packageName), path.join(root, 'dist', 'cjs', 'postal-mime.js'));
        });

        it('loads as the PostalMime class with the named exports attached', () => {
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
            assert.deepStrictEqual(addressParser('Name <name@example.com>'), [
                { address: 'name@example.com', name: 'Name' }
            ]);
            assert.strictEqual(decodeWords('=?utf-8?Q?caf=C3=A9?='), 'café');
        });

        it('gives every internal module the shape its declaration announces', () => {
            const cjsRoot = path.join(root, 'dist', 'cjs');
            const files = fs.readdirSync(cjsRoot).filter(name => name.endsWith('.js'));
            assert.ok(files.length >= 10, 'expected the compiled modules under dist/cjs');
            for (const name of files) {
                const declaration = fs.readFileSync(path.join(cjsRoot, name.replace(/\.js$/, '.d.ts')), 'utf8');
                const hasDefault = /^export default /m.test(declaration);
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

        it('parses a message', async () => {
            const PostalMime = require(packageName);
            const email = await PostalMime.parse(message);
            assert.strictEqual(email.subject, 'Package test');
            assert.deepStrictEqual(email.from, { address: 'sender@example.com', name: 'Sender' });
            assert.strictEqual(email.text, 'Hello from the built package\n');
            const viaInstance = await new PostalMime({ attachmentEncoding: 'base64' }).parse(message);
            assert.strictEqual(viaInstance.subject, 'Package test');
        });
    });

    describe('ES module build', () => {
        it('resolves import to the ES module entry point', async () => {
            const url = new URL('../dist/esm/postal-mime.js', import.meta.url).href;
            const direct = await import(url);
            const byName = await import(packageName);
            assert.strictEqual(byName.default, direct.default);
            assert.strictEqual(byName.addressParser, direct.addressParser);
        });

        it('exposes the class as the default export next to the named exports', async () => {
            const mod = await import(packageName);
            assert.deepStrictEqual(Object.keys(mod).sort(), ['addressParser', 'decodeWords', 'default']);
            assert.strictEqual(typeof mod.default, 'function');
            assert.strictEqual(mod.default.name, 'PostalMime');
            assert.deepStrictEqual(mod.addressParser('Name <name@example.com>'), [
                { address: 'name@example.com', name: 'Name' }
            ]);
            assert.strictEqual(mod.decodeWords('=?utf-8?Q?caf=C3=A9?='), 'café');
        });

        it('parses a message', async () => {
            const { default: PostalMime } = await import(packageName);
            const email = await PostalMime.parse(new Blob([message]));
            assert.strictEqual(email.subject, 'Package test');
            assert.strictEqual(email.text, 'Hello from the built package\n');
        });
    });
});

// A consumer that uses every part of the public API the way the README shows it
const consumer = `
import PostalMime, { addressParser, decodeWords } from 'postal-mime';
import type { Address, AddressGroup, AddressParserOptions, Attachment, AttachmentEncoding, Email, Header, HeaderLine, Mailbox, PostalMimeOptions, RawEmail } from 'postal-mime';

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

// Every optional property is declared as `T | undefined` so that an explicit undefined is
// still accepted under exactOptionalPropertyTypes. OptionalKeys picks the keys that may be
// left out, and MissingUndefined keeps the ones that do not accept undefined, so that one
// added without \`| undefined\` fails here rather than in a consumer project
const exactOptionalConsumer = `
import PostalMime, { addressParser } from 'postal-mime';
import type { AddressGroup, AddressParserOptions, Attachment, AttachmentEncoding, Email, Mailbox, PostalMimeOptions } from 'postal-mime';

declare const maybeNumber: number | undefined;
declare const maybeBoolean: boolean | undefined;
declare const maybeEncoding: AttachmentEncoding | undefined;

void PostalMime.parse('', { maxNestingDepth: maybeNumber, rfc822Attachments: maybeBoolean, attachmentEncoding: maybeEncoding });
void addressParser('', { flatten: maybeBoolean });

type OptionalKeys<T> = Extract<{ [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T], string>;
type MissingUndefined<T> = { [K in OptionalKeys<T>]-?: { [P in K]: undefined } extends Pick<T, K> ? never : K }[OptionalKeys<T>];
type NoneMissing<T extends never> = T;

export type Checks = [
    NoneMissing<MissingUndefined<PostalMimeOptions>>,
    NoneMissing<MissingUndefined<AddressParserOptions>>,
    NoneMissing<MissingUndefined<Email>>,
    NoneMissing<MissingUndefined<Attachment>>,
    NoneMissing<MissingUndefined<Mailbox>>,
    NoneMissing<MissingUndefined<AddressGroup>>
];
`;

// node16 is what an installed copy resolves through the exports map, in a CommonJS and in
// an ES module project, and bundler is what the common front end tool chains use
const resolutions = [
    {
        name: 'node16 in a CommonJS project',
        compilerOptions: { module: 'node16', moduleResolution: 'node16' },
        type: 'commonjs'
    },
    {
        name: 'node16 in an ES module project',
        compilerOptions: { module: 'node16', moduleResolution: 'node16' },
        type: 'module'
    },
    { name: 'bundler', compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }, type: 'module' }
];

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

describe('Built package types', { timeout: 120 * 1000 }, () => {
    // The exactOptionalPropertyTypes sweep shares the first project, and the plain consumer
    // has to pass under that flag as well
    it('type-checks a consumer with ' + resolutions[0].name + ' and exactOptionalPropertyTypes', () => {
        typeCheckConsumer(
            { 'consumer.ts': consumer, 'exact-optional.ts': exactOptionalConsumer },
            { ...resolutions[0].compilerOptions, exactOptionalPropertyTypes: true },
            resolutions[0].type
        );
    });

    for (const resolution of resolutions.slice(1)) {
        it('type-checks a consumer with ' + resolution.name, () => {
            typeCheckConsumer({ 'consumer.ts': consumer }, resolution.compilerOptions, resolution.type);
        });
    }

    // stripInternal drops a tagged declaration without checking whether a kept one still
    // refers to it, and the consumer checks above run with skipLibCheck, which hides the
    // dangling reference. This type-checks every built declaration file itself instead.
    // The declarations reference only ES and DOM globals, so the Node typings stay out
    it('type-checks the built declarations themselves', () => {
        typeCheckConsumer({}, { ...resolutions[0].compilerOptions, skipLibCheck: false, types: [] }, 'commonjs', [
            path.join(root, 'dist', '**', '*.d.ts')
        ]);
    });
});
