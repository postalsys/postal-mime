/* globals module */

module.exports = {
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {}
    },
    env: { es6: true },
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
