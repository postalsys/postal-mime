import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// postal-mime runs in both browsers and Node, so sources are checked against the
// union of the two global sets. Only the two rules the project has always enforced
// are enabled; this is a correctness gate, not a style gate, since formatting is
// handled by Prettier. TypeScript files additionally get the typescript-eslint
// recommended set, and the compiler takes over global checking for them.
export default defineConfig([
    {
        ignores: ['node_modules/**', 'dist/**']
    },
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.ts'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node
            }
        },
        rules: {
            semi: 'error',
            'no-undef': 'error'
        }
    },
    {
        files: ['**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs'
        }
    },
    {
        files: ['**/*.ts'],
        extends: [tseslint.configs.recommended],
        rules: {
            // Handled by the TypeScript compiler
            'no-undef': 'off',
            // Project preferences
            'prefer-const': 'off',
            '@typescript-eslint/no-explicit-any': 'off'
        }
    }
]);
