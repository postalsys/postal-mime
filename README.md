# postal-mime

Email parser for browser and serverless environments.

PostalMime can be run in the main web thread or from Web Workers. It can also be used in serverless functions like Cloudflare Email Workers.

> [!TIP]
> PostalMime is developed by the makers of **[EmailEngine](https://emailengine.app/?utm_source=github&utm_campaign=imapflow&utm_medium=readme-link)** – a self-hosted email gateway that allows making **REST requests against IMAP and SMTP servers**. EmailEngine also sends webhooks whenever something changes on the registered accounts.

## Source

The source code is available on [GitHub](https://github.com/postalsys/postal-mime).

## Demo

See this [example](https://kreata.ee/postal-mime/example/).

## Usage

First, install the module from npm:

```
$ npm install postal-mime
```

Next, import the PostalMime class into your script:

```js
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';
```

Or when using it from a Node.js app or in a serverless function:

```js
import PostalMime from 'postal-mime';
```

### Promises

PostalMime methods use Promises, so you need to wait using `await` or the `then()` method to get the response.

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

`parse(email, options)` is a static class method used to parse emails.

```js
PostalMime.parse(email, options) -> Promise
```

Where:

-   **email**: The RFC822 formatted email. This can be a string, an ArrayBuffer/Uint8Array, a Blob object, a Node.js Buffer, or a [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
-   **options**: An optional object containing configuration options.
    -   **rfc822Attachments**: A boolean (defaults to `false`). If set to `true`, then treats `message/rfc822` attachments without a Content-Disposition declaration as attachments. By default, these messages are treated as inline values.
    -   **forceRfc822Attachments**: A boolean (defaults to `false`). If set to `true`, then treats all `message/rfc822` nodes as attachments.

This method parses an email message into a structured object with the following properties:

-   **headers**: An array of headers in the order they appear in the message (topmost headers first).
    -   **headers[].key**: The lowercase key of the header line, e.g., `"dkim-signature"`.
    -   **headers[].value**: The unprocessed value of the header line.
-   **from**, **sender**: Includes a processed object for the corresponding headers.
    -   **from.name**: The decoded name (empty string if not set).
    -   **from.address**: The email address.
-   **deliveredTo**, **returnPath**: The email address from the corresponding header.
-   **to**, **cc**, **bcc**, **replyTo**: An array of processed objects for the corresponding headers.
    -   **to[].name**: The decoded name (empty string if not set).
    -   **to[].address**: The email address.
-   **subject**: The email subject line.
-   **messageId**, **inReplyTo**, **references**: The value as found in the corresponding header without any processing.
-   **date**: The email sending time formatted as an ISO date string (unless parsing failed, in which case the original value is used).
-   **html**: The HTML content of the message as a string.
-   **text**: The plaintext content of the message as a string.
-   **attachments**: An array that includes the message attachments.
    -   **attachments[].filename**: The file name if provided.
    -   **attachments[].mimeType**: The MIME type of the attachment.
    -   **attachments[].disposition**: Either "attachment", "inline", or `null` if disposition was not provided.
    -   **attachments[].related**: A boolean value indicating if this attachment should be treated as an embedded image.
    -   **attachments[].contentId**: The ID from the Content-ID header.
    -   **attachments[].content**: A Uint8Array value that contains the attachment file.

### Utility Functions

#### addressParser

Parse email address strings.

```js
addressParser(addressStr, opts) -> Array
```

Where:

-   **addressStr**: The header value for an address header.
-   **opts**: An optional object containing configuration options.
    -   **flatten**: A boolean value. If set to `true`, it ignores address groups and returns a flat array of addresses. By default (`flatten` is `false`), the result might include nested groups.

The result is an array of objects:

-   **name**: The name string. An empty string is used if the name value is not set.
-   **address**: The email address value.
-   **group**: An array of nested address objects. This is used when `flatten` is `false` (the default) and the address string contains address group syntax.

```js
import { addressParser } from 'postal-mime';

const addressStr = '=?utf-8?B?44Ko44Od44K544Kr44O844OJ?= <support@example.com>';
console.log(addressParser(addressStr));
// [ { name: 'エポスカード', address: 'support@example.com' } ]
```

#### decodeWords

Decode MIME encoded-words.

```js
decodeWords(encodedStr) -> String
```

Where:

-   **encodedStr**: A string value that _may_ include MIME encoded-words.

The result is a Unicode string.

```js
import { decodeWords } from 'postal-mime';

const encodedStr = 'Hello, =?utf-8?B?44Ko44Od44K544Kr44O844OJ?=';
console.log(decodeWords(encodedStr));
// Hello, エポスカード
```

## License

&copy; 2021-2024 Andris Reinman

`postal-mime` is licensed under the **MIT No Attribution license**
