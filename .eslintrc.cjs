/* globals module */

module.exports = {
    parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        ecmaFeatures: {}
    },
    env: {
        browser: true,
        node: true,
        es2024: true
    },
    rules: {
        semi: 'error',
        'no-undef': 'error'
    },
    globals: {
        TextDecoder: 'readable',
        TextEncoder: 'readable',
        Blob: 'readable',
        FileReader: 'readable',
        console: 'readable',
        Intl: 'readable'
    }
};
