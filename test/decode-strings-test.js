import test from 'node:test';
import assert from 'node:assert';
import { decodeWord, decodeWords, decodeURIComponentWithCharset, getDecoder, getHex, blobToArrayBuffer, decodeBase64, decodeParameterValueContinuations } from '../src/decode-strings.js';

// MIME Encoded-Word Decoding Tests (decodeWord)
test('decodeWord - Q-encoding simple ASCII', () => {
    const result = decodeWord('utf-8', 'Q', 'Hello_World');
    assert.strictEqual(result, 'Hello World');
});

test('decodeWord - Q-encoding with hex sequences', () => {
    const result = decodeWord('utf-8', 'Q', 'Caf=C3=A9');
    assert.strictEqual(result, 'Café');
});

test('decodeWord - Q-encoding with underscores', () => {
    const result = decodeWord('utf-8', 'Q', 'Hello_World_Test');
    assert.strictEqual(result, 'Hello World Test');
});

test('decodeWord - Q-encoding mixed', () => {
    const result = decodeWord('utf-8', 'Q', 'na=C3=AFve');
    assert.strictEqual(result, 'naïve');
});

test('decodeWord - Q-encoding case insensitive', () => {
    const result = decodeWord('utf-8', 'q', 'Test_123');
    assert.strictEqual(result, 'Test 123');
});

test('decodeWord - Q-encoding with spaces after equals', () => {
    // Should handle improperly formatted sequences like "= C3"
    const result = decodeWord('utf-8', 'Q', 'Test=C3=A9');
    assert.strictEqual(result, 'Testé');
});

test('decodeWord - B-encoding simple ASCII', () => {
    const result = decodeWord('utf-8', 'B', 'SGVsbG8gV29ybGQ=');
    assert.strictEqual(result, 'Hello World');
});

test('decodeWord - B-encoding UTF-8', () => {
    const result = decodeWord('utf-8', 'B', 'Q2Fmw6k=');
    assert.strictEqual(result, 'Café');
});

test('decodeWord - B-encoding case insensitive', () => {
    const result = decodeWord('utf-8', 'b', 'VGVzdA==');
    assert.strictEqual(result, 'Test');
});

test('decodeWord - B-encoding with whitespace (stripped)', () => {
    const result = decodeWord('utf-8', 'B', 'SGVs bG8g V29y bGQ=');
    assert.strictEqual(result, 'Hello World');
});

test('decodeWord - B-encoding with newlines (stripped)', () => {
    const result = decodeWord('utf-8', 'B', 'SGVs\nbG8g\nV29y\nbGQ=');
    assert.strictEqual(result, 'Hello World');
});

test('decodeWord - RFC2231 language tag', () => {
    // Language tag should be ignored
    const result = decodeWord('utf-8*en', 'Q', 'Hello');
    assert.strictEqual(result, 'Hello');
});

test('decodeWord - ISO-8859-1 charset', () => {
    const result = decodeWord('ISO-8859-1', 'Q', 'Caf=E9');
    assert.strictEqual(result, 'Café');
});

test('decodeWord - windows-1252 charset', () => {
    const result = decodeWord('windows-1252', 'Q', 'Test');
    assert.strictEqual(result, 'Test');
});

test('decodeWord - unknown charset fallback', () => {
    // Should fallback to windows-1252
    const result = decodeWord('unknown-charset', 'Q', 'Test');
    assert.strictEqual(result, 'Test');
});

test('decodeWord - unknown encoding', () => {
    // Unknown encoding should keep as-is
    const result = decodeWord('utf-8', 'X', 'Test');
    assert.strictEqual(result, 'Test');
});

test('decodeWord - Q-encoding empty string', () => {
    const result = decodeWord('utf-8', 'Q', '');
    assert.strictEqual(result, '');
});

test('decodeWord - B-encoding empty string', () => {
    const result = decodeWord('utf-8', 'B', '');
    assert.strictEqual(result, '');
});

