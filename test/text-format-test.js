import test from 'node:test';
import assert from 'node:assert';
import {
    decodeHTMLEntities,
    escapeHtml,
    textToHtml,
    htmlToText,
    formatTextHeader,
    formatHtmlHeader
} from '../src/text-format.js';

// HTML Entity Decoding Tests
test('decodeHTMLEntities - named entities', () => {
    assert.strictEqual(decodeHTMLEntities('&amp;&lt;&gt;&quot;'), '&<>"');
    assert.strictEqual(decodeHTMLEntities('&nbsp;&copy;&reg;'), '\u00A0\u00A9\u00AE');
});

test('decodeHTMLEntities - numeric entities (decimal)', () => {
    assert.strictEqual(decodeHTMLEntities('&#65;&#66;&#67;'), 'ABC');
    assert.strictEqual(decodeHTMLEntities('&#169;&#8364;'), '©€');
});

test('decodeHTMLEntities - numeric entities (hex)', () => {
    assert.strictEqual(decodeHTMLEntities('&#x41;&#x42;&#x43;'), 'ABC');
    assert.strictEqual(decodeHTMLEntities('&#xA9;&#x20AC;'), '©€');
    assert.strictEqual(decodeHTMLEntities('&#xff;'), 'ÿ'); // lowercase x
});

test('decodeHTMLEntities - mixed entities', () => {
    assert.strictEqual(decodeHTMLEntities('&lt;div&#62;Test&#x20;&amp;&nbsp;More'), '<div>Test &\u00A0More');
});

test('decodeHTMLEntities - surrogate pairs', () => {
    // Test high codepoint that requires surrogate pair
    const result = decodeHTMLEntities('&#x1F600;'); // 😀 emoji
    assert.strictEqual(result, '😀');
});

test('decodeHTMLEntities - invalid surrogate range', () => {
    // Codepoints in surrogate range should return replacement character
    assert.strictEqual(decodeHTMLEntities('&#xD800;'), '\uFFFD');
    assert.strictEqual(decodeHTMLEntities('&#xDFFF;'), '\uFFFD');
});

test('decodeHTMLEntities - out of range codepoint', () => {
    assert.strictEqual(decodeHTMLEntities('&#x110000;'), '\uFFFD');
});

test('decodeHTMLEntities - entities without semicolon', () => {
    // Named entities without semicolon may decode if matched in entity map
    const result = decodeHTMLEntities('&amp test');
    assert.ok(result.includes('test'));
    // With semicolon should decode
    assert.strictEqual(decodeHTMLEntities('&amp; test'), '& test');
});

test('decodeHTMLEntities - numeric entities without semicolon', () => {
    // Numeric entities without semicolon should be preserved
    assert.strictEqual(decodeHTMLEntities('&#65 test'), '&#65 test');
});

test('decodeHTMLEntities - unknown entities', () => {
    assert.strictEqual(decodeHTMLEntities('&unknownentity;'), '&unknownentity;');
});

test('decodeHTMLEntities - empty string', () => {
    assert.strictEqual(decodeHTMLEntities(''), '');
});

test('decodeHTMLEntities - no entities', () => {
    assert.strictEqual(decodeHTMLEntities('Hello World'), 'Hello World');
});

test('decodeHTMLEntities - case sensitivity', () => {
    assert.strictEqual(decodeHTMLEntities('&#x41;&#x61;'), 'Aa');
});

// HTML Escaping Tests
test('escapeHtml - basic special characters', () => {
    assert.strictEqual(escapeHtml('<div>'), '&#x3C;div&#x3E;');
    assert.strictEqual(escapeHtml('"quotes"'), '&#x22;quotes&#x22;');
    assert.strictEqual(escapeHtml("'single'"), '&#x27;single&#x27;');
});

test('escapeHtml - ampersand', () => {
    assert.strictEqual(escapeHtml('A & B'), 'A &#x26; B');
});

test('escapeHtml - question mark', () => {
    assert.strictEqual(escapeHtml('What?'), 'What&#x3F;');
});

test('escapeHtml - mixed characters', () => {
    const result = escapeHtml('<a href="test">Link</a>');
    assert.ok(result.includes('&#x3C;'));
    assert.ok(result.includes('&#x3E;'));
    assert.ok(result.includes('&#x22;'));
    assert.ok(result.includes('Link'));
});

test('escapeHtml - trims whitespace', () => {
    assert.strictEqual(escapeHtml('  test  '), 'test');
});

test('escapeHtml - empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
});

// Text to HTML Conversion Tests
test('textToHtml - simple text', () => {
    assert.strictEqual(textToHtml('Hello World'), '<div>Hello World</div>');
});

