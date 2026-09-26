// Builds the package.
//
// 1. Compiles src/ twice with the TypeScript compiler API: once as ES modules into
//    dist/esm and once as CommonJS into dist/cjs. Each output directory gets its own
//    package.json that pins the module format.
// 2. Rewrites the CommonJS output so that `require()` keeps returning the exported
//    class or function itself, the same shape the pre-TypeScript CommonJS build had:
//    `require('postal-mime')` is the PostalMime class with the named exports attached
//    to it.
// 3. Emits the CommonJS declaration of the entry point in `export =` form, so that
//    TypeScript sees the same shape that `require()` returns.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const formatHost = {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n'
};

function reportDiagnostics(diagnostics, project) {
    if (diagnostics.length) {
        console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
        throw new Error(`${project}: compilation failed`);
    }
}

// Compiles one tsconfig project the way `tsc -p` does, with optional custom
// transformers, which the command line has no way to pass
function compile(project, customTransformers) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
        path.join(root, project),
        {},
        { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => reportDiagnostics([diagnostic], project) }
    );
    reportDiagnostics(parsed.errors, project);

    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const emitted = program.emit(undefined, undefined, undefined, false, customTransformers);
    reportDiagnostics(ts.getPreEmitDiagnostics(program).concat(emitted.diagnostics), project);
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

// The entry point is declared in ES module form, `export default class` with named
// exports beside it. Read from a CommonJS project, TypeScript takes that as
// `exports.default`, so `import PostalMime = require('postal-mime')` types the class as
// the module object and `new PostalMime()` does not compile even though it runs, and a
// project with verbatimModuleSyntax has no typed import form at all. This declaration
// transformer turns it into the shape `require()` returns: the class merged with a
// namespace that carries the named exports and the types, exported with `export =`.
// A hand-written declaration would have to repeat the class signature, so it is
// generated from the same source instead.
//
// Type-only imports stay, since the class signature refers to them. Value exports become
// `typeof import()` members and type re-exports become `import()` type aliases, so that
// the namespace members can not shadow what they alias. The class keeps its source
// positions, so the declaration map stays valid for it.
const ENTRY_POINT = path.join(root, 'src', 'postal-mime.ts');

const exportEqualsTransformer = () => sourceFile => {
    if (path.resolve(sourceFile.fileName) !== ENTRY_POINT) {
        return sourceFile;
    }

    const f = ts.factory;
    const fail = message => {
        throw new Error(`${path.relative(root, sourceFile.fileName)}: ${message}`);
    };
    const exportModifier = () => [f.createModifier(ts.SyntaxKind.ExportKeyword)];
    const declareModifier = () => [f.createModifier(ts.SyntaxKind.DeclareKeyword)];

    // where each imported binding comes from, to resolve `export { name }`
    const importSources = new Map();
    const kept = [];
    const members = [];
    let defaultClass = null;

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const specifier = statement.moduleSpecifier.text;
            const clause = statement.importClause;
            if (clause.name) {
                importSources.set(clause.name.text, { specifier, name: 'default' });
            }
            if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                for (const element of clause.namedBindings.elements) {
                    importSources.set(element.name.text, {
                        specifier,
                        name: (element.propertyName || element.name).text
                    });
                }
            }
            if (clause.isTypeOnly) {
                kept.push(statement);
            }
            continue;
        }

        if (ts.isExportDeclaration(statement)) {
            if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
                fail('only named exports are supported');
            }
            const specifier = statement.moduleSpecifier ? statement.moduleSpecifier.text : null;
            for (const element of statement.exportClause.elements) {
                const local = (element.propertyName || element.name).text;
                const exported = element.name.text;
                const from = specifier ? { specifier, name: local } : importSources.get(local);
                if (!from) {
                    fail(`can not resolve the source of export ${exported}`);
                }
                const moduleRef = f.createLiteralTypeNode(f.createStringLiteral(from.specifier));
                const qualifier = f.createIdentifier(from.name);
                if (statement.isTypeOnly || element.isTypeOnly) {
                    // export type Name = import('./module.js').Name;
                    members.push(
                        f.createTypeAliasDeclaration(
                            exportModifier(),
                            exported,
                            undefined,
                            f.createImportTypeNode(moduleRef, undefined, qualifier, undefined, false)
                        )
                    );
                } else {
                    // export const name: typeof import('./module.js').name;
                    members.push(
                        f.createVariableStatement(
                            exportModifier(),
                            f.createVariableDeclarationList(
                                [
                                    f.createVariableDeclaration(
                                        exported,
                                        undefined,
                                        f.createImportTypeNode(moduleRef, undefined, qualifier, undefined, true)
                                    )
                                ],
                                ts.NodeFlags.Const
                            )
                        )
                    );
                }
            }
            continue;
        }

        if (
            ts.isClassDeclaration(statement) &&
            (statement.modifiers || []).some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
        ) {
            defaultClass = statement;
            continue;
        }

        // Types declared in the entry point itself would have to be moved into the
        // namespace while the class keeps referring to them by their bare names. Public
        // types belong in src/types.ts, which the entry point re-exports
        fail(`unexpected ${ts.SyntaxKind[statement.kind]}, declare public types in src/types.ts`);
    }

    if (!defaultClass || !defaultClass.name) {
        fail('expected a named default export class');
    }
    const name = defaultClass.name.text;

    const declaredClass = f.updateClassDeclaration(
        defaultClass,
        declareModifier(),
        defaultClass.name,
        defaultClass.typeParameters,
        defaultClass.heritageClauses,
        defaultClass.members
    );
    const namespace = f.createModuleDeclaration(
        declareModifier(),
        f.createIdentifier(name),
        f.createModuleBlock(members),
        ts.NodeFlags.Namespace
    );
    const exportEquals = f.createExportAssignment(undefined, true, f.createIdentifier(name));

    const statements = [...kept, declaredClass, namespace, exportEquals];
    ts.addSyntheticLeadingComment(
        statements[0],
        ts.SyntaxKind.SingleLineCommentTrivia,
        ` CommonJS declaration of the entry point, see scripts/build.js. \`require()\` returns the ${name}`,
        true
    );
    ts.addSyntheticLeadingComment(
        statements[0],
        ts.SyntaxKind.SingleLineCommentTrivia,
        ' class with the named exports attached, so the class is exported with `export =` and carries',
        true
    );
    ts.addSyntheticLeadingComment(
        statements[0],
        ts.SyntaxKind.SingleLineCommentTrivia,
        ' the named exports and the types as a namespace.',
        true
    );
    return f.updateSourceFile(sourceFile, statements);
};

function build() {
    fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

    compile('tsconfig.esm.json');
    compile('tsconfig.cjs.json', { afterDeclarations: [exportEqualsTransformer] });

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

try {
    build();
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