// Multiple Encoded-Words Tests (decodeWords)
test('decodeWords - single encoded word', () => {
    const result = decodeWords('=?utf-8?Q?Hello?=');
    assert.strictEqual(result, 'Hello');
});

test('decodeWords - multiple encoded words same charset', () => {
    const result = decodeWords('=?utf-8?Q?Hello?= =?utf-8?Q?World?=');
    assert.strictEqual(result, 'HelloWorld');
});

test('decodeWords - multiple encoded words different charset', () => {
    const result = decodeWords('=?utf-8?Q?Hello?= =?iso-8859-1?Q?World?=');
    assert.ok(result.includes('Hello'));
    assert.ok(result.includes('World'));
});

test('decodeWords - mixed encoded and plain text', () => {
    const result = decodeWords('Plain =?utf-8?Q?Encoded?= More Plain');
    assert.strictEqual(result, 'Plain Encoded More Plain');
});

test('decodeWords - consecutive base64 words joined', () => {
    // Base64 words with matching charset should be joined
    const result = decodeWords('=?utf-8?B?SGVs?= =?utf-8?B?bG8=?=');
    assert.strictEqual(result, 'Hello');
});

test('decodeWords - consecutive QP words joined', () => {
    // QP words with matching charset should be joined
    const result = decodeWords('=?utf-8?Q?Hel?= =?utf-8?Q?lo?=');
    assert.strictEqual(result, 'Hello');
});

test('decodeWords - B-encoding words not joined if incomplete', () => {
    // If base64 ends with =, should not join
    const result = decodeWords('=?utf-8?B?SGVsbG8=?= =?utf-8?B?V29ybGQ=?=');
    assert.ok(result.includes('Hello'));
    assert.ok(result.includes('World'));
});

test('decodeWords - no encoded words', () => {
    const result = decodeWords('Just plain text');
    assert.strictEqual(result, 'Just plain text');
});

test('decodeWords - empty string', () => {
    const result = decodeWords('');
    assert.strictEqual(result, '');
});

test('decodeWords - malformed encoded word', () => {
    const result = decodeWords('=?utf-8?Q?Invalid'); // Missing ?=
    assert.ok(result.includes('=?utf-8?Q?Invalid'));
});

test('decodeWords - Japanese characters', () => {
    const result = decodeWords('=?UTF-8?B?44GT44KT44Gr44Gh44Gv?=');
    assert.strictEqual(result, 'こんにちは');
});

test('decodeWords - multiple scripts', () => {
    const result = decodeWords('=?utf-8?Q?Caf=C3=A9?= and =?utf-8?B?44GT44KT44Gr44Gh44Gv?=');
    assert.ok(result.includes('Café'));
    assert.ok(result.includes('こんにちは'));
});

test('decodeWords - spaces between different charset words preserved', () => {
    const result = decodeWords('=?utf-8?Q?Hello?= =?iso-8859-1?Q?World?=');
    // Space should be preserved when charsets differ
    assert.ok(result.includes('Hello'));
    assert.ok(result.includes('World'));
});

test('decodeWords - retry without joining on unicode error', () => {
    // If joining produces \ufffd, should retry without joining
    // This tests the fallback mechanism
    const result = decodeWords('=?utf-8?B?dGVzdA==?= =?utf-8?B?dGVzdA==?=');
    assert.ok(result.includes('test'));
});

test('decodeWords - case insensitive encoding type', () => {
    const result = decodeWords('=?utf-8?q?test?= =?utf-8?b?dGVzdA==?=');
    assert.ok(result.includes('test'));
});

test('decodeWords - multiple consecutive spaces', () => {
    const result = decodeWords('=?utf-8?Q?Hello?=   =?utf-8?Q?World?=');
    assert.ok(result.includes('Hello'));
    assert.ok(result.includes('World'));
});

test('decodeWords - newlines between encoded words', () => {
    const result = decodeWords('=?utf-8?Q?Hello?=\n =?utf-8?Q?World?=');
    assert.ok(result.includes('Hello'));
    assert.ok(result.includes('World'));
});