test('textToHtml - newlines converted to br', () => {
    const result = textToHtml('Line 1\nLine 2\nLine 3');
    assert.ok(result.includes('<br />'));
    assert.ok(result.includes('Line 1'));
    assert.ok(result.includes('Line 2'));
});

test('textToHtml - special characters escaped', () => {
    const result = textToHtml('<script>alert("XSS")</script>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('&#x3C;'));
});

// HTML to Text Conversion Tests
test('htmlToText - simple HTML', () => {
    assert.strictEqual(htmlToText('<p>Hello World</p>').trim(), 'Hello World');
});

test('htmlToText - br tags to newlines', () => {
    const result = htmlToText('Line 1<br>Line 2<br/>Line 3');
    assert.ok(result.includes('Line 1\n'));
    assert.ok(result.includes('Line 2\n'));
});

test('htmlToText - block elements create newlines', () => {
    const result = htmlToText('<p>Para 1</p><p>Para 2</p><div>Div 1</div>');
    assert.ok(result.includes('Para 1\n'));
    assert.ok(result.includes('Para 2\n'));
});

test('htmlToText - strips inline tags', () => {
    const result = htmlToText('<span>Text</span> with <em>emphasis</em> and <strong>bold</strong>');
    assert.ok(result.includes('Text'));
    assert.ok(result.includes('emphasis'));
    assert.ok(!result.includes('<span>'));
});

test('htmlToText - links show URL', () => {
    const result = htmlToText('<a href="http://example.com">Link</a>');
    assert.ok(result.includes('http://example.com'));
});

test('htmlToText - removes comments', () => {
    const result = htmlToText('Before<!-- comment -->After');
    assert.ok(!result.includes('comment'));
    assert.ok(result.includes('Before'));
    assert.ok(result.includes('After'));
});

test('htmlToText - removes script tags', () => {
    const result = htmlToText('Text<script>alert("test")</script>More');
    assert.ok(!result.includes('alert'));
    assert.ok(result.includes('Text'));
    assert.ok(result.includes('More'));
});

test('htmlToText - list items with bullets', () => {
    const result = htmlToText('<ul><li>Item 1</li><li>Item 2</li></ul>');
    assert.ok(result.includes('* Item 1'));
    assert.ok(result.includes('* Item 2'));
});

test('htmlToText - hr becomes horizontal line', () => {
    const result = htmlToText('Before<hr>After');
    assert.ok(result.includes('-------------'));
});

test('htmlToText - removes head content', () => {
    const result = htmlToText('<html><head><title>Title</title></head><body>Body</body></html>');
    assert.ok(!result.includes('Title'));
    assert.ok(result.includes('Body'));
});

test('htmlToText - normalizes whitespace', () => {
    const result = htmlToText('Text   with    multiple     spaces');
    assert.ok(!result.includes('   '));
    assert.ok(result.includes('Text with multiple spaces'));
});

test('htmlToText - removes excessive newlines', () => {
    const result = htmlToText('<p>Para 1</p>\n\n\n\n<p>Para 2</p>');
    const lines = result.split('\n\n\n');
    assert.ok(lines.length < 3); // Should not have triple newlines
});

test('htmlToText - decodes HTML entities', () => {
    const result = htmlToText('&lt;div&gt;&amp;&nbsp;&copy;');
    assert.ok(result.includes('<div>'));
    assert.ok(result.includes('&'));
    assert.ok(result.includes('©'));
});

test('htmlToText - empty HTML', () => {
    assert.strictEqual(htmlToText('').trim(), '');
});

test('htmlToText - tags across lines', () => {
    const result = htmlToText('<p>\nMultiline\ntag\n</p>');
    assert.ok(result.includes('Multiline'));
});

test('htmlToText - table elements', () => {
    const result = htmlToText('<table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>');
    assert.ok(result.includes('Cell 1'));
    assert.ok(result.includes('Cell 2'));
});

// Message Header Formatting Tests
test('formatTextHeader - basic message', () => {
    const message = {
        from: { name: 'John Doe', address: 'john@example.com' },
        subject: 'Test Subject',
        date: '2024-01-15T10:30:00.000Z'
    };

    const result = formatTextHeader(message);
    assert.ok(result.includes('From:'));
    assert.ok(result.includes('John Doe'));
    assert.ok(result.includes('john@example.com'));
    assert.ok(result.includes('Subject:'));
    assert.ok(result.includes('Test Subject'));
    assert.ok(result.includes('Date:'));
    assert.ok(result.includes('---')); // Separator line
});

test('formatTextHeader - with recipients', () => {
    const message = {
        from: { name: 'Sender', address: 'sender@example.com' },
        to: [
            { name: 'Recipient 1', address: 'r1@example.com' },
            { name: '', address: 'r2@example.com' }
        ],
        cc: [{ name: '', address: 'cc@example.com' }]
    };

    const result = formatTextHeader(message);
    assert.ok(result.includes('To:'));
    assert.ok(result.includes('Recipient 1'));
    assert.ok(result.includes('r1@example.com'));
    assert.ok(result.includes('r2@example.com'));
    assert.ok(result.includes('Cc:'));
    assert.ok(result.includes('cc@example.com'));
});

test('formatTextHeader - with groups', () => {
    const message = {
        from: { name: 'Sender', address: 'sender@example.com' },
        to: [
            {
                name: 'Team',
                group: [
                    { name: 'Member 1', address: 'm1@example.com' },
                    { name: 'Member 2', address: 'm2@example.com' }
                ]
            }
        ]
    };

    const result = formatTextHeader(message);
    assert.ok(result.includes('Team:'));
    assert.ok(result.includes('Member 1'));
    assert.ok(result.includes('Member 2'));
    assert.ok(result.includes(';'));
});

test('formatTextHeader - long subject line folding', () => {
    const message = {
        from: { name: 'Sender', address: 'sender@example.com' },
        subject:
            'This is a very long subject line that should be folded to fit within reasonable line length limits for email display'
    };

    const result = formatTextHeader(message);
    assert.ok(result.includes('Subject:'));
    assert.ok(result.includes('This is a very long'));
});

test('formatTextHeader - with BCC', () => {
    const message = {
        from: { name: 'Sender', address: 'sender@example.com' },
        bcc: [{ name: '', address: 'bcc@example.com' }]
    };

    const result = formatTextHeader(message);
    assert.ok(result.includes('Bcc:'));
    assert.ok(result.includes('bcc@example.com'));
});

test('formatHtmlHeader - basic message', () => {
    const message = {
        from: { name: 'John Doe', address: 'john@example.com' },
        subject: 'Test Subject',
        date: '2024-01-15T10:30:00.000Z'
    };

    const result = formatHtmlHeader(message);
    assert.ok(result.includes('postal-email-header'));
    assert.ok(result.includes('John Doe'));
    assert.ok(result.includes('mailto:john@example.com'));
    assert.ok(result.includes('Test Subject'));
});

test('formatHtmlHeader - with recipients', () => {
    const message = {
        from: { name: 'Sender', address: 'sender@example.com' },
        to: [{ name: 'Recipient', address: 'r1@example.com' }],
        cc: [{ name: '', address: 'cc@example.com' }]
    };

    const result = formatHtmlHeader(message);
    assert.ok(result.includes('postal-email-address'));
    assert.ok(result.includes('Recipient'));
    assert.ok(result.includes('r1@example.com'));
    assert.ok(result.includes('cc@example.com'));
});

test('formatHtmlHeader - HTML escaping in addresses', () => {
    const message = {
        from: { name: '<Script>Alert</Script>', address: 'test@example.com' },
        subject: '<b>Bold Subject</b>'
    };

    const result = formatHtmlHeader(message);
    assert.ok(!result.includes('<Script>'));
    assert.ok(!result.includes('<b>Bold'));
    assert.ok(result.includes('&#x3C;'));
});

test('formatHtmlHeader - with groups', () => {
    const message = {
        to: [
            {
                name: 'Team',
                group: [{ name: 'Member', address: 'm@example.com' }]
            }
        ]
    };

    const result = formatHtmlHeader(message);
    assert.ok(result.includes('postal-email-address-group'));
    assert.ok(result.includes('Team'));
    assert.ok(result.includes('Member'));
});

test('formatHtmlHeader - date with data attribute', () => {
    const message = {
        from: { name: 'Sender', address: 's@example.com' },
        date: '2024-01-15T10:30:00.000Z'
    };

    const result = formatHtmlHeader(message);
    assert.ok(result.includes('postal-email-header-date'));
    assert.ok(result.includes('data-date'));
    assert.ok(result.includes('2024-01-15T10:30:00.000Z'));
});

test('formatHtmlHeader - empty message', () => {
    const message = {};
    const result = formatHtmlHeader(message);
    assert.ok(result.includes('postal-email-header'));
});

test('formatHtmlHeader - separator between addresses', () => {
    const message = {
        to: [
            { name: 'A', address: 'a@example.com' },
            { name: 'B', address: 'b@example.com' }
        ]
    };

    const result = formatHtmlHeader(message);
    assert.ok(result.includes('postal-email-address-separator'));
    assert.ok(result.includes(', '));
});
