/* globals globalThis, require, Buffer */

globalThis.Blob = require('cross-blob');
const PostalMime = require('../dist/node').postalMime.default;

new PostalMime()
    .parse(
        Buffer.from(
            `Subject: test
From: andris@kreata.ee
To: andris@ethereal.email

Hello world`
        )
    )
    .then(res => console.log(res));