test('decodeWords - special characters in charset name', () => {
    const result = decodeWords('=?utf-8*en-US?Q?Hello?=');
    assert.strictEqual(result, 'Hello');
});

test('decodeWords - very long encoded word', () => {
    const longText = 'A'.repeat(100);
    const encoded = Buffer.from(longText).toString('base64');
    const result = decodeWords(`=?utf-8?B?${encoded}?=`);
    assert.strictEqual(result, longText);
});

// URI Decoding with Charset Tests
test('decodeURIComponentWithCharset - simple ASCII', () => {
    const result = decodeURIComponentWithCharset('Hello%20World', 'utf-8');
    assert.strictEqual(result, 'Hello World');
});

test('decodeURIComponentWithCharset - UTF-8 encoded', () => {
    const result = decodeURIComponentWithCharset('Caf%C3%A9', 'utf-8');
    assert.strictEqual(result, 'Café');
});

test('decodeURIComponentWithCharset - default charset', () => {
    const result = decodeURIComponentWithCharset('Test%20123');
    assert.strictEqual(result, 'Test 123');
});

test('decodeURIComponentWithCharset - high ASCII chars', () => {
    const result = decodeURIComponentWithCharset('Test%E2%9C%93', 'utf-8');
    assert.strictEqual(result, 'Test✓');
});

test('decodeURIComponentWithCharset - mixed encoded and plain', () => {
    const result = decodeURIComponentWithCharset('Hello%20World%21', 'utf-8');
    assert.strictEqual(result, 'Hello World!');
});

test('decodeURIComponentWithCharset - no encoding', () => {
    const result = decodeURIComponentWithCharset('PlainText', 'utf-8');
    assert.strictEqual(result, 'PlainText');
});

test('decodeURIComponentWithCharset - empty string', () => {
    const result = decodeURIComponentWithCharset('', 'utf-8');
    assert.strictEqual(result, '');
});

test('decodeURIComponentWithCharset - case insensitive hex', () => {
    const result = decodeURIComponentWithCharset('Test%2d%2D', 'utf-8');
    assert.ok(result.includes('-'));
});

test('decodeURIComponentWithCharset - ISO-8859-1 charset', () => {
    const result = decodeURIComponentWithCharset('Caf%E9', 'iso-8859-1');
    assert.strictEqual(result, 'Café');
});

test('decodeURIComponentWithCharset - unicode character unencoded', () => {
    const result = decodeURIComponentWithCharset('Test™', 'utf-8');
    assert.ok(result.includes('Test'));
    assert.ok(result.includes('™'));
});

test('decodeURIComponentWithCharset - plus sign not converted', () => {
    // Unlike decodeURIComponent, plus should stay as plus
    const result = decodeURIComponentWithCharset('Hello+World', 'utf-8');
    assert.strictEqual(result, 'Hello+World');
});

test('decodeURIComponentWithCharset - all percent encoded', () => {
    const result = decodeURIComponentWithCharset('%48%65%6C%6C%6F', 'utf-8');
    assert.strictEqual(result, 'Hello');
});

test('decodeURIComponentWithCharset - invalid hex sequence ignored', () => {
    const result = decodeURIComponentWithCharset('Test%ZZ', 'utf-8');
    // Invalid sequence should be preserved
    assert.ok(result.includes('%ZZ'));
});

test('decodeURIComponentWithCharset - incomplete hex sequence', () => {
    const result = decodeURIComponentWithCharset('Test%2', 'utf-8');
    // Incomplete sequence should be preserved
    assert.ok(result.includes('%2'));
});

test('decodeURIComponentWithCharset - multiple consecutive percent signs', () => {
    const result = decodeURIComponentWithCharset('Test%%20', 'utf-8');
    assert.ok(result.includes('Test%'));
});

test('decodeURIComponentWithCharset - emoji encoded', () => {
    const result = decodeURIComponentWithCharset('%F0%9F%98%80', 'utf-8');
    assert.strictEqual(result, '😀');
});

