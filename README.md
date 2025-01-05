# postal-mime

**postal-mime** is an email parsing library that runs in browser environments (including Web Workers) and serverless functions (like Cloudflare Email Workers). It takes in a raw email message (RFC822 format) and outputs a structured object containing headers, recipients, attachments, and more.

> **Tip**  
> PostalMime is developed by the makers of [EmailEngine](https://emailengine.app/?utm_source=github&utm_campaign=imapflow&utm_medium=readme-link)—a self-hosted email gateway that provides a REST API for IMAP and SMTP servers and sends webhooks whenever something changes in registered accounts.

## Table of Contents

-   [Source](#source)
-   [Demo](#demo)
-   [Installation](#installation)
-   [Usage](#usage)
    -   [Browser](#browser)
    -   [Node.js](#nodejs)
    -   [Cloudflare Email Workers](#cloudflare-email-workers)
-   [API](#api)
    -   [PostalMime.parse()](#postalmimeparse)
    -   [Utility Functions](#utility-functions)
        -   [addressParser()](#addressparser)
        -   [decodeWords()](#decodewords)
-   [License](#license)

---

## Source

The source code is available on [GitHub](https://github.com/postalsys/postal-mime).

## Demo

Try out a live demo using the [example page](https://kreata.ee/postal-mime/example/).

## Installation

Install the module from npm:

```bash
npm install postal-mime
```

## Usage

You can import the `PostalMime` class differently depending on your environment:

### Browser

To use PostalMime in the browser (including Web Workers), import it from the `src` folder:

```js
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';

const email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(email.subject); // "My awesome email 🤓"
```

### Node.js

In Node.js (including serverless functions), import it directly from `postal-mime`:

```js
import PostalMime from 'postal-mime';
import util from 'node:util';

const email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

// Use 'util.inspect' for pretty-printing
console.log(util.inspect(email, false, 22, true));
```

### Cloudflare Email Workers

Use the `message.raw` as the raw email data for parsing:

```js
import PostalMime from 'postal-mime';

export default {
    async email(message, env, ctx) {
        const email = await PostalMime.parse(message.raw);

        console.log('Subject:', email.subject);
        console.log('HTML:', email.html);
        console.log('Text:', email.text);
    }
};
```

---

## API

### PostalMime.parse()

```js
PostalMime.parse(email, options) -> Promise<ParsedEmail>
```

-   **email**: An RFC822 formatted email. This can be a `string`, `ArrayBuffer/Uint8Array`, `Blob` (browser only), `Buffer` (Node.js), or a [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
-   **options**: Optional configuration object:
    -   **rfc822Attachments** (boolean, default: `false`): Treat `message/rfc822` attachments without a Content-Disposition as attachments.
    -   **forceRfc822Attachments** (boolean, default: `false`): Treat _all_ `message/rfc822` parts as attachments.
    -   **attachmentEncoding** (string, default: `"arraybuffer"`): Determines how attachment content is decoded in the parsed email:
        -   `"base64"`
        -   `"utf8"`
        -   `"arraybuffer"` (no decoding, returns `ArrayBuffer`)

**Returns**: A Promise that resolves to a structured object with the following properties:

-   **headers**: An array of header objects, each containing:
    -   `key`: Lowercase header name (e.g., `"dkim-signature"`).
    -   `value`: Unprocessed header value as a string.
-   **from**, **sender**: Processed address objects:
    -   `name`: Decoded display name, or an empty string if not set.
    -   `address`: Email address.
-   **deliveredTo**, **returnPath**: Single email addresses as strings.
-   **to**, **cc**, **bcc**, **replyTo**: Arrays of processed address objects (same structure as `from`).
-   **subject**: Subject line of the email.
-   **messageId**, **inReplyTo**, **references**: Values from their corresponding headers.
-   **date**: The email’s sending time in ISO 8601 format (or the original string if parsing fails).
-   **html**: String containing the HTML content of the email.
-   **text**: String containing the plain text content of the email.
-   **attachments**: Array of attachment objects:
    -   `filename`
    -   `mimeType`
    -   `disposition` (e.g., `"attachment"`, `"inline"`, or `null`)
    -   `related` (boolean, `true` if it’s an inline image)
    -   `contentId`
    -   `content` (array buffer or string, depending on `attachmentEncoding`)
    -   `encoding` (e.g., `"base64"`)

---

### Utility Functions

#### addressParser()

```js
import { addressParser } from 'postal-mime';

addressParser(addressStr, opts) -> Array
```

-   **addressStr**: A raw address header string.
-   **opts**: Optional configuration:
    -   **flatten** (boolean, default: `false`): If `true`, ignores address groups and returns a flat array of addresses.

**Returns**: An array of address objects, which can be nested if address groups are present.

**Example**:

```js
const addressStr = '=?utf-8?B?44Ko44Od44K544Kr44O844OJ?= <support@example.com>';
console.log(addressParser(addressStr));
// [ { name: 'エポスカード', address: 'support@example.com' } ]
```

#### decodeWords()

```js
import { decodeWords } from 'postal-mime';

decodeWords(encodedStr) -> string
```

-   **encodedStr**: A string that may contain MIME encoded-words.

**Returns**: A Unicode string with all encoded-words decoded.

**Example**:

```js
const encodedStr = 'Hello, =?utf-8?B?44Ko44Od44K544Kr44O844OJ?=';
console.log(decodeWords(encodedStr));
// Hello, エポスカード
```

---

## License

&copy; 2021–2025 Andris Reinman

`postal-mime` is licensed under the **MIT No Attribution license**.
