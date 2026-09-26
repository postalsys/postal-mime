# postal-mime

**postal-mime** is an email parsing library for Node.js, browsers (including Web Workers), and serverless environments (like Cloudflare Email Workers). It takes in a raw email message (RFC822 format) and outputs a structured object containing headers, recipients, attachments, and more.

> [!TIP]
> PostalMime is developed by the makers of [EmailEngine](https://emailengine.app/?utm_source=github&utm_campaign=imapflow&utm_medium=readme-link), a self-hosted email gateway that provides a REST API for IMAP and SMTP servers and sends webhooks whenever something changes in registered accounts.

## Features

-   **Browser & Node.js compatible** - Works in browsers, Web Workers, Node.js, and serverless environments
-   **Written in TypeScript** - Type declarations are generated from the source and shipped for both module formats
-   **Dual package** - Published as ES modules and as CommonJS, compiled from the same source
-   **Zero dependencies** - No external dependencies
-   **RFC compliant** - Follows RFC 2822/5322 email standards
-   **Handles complex MIME structures** - Multipart messages, nested parts, attachments
-   **Security limits** - Built-in protection against deeply nested messages, oversized headers and runaway nested message parsing

> [!NOTE]
> Full documentation is available at [postal-mime.postalsys.com](https://postal-mime.postalsys.com/).

## Table of Contents

-   [Source](#source)
-   [Demo](#demo)
-   [Installation](#installation)
-   [Upgrading from 3.x](#upgrading-from-3x)
-   [Usage](#usage)
    -   [Browser](#browser)
    -   [Node.js](#nodejs)
    -   [CommonJS](#commonjs)
    -   [Cloudflare Email Workers](#cloudflare-email-workers)
-   [TypeScript Support](#typescript-support)
-   [API](#api)
    -   [PostalMime.parse()](#postalmimeparse)
    -   [Utility Functions](#utility-functions)
        -   [addressParser()](#addressparser)
        -   [decodeWords()](#decodewords)
-   [Development](#development)
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

The package needs a runtime with the `TextDecoder`, `Blob` and `ReadableStream` globals, which means Node.js 20 or newer, any modern browser, Deno, Bun or Cloudflare Workers.

## Upgrading from 3.x

Version 4 is the TypeScript rewrite. Code that imports `postal-mime` by name keeps working and the parsed output is unchanged. What did change:

-   **Browser deep imports.** The ES module build moved from `src/postal-mime.js` to `dist/esm/postal-mime.js`. Only code that loaded the file from `node_modules` by its path is affected, see [Browser](#browser).
-   **Node.js 20 or newer** is required.
-   **`Attachment.disposition`** is typed as `AttachmentDisposition | null`. The parser has always passed the Content-Disposition token through as it is, so the type now says so instead of claiming that only `attachment` and `inline` occur.
-   **Stream input** is typed as `ReadableStream<Uint8Array>`. A `ReadableStream<ArrayBuffer>` or `ReadableStream<string>` never parsed correctly and no longer type-checks. Any `ArrayBufferView`, including a `DataView`, is accepted.
-   **`addressParser`** no longer reads the undocumented `_depth` option.
-   **CommonJS TypeScript projects** get a declaration that matches what `require()` returns, see [CommonJS](#commonjs). A project that compiles with both `esModuleInterop` and `allowSyntheticDefaultImports` switched off has to use `import PostalMime = require('postal-mime')` instead of a default import.

## Usage

You can import the `PostalMime` class differently depending on your environment:

### Browser

With a bundler such as Vite, webpack or esbuild, import the package by name and the bundler picks up the ES module build:

```js
import PostalMime from 'postal-mime';
```

To load PostalMime in the browser without a bundler (including in Web Workers), import the ES module build directly:

```js
import PostalMime from './node_modules/postal-mime/dist/esm/postal-mime.js';

const email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(email.subject); // "My awesome email 🤓"
```

<details>
<summary><strong>TypeScript</strong></summary>

```typescript
import PostalMime from 'postal-mime';
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

For projects using CommonJS (with `require()`), postal-mime resolves to its CommonJS build:

```js
const PostalMime = require('postal-mime');
const { addressParser, decodeWords } = require('postal-mime');

const email = await PostalMime.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(email.subject); // "My awesome email 🤓"
```

<details>
<summary><strong>TypeScript</strong></summary>

The CommonJS declaration exports the class with `export =`, the shape `require()` returns, so both import forms are typed the same way, including under `verbatimModuleSyntax`. The types are available as members of the imported class:

```typescript
import PostalMime = require('postal-mime');
// or, with esModuleInterop
// import PostalMime, { addressParser, decodeWords } from 'postal-mime';

const email: PostalMime.Email = await PostalMime.parse(raw);
const addresses: PostalMime.Address[] = PostalMime.addressParser('Name <name@example.com>');
```

</details>

> [!NOTE]
> The ES module build in `dist/esm/` and the CommonJS build in `dist/cjs/` are compiled from the same TypeScript source, and each ships its own type declarations. `require('postal-mime')` returns the `PostalMime` class itself, with `addressParser` and `decodeWords` attached as properties.

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

PostalMime is written in TypeScript. The type declarations are generated from the source during the build and are resolved through the package `exports` map, so no separate `@types` package is needed. All types can be imported from the main package:

```typescript
import PostalMime, { addressParser, decodeWords } from 'postal-mime';
import type {
    Email,
    Address,
    Mailbox,
    AddressGroup,
    Header,
    HeaderLine,
    Attachment,
    AttachmentDisposition,
    AttachmentEncoding,
    PostalMimeOptions,
    AddressParserOptions,
    RawEmail
} from 'postal-mime';
```

### Available Types

-   **`Email`** - The main parsed email object returned by `PostalMime.parse()`
-   **`Address`** - Union type representing either a `Mailbox` or an `AddressGroup`
-   **`Mailbox`** - Individual email address with name and address fields
-   **`AddressGroup`** - RFC 5322 address group with a name and a list of `Mailbox` members
-   **`Header`** - Email header with key, original key and value
-   **`HeaderLine`** - Raw header line with key and the complete line as it appeared in the message
-   **`Attachment`** - Email attachment with metadata and content
-   **`AttachmentDisposition`** - The lowercased Content-Disposition token of an attachment, `attachment` or `inline` for most parts
-   **`AttachmentEncoding`** - The accepted values of the `attachmentEncoding` option
-   **`PostalMimeOptions`** - Configuration options for parsing
-   **`AddressParserOptions`** - Configuration options for address parsing
-   **`RawEmail`** - Union type for all accepted email input formats

Every optional property is declared as `T | undefined`, so the types also work in projects that compile with `exactOptionalPropertyTypes`.

### Type Narrowing

TypeScript users can use type guards to narrow address types:

```typescript
import type { Address, Mailbox } from 'postal-mime';

function isMailbox(addr: Address): addr is Mailbox {
    return addr.group === undefined;
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

-   **email**: An RFC822 formatted email. This can be a `string`, an `ArrayBuffer`, a `Uint8Array` or any other `ArrayBufferView` (including a Node.js `Buffer` and a `DataView`), a `Blob`, or a [ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream). A stream is read to completion before parsing starts.
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
    -   `originalKey`: The header name as written in the message, preserving case.
    -   `value`: Header value as a string, unfolded per RFC 5322 and otherwise unprocessed. Unfolding removes the line break of a folded header and keeps the folding whitespace, so `Subject: Hello\r\n    World` reads as `Hello    World`. Encoded words are not decoded here.

    Headers appear in the order they were sent, including duplicates. Where a single value is exposed on its own property, such as `subject` or `from`, the first occurrence of the header wins.

-   **headerLines**: An array of `HeaderLine` objects in the same order as `headers`, each containing:
    -   `key`: Lowercase header name.
    -   `line`: The complete raw header line, including the name and the original line breaks of a folded header.
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
    -   `disposition`: The lowercased Content-Disposition token, usually `"attachment"` or `"inline"`, or `null` if the part had no such header. Other tokens a message carries are passed through as they are
    -   `related`: Boolean (optional, `true` if the part sits in a `multipart/related` tree and has a Content-ID, such as an inline image)
    -   `contentId`: String (optional)
    -   `description`: String (optional, the decoded Content-Description header)
    -   `method`: String (optional, the uppercased `method` parameter of a calendar part, such as `"REQUEST"`)
    -   `rfc822DepthExceeded`: Boolean (optional, see the warning above)
    -   `content`: `ArrayBuffer` or string, depending on `attachmentEncoding`. Calendar parts are normalized to UTF-8 text with LF line endings and returned as a `Uint8Array`
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

## Development

The source lives in `src/` as TypeScript. `npm run build` compiles it twice, into `dist/esm/` as ES modules and into `dist/cjs/` as CommonJS, each with its own type declarations, source maps and declaration maps. `dist/` and `src/` are published, so stack traces and go-to-definition land in the TypeScript source. The build runs automatically on `npm install`.

```bash
npm install          # installs dependencies and builds dist/
npm test             # builds, then runs the test suite against src/ and the built package, one file at a time
npm run lint         # ESLint and a full type-check of src/ and test/
npm run format       # Prettier
```

---

## License

&copy; 2021-2026 Andris Reinman

`postal-mime` is licensed under the **MIT No Attribution license**.