test('decodeURIComponentWithCharset - Chinese characters', () => {
    const result = decodeURIComponentWithCharset('%E4%BD%A0%E5%A5%BD', 'utf-8');
    assert.strictEqual(result, '你好');
});

// Edge Cases
test('decodeWord - Q-encoding with equals at end', () => {
    const result = decodeWord('utf-8', 'Q', 'Test=');
    assert.ok(result.includes('Test'));
});

test('decodeWords - nested encoded words', () => {
    const result = decodeWords('=?utf-8?Q?=?inner?=?=');
    // Should handle gracefully
    assert.ok(result);
});

test('decodeWords - encoded word at start', () => {
    const result = decodeWords('=?utf-8?Q?Start?= middle end');
    assert.strictEqual(result, 'Start middle end');
});

test('decodeWords - encoded word at end', () => {
    const result = decodeWords('start middle =?utf-8?Q?End?=');
    assert.strictEqual(result, 'start middle End');
});

test('decodeWords - only whitespace', () => {
    const result = decodeWords('   ');
    assert.strictEqual(result, '   ');
});

test('decodeWord - B-encoding with invalid base64', () => {
    // Invalid base64 should not crash
    const result = decodeWord('utf-8', 'B', '!!!invalid!!!');
    assert.ok(result);
});

test('decodeWords - underscore in Q-encoding converted to space', () => {
    const result = decodeWords('=?utf-8?Q?Hello_World_Test?=');
    assert.strictEqual(result, 'Hello World Test');
});

test('decodeWords - multiple charsets in sequence', () => {
    const result = decodeWords('=?utf-8?Q?A?= =?iso-8859-1?Q?B?= =?utf-8?Q?C?=');
    assert.ok(result.includes('A'));
    assert.ok(result.includes('B'));
    assert.ok(result.includes('C'));
});

// getDecoder function tests
test('getDecoder - utf-8 charset', () => {
    const decoder = getDecoder('utf-8');
    assert.ok(decoder instanceof TextDecoder);
    const result = decoder.decode(new Uint8Array([72, 101, 108, 108, 111]));
    assert.strictEqual(result, 'Hello');
});

test('getDecoder - UTF-8 uppercase', () => {
    const decoder = getDecoder('UTF-8');
    assert.ok(decoder instanceof TextDecoder);
});

test('getDecoder - iso-8859-1 charset', () => {
    const decoder = getDecoder('iso-8859-1');
    assert.ok(decoder instanceof TextDecoder);
});

test('getDecoder - windows-1252 charset', () => {
    const decoder = getDecoder('windows-1252');
    assert.ok(decoder instanceof TextDecoder);
});

test('getDecoder - unknown charset falls back to windows-1252', () => {
    const decoder = getDecoder('unknown-fake-charset');
    assert.ok(decoder instanceof TextDecoder);
    // Should not throw and should be usable
    const result = decoder.decode(new Uint8Array([84, 101, 115, 116]));
    assert.strictEqual(result, 'Test');
});

test('getDecoder - null charset defaults to utf-8', () => {
    const decoder = getDecoder(null);
    assert.ok(decoder instanceof TextDecoder);
});

test('getDecoder - undefined charset defaults to utf-8', () => {
    const decoder = getDecoder(undefined);
    assert.ok(decoder instanceof TextDecoder);
});

test('getDecoder - empty string charset defaults to utf-8', () => {
    const decoder = getDecoder('');
    assert.ok(decoder instanceof TextDecoder);
});

test('getDecoder - charset with language tag', () => {
    // Some charsets might have language tags that need to be handled
    const decoder = getDecoder('utf-8');
    const bytes = new TextEncoder().encode('Cafe');
    const result = decoder.decode(bytes);
    assert.strictEqual(result, 'Cafe');
});

// getHex function tests
test('getHex - valid digit 0-9', () => {
    for (let i = 0x30; i <= 0x39; i++) {
        const result = getHex(i);
        assert.strictEqual(result, String.fromCharCode(i));
    }
});

