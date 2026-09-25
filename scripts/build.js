// Builds the package.
//
// 1. Compiles src/ twice with tsc, in parallel: once as ES modules into dist/esm
//    and once as CommonJS into dist/cjs. Each output directory gets its own
//    package.json that pins the module format.
// 2. Rewrites the CommonJS output so that `require()` keeps returning the
//    exported class or function itself, the same shape the pre-TypeScript
//    CommonJS build had: `require('postal-mime')` is the PostalMime class with
//    the named exports attached to it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = require.resolve('typescript/bin/tsc');

function runTsc(project) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [tsc, '-p', project], { cwd: root, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', code =>
            code === 0 ? resolve() : reject(new Error(`tsc -p ${project} exited with code ${code}`))
        );
    });
}

function listFiles(dir, ext) {
    return fs
        .readdirSync(dir, { recursive: true })
        .filter(name => name.endsWith(ext))
        .map(name => path.join(dir, name));
}

// Modules that deliberately combine a default export with named runtime exports.
// Every other module with a default export must have no other runtime export so
// that `require()` can return the default export itself, see applyCjsInterop.
const MIXED_EXPORT_MODULES = new Set(['postal-mime.js']);

// tsc emits `exports.default = X` for `export default X`. Make `require()` return X
// directly instead of the exports object. The default export stays reachable as a
// non-enumerable `.default` property, which is what TypeScript and Babel generated
// `import X from '...'` code reads.
//
// A module that has both a default export and named runtime exports gets the named
// exports copied onto the default export, so `require('postal-mime')` is the class and
// `require('postal-mime').addressParser` still works. Such a module has to be listed in
// MIXED_EXPORT_MODULES so that the shape is a decision rather than an accident, since
// it makes the named exports properties of the class.
function applyCjsInterop(dir) {
    const namedExport = /\bexports\.(?!default\b)[A-Za-z_$][\w$]*\s*=/;
    const definedExport = /Object\.defineProperty\(exports,\s*"(?!__esModule")/;
    const starExport = /__exportStar\(/;
    const defaultExport = /\bexports\.default\s*=/;

    for (const file of listFiles(dir, '.js')) {
        const source = fs.readFileSync(file, 'utf8');
        if (!defaultExport.test(source)) {
            continue;
        }
        const name = path.relative(dir, file);
        const mixed = namedExport.test(source) || definedExport.test(source) || starExport.test(source);
        if (mixed && !MIXED_EXPORT_MODULES.has(name)) {
            throw new Error(
                name +
                    ' has a default export and named runtime exports. Keep default-export modules default-only ' +
                    '(attach extra values as properties of the exported function or class), or list the file in ' +
                    'MIXED_EXPORT_MODULES in scripts/build.js'
            );
        }
        const shim =
            (mixed
                ? 'for (const key of Object.keys(exports)) {\n' +
                  '    if (key !== "default") {\n' +
                  '        exports.default[key] = exports[key];\n' +
                  '    }\n' +
                  '}\n' +
                  "Object.defineProperty(exports.default, '__esModule', { value: true });\n"
                : '') +
            "Object.defineProperty(exports.default, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });\n" +
            'module.exports = exports.default;\n';
        const mapComment = source.lastIndexOf('//# sourceMappingURL=');
        const patched =
            mapComment === -1 ? source + shim : source.slice(0, mapComment) + shim + source.slice(mapComment);
        fs.writeFileSync(file, patched);
    }
}

async function build() {
    fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

    // independent projects with separate output directories
    await Promise.all([runTsc('tsconfig.esm.json'), runTsc('tsconfig.cjs.json')]);

    fs.writeFileSync(
        path.join(root, 'dist', 'esm', 'package.json'),
        JSON.stringify({ type: 'module' }, null, 4) + '\n'
    );
    fs.writeFileSync(
        path.join(root, 'dist', 'cjs', 'package.json'),
        JSON.stringify({ type: 'commonjs' }, null, 4) + '\n'
    );

    applyCjsInterop(path.join(root, 'dist', 'cjs'));
}

build().catch(err => {
    console.error(err.message);
    process.exit(1);
});
