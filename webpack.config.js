/* globals require, module, __dirname, process */

const path = require('path');

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

const clientConfig = {
    entry: './src/postal-mime.js',
    mode,
    target: 'web',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'postal-mime.js',
        library: 'postalMime',
        libraryTarget: 'umd'
    }
};

const serverConfig = {
    entry: './src/postal-mime.js',
    mode,
    target: 'node',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'node.js',
        library: 'postalMime',
        libraryTarget: 'commonjs'
    }
};

module.exports = [serverConfig, clientConfig];