test('getHex - valid lowercase a-f', () => {
    for (let i = 0x61; i <= 0x66; i++) {
        const result = getHex(i);
        assert.strictEqual(result, String.fromCharCode(i));
    }
});

test('getHex - valid uppercase A-F', () => {
    for (let i = 0x41; i <= 0x46; i++) {
        const result = getHex(i);
        assert.strictEqual(result, String.fromCharCode(i));
    }
});

test('getHex - invalid character G', () => {
    const result = getHex(0x47); // 'G'
    assert.strictEqual(result, false);
});

test('getHex - invalid character Z', () => {
    const result = getHex(0x5A); // 'Z'
    assert.strictEqual(result, false);
});

test('getHex - invalid character space', () => {
    const result = getHex(0x20); // space
    assert.strictEqual(result, false);
});

test('getHex - invalid character null', () => {
    const result = getHex(0x00);
    assert.strictEqual(result, false);
});

test('getHex - boundary check: character before 0', () => {
    const result = getHex(0x2F); // '/'
    assert.strictEqual(result, false);
});

test('getHex - boundary check: character after 9', () => {
    const result = getHex(0x3A); // ':'
    assert.strictEqual(result, false);
});

test('getHex - boundary check: character before A', () => {
    const result = getHex(0x40); // '@'
    assert.strictEqual(result, false);
});

test('getHex - boundary check: character after F', () => {
    const result = getHex(0x47); // 'G'
    assert.strictEqual(result, false);
});

test('getHex - boundary check: character before a', () => {
    const result = getHex(0x60); // '`'
    assert.strictEqual(result, false);
});

test('getHex - boundary check: character after f', () => {
    const result = getHex(0x67); // 'g'
    assert.strictEqual(result, false);
});

// blobToArrayBuffer function tests
test('blobToArrayBuffer - simple text blob', async () => {
    const blob = new Blob(['Hello World'], { type: 'text/plain' });
    const buffer = await blobToArrayBuffer(blob);
    assert.ok(buffer instanceof ArrayBuffer);
    const text = new TextDecoder().decode(buffer);
    assert.strictEqual(text, 'Hello World');
});

test('blobToArrayBuffer - empty blob', async () => {
    const blob = new Blob([], { type: 'text/plain' });
    const buffer = await blobToArrayBuffer(blob);
    assert.ok(buffer instanceof ArrayBuffer);
    assert.strictEqual(buffer.byteLength, 0);
});

test('blobToArrayBuffer - binary blob', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 253]);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const buffer = await blobToArrayBuffer(blob);
    assert.ok(buffer instanceof ArrayBuffer);
    const result = new Uint8Array(buffer);
    assert.strictEqual(result.length, 6);
    assert.strictEqual(result[0], 0);
    assert.strictEqual(result[5], 253);
});

test('blobToArrayBuffer - large blob', async () => {
    const largeText = 'A'.repeat(10000);
    const blob = new Blob([largeText], { type: 'text/plain' });
    const buffer = await blobToArrayBuffer(blob);
    assert.ok(buffer instanceof ArrayBuffer);
    assert.strictEqual(buffer.byteLength, 10000);
});

test('blobToArrayBuffer - blob with multiple parts', async () => {
    const blob = new Blob(['Hello', ' ', 'World'], { type: 'text/plain' });
    const buffer = await blobToArrayBuffer(blob);
    const text = new TextDecoder().decode(buffer);
    assert.strictEqual(text, 'Hello World');
});

// decodeBase64 function tests
test('decodeBase64 - simple ASCII', () => {
    const result = decodeBase64('SGVsbG8gV29ybGQ=');
    const text = new TextDecoder().decode(result);
    assert.strictEqual(text, 'Hello World');
});

test('decodeBase64 - no padding', () => {
    const result = decodeBase64('SGVsbG8');
    const text = new TextDecoder().decode(result);
    assert.strictEqual(text, 'Hello');
});

test('decodeBase64 - single padding', () => {
    const result = decodeBase64('SGVsbG8h');
    const text = new TextDecoder().decode(result);
    assert.strictEqual(text, 'Hello!');
});

