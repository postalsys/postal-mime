/* globals require, module, __dirname, process */

const path = require('path');

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

module.exports = {
    entry: './src/postal-mime.js',
    mode,

    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'postal-mime.js',
        library: 'postalMime',
        libraryTarget: 'umd'
    },

    watch: mode !== 'production'
};
