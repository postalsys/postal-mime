# postal-mime

Email parser for browser and serverless environments.

PostalMime can be run in the main web thread or from Web Workers. It can also used in serverless functions.

> [!TIP]
> PostalMime is developed by the makers of **[EmailEngine](https://emailengine.app/?utm_source=github&utm_campaign=imapflow&utm_medium=readme-link)** – a self-hosted email gateway that allows making **REST requests against IMAP and SMTP servers**. EmailEngine also sends webhooks whenever something changes on the registered accounts.

## Source

The source code is available from [Github](https://github.com/postalsys/postal-mime).

## Demo

See this [example](https://kreata.ee/postal-mime/example/).

## Usage

First, install the module from npm:

```
$ npm install postal-mime
```

next import the PostalMime class into your script:

```js
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';
```

or when using from a Node.js app or in a serverless function:

```js
import PostalMime from 'postal-mime';
```

### Promises

PostalMime methods use Promises, so you need to wait using `await` or wait for the `then()` method to fire until you get the response.

#### Browser

```js
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';

const email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(email.subject);
```

#### Node.js

It is pretty much the same as in the browser.

```js
import PostalMime from 'postal-mime';
import util from 'node:util';

const email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(util.inspect(email, false, 22, true));
```

#### Cloudflare [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)

Pretty much the same as in Node.js. Use `message.raw` as the raw message for parsing.

```js
import PostalMime from 'postal-mime';

export default {
    async email(message, env, ctx) {
        const email = await PostalMime.parse(message.raw);

        console.log('Subject: ', email.subject);
        console.log('HTML: ', email.html);
        console.log('Text: ', email.text);
    }
};
```

#### PostalMime.parse()

`parse(email)` is a static class method to parse emails

```js
PostalMime.parse(email) -> Promise
```

Where

-   **email** is the rfc822 formatted email. Either a string, an ArrayBuffer/Uint8Array value, a Blob object, a Node.js Buffer, or a [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)

This method parses an email message into a structured object with the following properties:

-   **headers** is an array of headers in the same order as found from the message (topmost headers first).
    -   **headers[].key** is lowercase key of the header line, eg. `"dkim-signature"`
    -   **headers[].value** is the unprocessed value of the header line
-   **from**, **sender** includes a processed object for the corresponding headers
    -   **from.name** is decoded name (empty string if not set)
    -   **from.address** is the email address
-   **deliveredTo**, **returnPath** is the email address from the corresponding header
-   **to**, **cc**, **bcc**, **replyTo** includes an array of processed objects for the corresponding headers
    -   **to[].name** is decoded name (empty string if not set)
    -   **to[].address** is the email address
-   **subject** is the email subject line
-   **messageId**, **inReplyTo**, **references** includes the value as found from the corresponding header without any processing
-   **date** is the email sending time formatted as an ISO date string (unless parsing failed and in this case the original value is used)
-   **html** is the HTML content of the message as a string
-   **text** is the plaintext content of the message as a string
-   **attachments** is an array that includes message attachments
    -   **attachment[].filename** is the file name if provided
    -   **attachment[].mimeType** is the MIME type of the attachment
    -   **attachment[].disposition** is either "attachment", "inline" or `null` if disposition was not provided
    -   **attachment[].related** is a boolean value that indicats if this attachment should be treated as embedded image
    -   **attachment[].contentId** is the ID from Content-ID header
    -   **attachment[].content** is an Uint8Array value that contains the attachment file

### Utility functions

#### addressParser

Parse email address strings

```js
addressParser(addressStr, opts) -> Array
```

where

-   **addressStr** is the header value for an address header
-   **opts** is an optional options object
    -   **flattem** is a boolean value. If set to `true`, then ignores address groups and returns a flat array of addresses. By default (`flatten` is `false`) the result might include nested groups

The result is an array of objects

-   **name** is the name string. An empty string is used if name value was not set.
-   **address** is the email address value

```js
import { addressParser } from 'postal-mime';

const addressStr = '=?utf-8?B?44Ko44Od44K544Kr44O844OJ?= <support@example.com>';
console.log(addressParser(addressStr));
// [ { name: 'エポスカード', address: 'support@example.com' } ]
```

#### decodeWords

Decode MIME encoded-words

```js
decodeWords(encodedStr) -> String
```

where

-   **encodedStr** is a string value that _may_ include MIME encoded-words

The result is a unicode string

```js
import { decodeWords } from 'postal-mime';

const encodedStr = 'Hello, =?utf-8?B?44Ko44Od44K544Kr44O844OJ?=';
console.log(decodeWords(encodedStr));
// Hello, エポスカード
```

## License

&copy; 2021-2024 Andris Reinman

`postal-mime` is licensed under the **MIT No Attribution license**