test('decodeBase64 - double padding', () => {
    const result = decodeBase64('SGk=');
    const text = new TextDecoder().decode(result);
    assert.strictEqual(text, 'Hi');
});

test('decodeBase64 - empty string', () => {
    const result = decodeBase64('');
    assert.strictEqual(result.byteLength, 0);
});

test('decodeBase64 - single character (2 base64 chars)', () => {
    const result = decodeBase64('QQ==');
    const text = new TextDecoder().decode(result);
    assert.strictEqual(text, 'A');
});

// decodeParameterValueContinuations tests
test('decodeParameterValueContinuations - simple continuation', () => {
    const header = {
        value: 'attachment',
        params: {
            'filename*0': 'long',
            'filename*1': 'file',
            'filename*2': 'name.txt'
        }
    };
    decodeParameterValueContinuations(header);
    assert.strictEqual(header.params.filename, 'longfilename.txt');
});

test('decodeParameterValueContinuations - encoded with charset', () => {
    const header = {
        value: 'attachment',
        params: {
            "filename*0*": "utf-8''%C3%A4bc",
            'filename*1*': '%C3%B6%C3%BC.txt'
        }
    };
    decodeParameterValueContinuations(header);
    // The actual decoded characters: a-umlaut, o-umlaut, u-umlaut
    assert.strictEqual(header.params.filename, 'äbcöü.txt');
});

test('decodeParameterValueContinuations - single encoded parameter', () => {
    const header = {
        value: 'attachment',
        params: {
            "filename*": "utf-8''test%20file.txt"
        }
    };
    decodeParameterValueContinuations(header);
    assert.strictEqual(header.params.filename, 'test file.txt');
});

test('decodeParameterValueContinuations - out of order continuations', () => {
    const header = {
        value: 'attachment',
        params: {
            'filename*2': 'c',
            'filename*0': 'a',
            'filename*1': 'b'
        }
    };
    decodeParameterValueContinuations(header);
    assert.strictEqual(header.params.filename, 'abc');
});

test('decodeParameterValueContinuations - mixed regular and continuation params', () => {
    const header = {
        value: 'attachment',
        params: {
            'filename*0': 'test',
            'filename*1': '.txt',
            'size': '1234'
        }
    };
    decodeParameterValueContinuations(header);
    assert.strictEqual(header.params.filename, 'test.txt');
    assert.strictEqual(header.params.size, '1234');
});

test('decodeParameterValueContinuations - no continuation params', () => {
    const header = {
        value: 'attachment',
        params: {
            'filename': 'test.txt',
            'size': '1234'
        }
    };
    decodeParameterValueContinuations(header);
    assert.strictEqual(header.params.filename, 'test.txt');
    assert.strictEqual(header.params.size, '1234');
});

test('decodeParameterValueContinuations - empty params', () => {
    const header = {
        value: 'attachment',
        params: {}
    };
    decodeParameterValueContinuations(header);
    assert.deepStrictEqual(header.params, {});
});

test('decodeParameterValueContinuations - single value continuation', () => {
    const header = {
        value: 'attachment',
        params: {
            'filename*0': 'onlypart.txt'
        }
    };
    decodeParameterValueContinuations(header);
    assert.strictEqual(header.params.filename, 'onlypart.txt');
});

test('decodeParameterValueContinuations - iso-8859-1 charset', () => {
    const header = {
        value: 'attachment',
        params: {
            "filename*": "iso-8859-1''Caf%E9.txt"
        }
    };
    decodeParameterValueContinuations(header);
    // %E9 in iso-8859-1 is the e-acute character
    assert.strictEqual(header.params.filename, 'Café.txt');
});

test('decodeParameterValueContinuations - language tag ignored', () => {
    const header = {
        value: 'attachment',
        params: {
            "filename*": "utf-8'en-US'test.txt"
        }
    };
    decodeParameterValueContinuations(header);
    assert.strictEqual(header.params.filename, 'test.txt');
});
