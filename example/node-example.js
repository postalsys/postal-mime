import PostalMime from '../src/postal-mime.js';
import util from 'node:util';
import { readFile } from 'node:fs/promises';

const filePath = process.argv[2];

const email = await PostalMime.parse(await readFile(filePath));

console.log(util.inspect(email, false, 22, true));

console.log(email.html);
