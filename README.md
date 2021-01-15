# postal-mime

Email parser for browser environments.

PostalMime can be run in the main web thread or from Web Workers. Expects emails as ArrayBufer values.

## Source

Source code is available from [Github](https://github.com/postalsys/postal-mime).

## Usage

### Free, AGPL-licensed version

First install the module from npm:

```
$ npm install postal-mime
```

next import the PostalMime class into your script:

```js
const { PostalMime } = require('postal-mime');
```

or when using as a global

```html
<script src="/path/to/postal-mime.js"></script>
<script>
    const PostalMime = postalMime.default;
</script>
```

### MIT version

MIT-licensed version is available for [Postal Systems subscribers](https://postalsys.com/).

First install the module from Postal Systems private registry:

```
$ npm install @postalsys/postal-mime
```

next import the postal-mime class into your script:

```js
const { PostalMime } = require('@postalsys/postal-mime');
```

If you have already built your application using the free version of postal-mime and do not want to modify require statements in your code, you can install the MIT-licensed version as an alias for "postal-mime".

```
$ npm install postal-mime@npm:@postalsys/postal-mime
```

This way you can keep using the old module name

```js
const { PostalMime } = require('postal-mime');
```

### Promises

All postal-mime methods use Promises, so you need to wait using `await` or wait for the `then()` method to fire until you get the response.

```js
const { PostalMime } = require('postal-mime');
const parser = new PostalMime();
const email = await parser.parse(emailAsAnArrayBuffer);
console.log(email.subject);
console.log(email.html);
```

## License

&copy; 2020 Andris Reinman

Licensed under GNU Affero General Public License v3.0 or later.

MIT-licensed version of postal-mime is available for [Postal Systems subscribers](https://postalsys.com/).

