#!/usr/bin/env node

import { build } from 'esbuild';
import { readdir, mkdir, rm, readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = join(__dirname, '../src');
const distDir = join(__dirname, '../dist');

async function buildCJS() {
    // Clean dist directory
    try {
        await rm(distDir, { recursive: true, force: true });
    } catch (err) {
        // Directory might not exist
    }

    // Create dist directory
    await mkdir(distDir, { recursive: true });

    // Get all .js files from src
    const files = await readdir(srcDir);
    const jsFiles = files.filter(file => file.endsWith('.js'));

    // Build each file
    for (const file of jsFiles) {
        const inputPath = join(srcDir, file);
        const outputName = basename(file, '.js') + '.cjs';
        const outputPath = join(distDir, outputName);

        const buildOptions = {
            entryPoints: [inputPath],
            outfile: outputPath,
            bundle: false,
            platform: 'node',
            format: 'cjs',
            target: 'node14',
            sourcemap: false,
            // Preserve imports as relative requires
            packages: 'external',
            // Add footer to all files to make default exports work naturally
            footer: {
                js: `
// Make default export work naturally with require()
if (module.exports.default) {
    var defaultExport = module.exports.default;
    var namedExports = {};
    for (var key in module.exports) {
        if (key !== 'default') {
            namedExports[key] = module.exports[key];
        }
    }
    module.exports = defaultExport;
    Object.assign(module.exports, namedExports);
}
`
            }
        };

        await build(buildOptions);

        // Post-process: Replace .js extensions with .cjs in require() calls
        let content = await readFile(outputPath, 'utf-8');
        content = content.replace(/require\(["'](\.\/.+?)\.js["']\)/g, 'require("$1.cjs")');
        await writeFile(outputPath, content, 'utf-8');

        console.log(`Built ${file} -> ${outputName}`);
    }

    console.log(`\nSuccessfully built ${jsFiles.length} files to ${distDir}`);
}

buildCJS().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
