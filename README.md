# postal-mime

**postal-mime** is an email parsing library for Node.js, browsers (including Web Workers), and serverless environments (like Cloudflare Email Workers). It takes in a raw email message (RFC822 format) and outputs a structured object containing headers, recipients, attachments, and more.

> [!TIP]
> PostalMime is developed by the makers of [EmailEngine](https://emailengine.app/?utm_source=github&utm_campaign=imapflow&utm_medium=readme-link), a self-hosted email gateway that provides a REST API for IMAP and SMTP servers and sends webhooks whenever something changes in registered accounts.

## Features

-   **Browser & Node.js compatible** - Works in browsers, Web Workers, Node.js, and serverless environments
-   **TypeScript support** - Fully typed with comprehensive type definitions
-   **Zero dependencies** - No external dependencies
-   **RFC compliant** - Follows RFC 2822/5322 email standards
-   **Handles complex MIME structures** - Multipart messages, nested parts, attachments
-   **Security limits** - Built-in protection against deeply nested messages and oversized headers

> [!NOTE]
> Full documentation is available at [postal-mime.postalsys.com](https://postal-mime.postalsys.com/).

## Table of Contents

-   [Source](#source)
-   [Demo](#demo)
-   [Installation](#installation)
-   [Usage](#usage)
    -   [Browser](#browser)
    -   [Node.js](#nodejs)
    -   [Cloudflare Email Workers](#cloudflare-email-workers)
-   [TypeScript Support](#typescript-support)
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

Try out a live demo using the [example page](https://postal-mime.postalsys.com/demo).

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

<details>
<summary><strong>TypeScript</strong></summary>

```typescript
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';
import type { Email } from 'postal-mime';

const email: Email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(email.subject); // "My awesome email 🤓"
```

</details>

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

<details>
<summary><strong>TypeScript</strong></summary>

```typescript
import PostalMime from 'postal-mime';
import type { Email, PostalMimeOptions } from 'postal-mime';
import util from 'node:util';

const options: PostalMimeOptions = {
    attachmentEncoding: 'base64'
};

const email: Email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`, options);

// Use 'util.inspect' for pretty-printing
console.log(util.inspect(email, false, 22, true));
```

</details>

### CommonJS

For projects using CommonJS (with `require()`), postal-mime automatically provides the CommonJS build:

```js
const PostalMime = require('postal-mime');
const { addressParser, decodeWords } = require('postal-mime');

const email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(email.subject); // "My awesome email 🤓"
```

> [!NOTE]
> The CommonJS build is automatically generated from the ESM source code during the build process. The package supports dual module format, so both `import` and `require()` work seamlessly.

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

<details>
<summary><strong>TypeScript</strong></summary>

```typescript
import PostalMime from 'postal-mime';
import type { Email } from 'postal-mime';

export default {
    async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
        const email: Email = await PostalMime.parse(message.raw);

        console.log('Subject:', email.subject);
        console.log('HTML:', email.html);
        console.log('Text:', email.text);
    }
};
```

</details>

---

## TypeScript Support

PostalMime includes comprehensive TypeScript type definitions. All types are exported and can be imported from the main package:

```typescript
import PostalMime, { addressParser, decodeWords } from 'postal-mime';
import type {
    Email,
    Address,
    Mailbox,
    Header,
    Attachment,
    PostalMimeOptions,
    AddressParserOptions,
    RawEmail
} from 'postal-mime';
```

> [!NOTE]
> PostalMime is written in JavaScript but provides comprehensive TypeScript type definitions. All types are validated through both compile-time type checking and runtime type validation tests to ensure accuracy.

### Available Types

-   **`Email`** - The main parsed email object returned by `PostalMime.parse()`
-   **`Address`** - Union type representing either a `Mailbox` or an address group
-   **`Mailbox`** - Individual email address with name and address fields
-   **`Header`** - Email header with key and value
-   **`Attachment`** - Email attachment with metadata and content
-   **`PostalMimeOptions`** - Configuration options for parsing
-   **`AddressParserOptions`** - Configuration options for address parsing
-   **`RawEmail`** - Union type for all accepted email input formats

### Type Narrowing

TypeScript users can use type guards to narrow address types:

```typescript
import type { Address, Mailbox } from 'postal-mime';

function isMailbox(addr: Address): addr is Mailbox {
    return !('group' in addr) || addr.group === undefined;
}

// Usage
if (email.from && isMailbox(email.from)) {
    console.log(email.from.address); // TypeScript knows this is a Mailbox
}
```

---

## API

### PostalMime.parse()

```js
PostalMime.parse(email, options) -> Promise<Email>
```

-   **email**: An RFC822 formatted email. This can be a `string`, `ArrayBuffer/Uint8Array`, `Blob`, `Buffer` (Node.js), or a [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
-   **options**: Optional configuration object:
    -   **rfc822Attachments** (boolean, default: `false`): Treat `message/rfc822` attachments without a Content-Disposition as attachments.
    -   **forceRfc822Attachments** (boolean, default: `false`): Treat _all_ `message/rfc822` parts as attachments.
    -   **attachmentEncoding** (string, default: `"arraybuffer"`): Determines how attachment content is decoded in the parsed email:
        -   `"base64"`
        -   `"utf8"`
        -   `"arraybuffer"` (no decoding, returns `ArrayBuffer`)
    -   **maxNestingDepth** (number, default: `256`): Maximum allowed MIME part nesting depth. Throws an error if exceeded.
    -   **maxHeadersSize** (number, default: `2097152`): Maximum allowed total header size in bytes (default 2MB). Throws an error if exceeded.
    -   **maxRfc822NestingDepth** (number, default: `10`): Maximum allowed recursion depth for inline `message/rfc822` sub-messages. Nested messages deeper than this are treated as regular attachments instead of being parsed inline, and the resulting attachment has `rfc822DepthExceeded: true` set. Use `0` to disable inline parsing entirely.

All three limit options must be non-negative integers. Any other value, including a numeric string, `NaN` or `Infinity`, throws a `TypeError`. Passing `0` means a literal zero, not "use the default".

> [!IMPORTANT]
> The `maxNestingDepth`, `maxHeadersSize` and `maxRfc822NestingDepth` options provide built-in security against malicious emails with deeply nested MIME structures or oversized headers that could cause performance issues or memory exhaustion. `maxHeadersSize` counts the header bytes of every MIME part of a message together, so a multipart cannot carry the budget again for each part it declares. Each inline `message/rfc822` sub-message is parsed by a new parser instance, so both limits start over for a sub-message. `maxRfc822NestingDepth` bounds how many such sub-parsers can be nested.
>
> These options limit nesting, not breadth. A single multipart part with a very large number of children is still expensive to parse, so untrusted input should also be bounded by size before it reaches the parser.

> [!WARNING]
> If you scan messages for malicious content, do not treat `attachments` as complete without checking `rfc822DepthExceeded`. Anything nested below `maxRfc822NestingDepth` stays inside the raw bytes of the flagged attachment and is not reflected in `text`, `html` or `attachments`, so a sender can push a payload past the limit to hide it from a scanner. Re-parse the flagged attachment's `content` if you need to see inside it:
>
> ```js
> for (const attachment of email.attachments) {
>     if (attachment.rfc822DepthExceeded) {
>         const nested = await PostalMime.parse(attachment.content);
>         // scan `nested` too, and bound how many times you do this
>     }
> }
> ```

**Returns**: A Promise that resolves to a structured `Email` object with the following properties:

-   **headers**: An array of `Header` objects, each containing:
    -   `key`: Lowercase header name (e.g., `"dkim-signature"`).
    -   `value`: Header value as a string, unfolded per RFC 5322 and otherwise unprocessed. Unfolding removes the line break of a folded header and keeps the folding whitespace, so `Subject: Hello\r\n    World` reads as `Hello    World`. Encoded words are not decoded here.

    Headers appear in the order they were sent, including duplicates. Where a single value is exposed on its own property, such as `subject` or `from`, the first occurrence of the header wins.
-   **from**, **sender**: Processed `Address` objects (can be a `Mailbox` or address group):
    -   `name`: Decoded display name, or an empty string if not set.
    -   `address`: Email address.
    -   `group`: Array of `Mailbox` objects (only for address groups).
-   **deliveredTo**, **returnPath**: Single email addresses as strings.
-   **to**, **cc**, **bcc**, **replyTo**: Arrays of `Address` objects (same structure as `from`).
-   **subject**: Subject line of the email.
-   **messageId**, **inReplyTo**, **references**: Values from their corresponding headers.
-   **date**: The email's sending time in ISO 8601 format (or the original string if parsing fails).
-   **html**: String containing the HTML content of the email.
-   **text**: String containing the plain text content of the email.
-   **attachments**: Array of `Attachment` objects:
    -   `filename`: String or `null`
    -   `mimeType`: String
    -   `disposition`: `"attachment"`, `"inline"`, or `null`
    -   `related`: Boolean (optional, `true` if it's an inline image)
    -   `contentId`: String (optional)
    -   `content`: `ArrayBuffer` or string, depending on `attachmentEncoding`
    -   `encoding`: `"base64"` or `"utf8"` (optional)

<details>
<summary><strong>TypeScript Types</strong></summary>

```typescript
import type {
    Email,
    Address,
    Mailbox,
    Header,
    Attachment,
    PostalMimeOptions,
    RawEmail
} from 'postal-mime';

// Main email parsing
const email: Email = await PostalMime.parse(rawEmail);

// With options
const options: PostalMimeOptions = {
    attachmentEncoding: 'base64',
    maxNestingDepth: 100
};
const email: Email = await PostalMime.parse(rawEmail, options);

// Working with addresses
if (email.from) {
    // Address can be either a Mailbox or a Group
    if ('group' in email.from && email.from.group) {
        // It's a group
        email.from.group.forEach((member: Mailbox) => {
            console.log(member.address);
        });
    } else {
        // It's a mailbox
        const mailbox = email.from as Mailbox;
        console.log(mailbox.address);
    }
}

// Working with attachments
email.attachments.forEach((att: Attachment) => {
    if (att.encoding === 'base64') {
        // content is a string
        const base64Content: string = att.content as string;
    } else {
        // content is ArrayBuffer (default)
        const buffer: ArrayBuffer = att.content as ArrayBuffer;
    }
});
```

</details>

---

### Utility Functions

#### addressParser()

```js
import { addressParser } from 'postal-mime';

addressParser(addressStr, opts) -> Address[]
```

-   **addressStr**: A raw address header string.
-   **opts**: Optional configuration:
    -   **flatten** (boolean, default: `false`): If `true`, ignores address groups and returns a flat array of addresses.

**Returns**: An array of `Address` objects, which can be nested if address groups are present.

**Example**:

```js
import { addressParser } from 'postal-mime';

const addressStr = '=?utf-8?B?44Ko44Od44K544Kr44O844OJ?= <support@example.com>';
console.log(addressParser(addressStr));
// [ { name: 'エポスカード', address: 'support@example.com' } ]
```

<details>
<summary><strong>TypeScript</strong></summary>

```typescript
import { addressParser } from 'postal-mime';
import type { Address, AddressParserOptions } from 'postal-mime';

const addressStr = '=?utf-8?B?44Ko44Od44K544Kr44O844OJ?= <support@example.com>';
const addresses: Address[] = addressParser(addressStr);

// With options
const options: AddressParserOptions = { flatten: true };
const flatAddresses: Address[] = addressParser(addressStr, options);
```

</details>

#### decodeWords()

```js
import { decodeWords } from 'postal-mime';

decodeWords(encodedStr) -> string
```

-   **encodedStr**: A string that may contain MIME encoded-words.

**Returns**: A Unicode string with all encoded-words decoded.

**Example**:

```js
import { decodeWords } from 'postal-mime';

const encodedStr = 'Hello, =?utf-8?B?44Ko44Od44K544Kr44O844OJ?=';
console.log(decodeWords(encodedStr));
// Hello, エポスカード
```

<details>
<summary><strong>TypeScript</strong></summary>

```typescript
import { decodeWords } from 'postal-mime';

const encodedStr = 'Hello, =?utf-8?B?44Ko44Od44K544Kr44O844OJ?=';
const decoded: string = decodeWords(encodedStr);
console.log(decoded); // Hello, エポスカード
```

</details>

---

## License

&copy; 2021-2026 Andris Reinman

`postal-mime` is licensed under the **MIT No Attribution license**.
