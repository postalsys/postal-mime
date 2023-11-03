# postal-mime

Email parser for browser environments.

PostalMime can be run in the main web thread or from Web Workers.

PostalMime can be bundled using WebPack. In fact the distribution file is also built with WebPack.

## Source

Source code is available from [Github](https://github.com/postalsys/postal-mime).

## Demo

See this [example](https://kreata.ee/postal-mime/example/).

## Usage

First install the module from npm:

```
$ npm install postal-mime
```

next import the PostalMime class into your script:

```js
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';
```

or when using from a Node.js app

```js
import PostalMime from 'postal-mime';
```

### Promises

All postal-mime methods use Promises, so you need to wait using `await` or wait for the `then()` method to fire until you get the response.

#### Browser

```js
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';

const parser = new PostalMime();
const email = await parser.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(email.subject);
```

#### Node.js

It is pretty much the same as in the browser.

```js
import PostalMime from 'postal-mime';
import util from 'node:util';

const parser = new PostalMime();
const email = await parser.parse(`Subject: My awesome email 🤓
Content-Type: text/html; charset=utf-8

<p>Hello world 😵‍💫</p>`);

console.log(util.inspect(email, false, 22, true));
```

#### parser.parse()

```js
parser.parse(email) -> Promise
```

Where

-   **email** is the rfc822 formatted email. Either a string, an ArrayBuffer, a Blob object or a Node.js Buffer

> **NB** you can call `parse()` only once. If you need to parse another message, create a new _PostalMime_ object.

This method parses an email message into a structured object with the following properties:

-   **headers** is an array of headers in the same order as found from the message (topmost headers first).
    -   **headers[].key** is lowercase key of the header line, eg. `"dkim-signature"`
    -   **headers[].value** is the unprocessed value of the header line
-   **from**, **sender**, **replyTo** includes a processed object for the corresponding headers
    -   **from.name** is decoded name (empty string if not set)
    -   **from.address** is the email address
-   **deliveredTo**, **returnPath** is the email address from the corresponding header
-   **to**, **cc**, **bcc** includes an array of processed objects for the corresponding headers
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
    -   **attachment[].content** is an ArrayBuffer that contains the attachment file

## License

&copy; 2021-2023 Andris Reinman

`postal-mime` is licensed under the **MIT No Attribution license**
