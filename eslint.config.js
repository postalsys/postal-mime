import globals from 'globals';

// postal-mime runs in both browsers and Node, so sources are checked against the
// union of the two global sets. Only the two rules the project has always enforced
// are enabled; this is a correctness gate, not a style gate, since formatting is
// handled by Prettier.
export default [
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
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
    }
];
