import htmlEntities from './html-entities.js';

export function decodeHTMLEntities(str) {
    return str.replace(/&(#\d+|#x[a-f0-9]+|[a-z]+\d*);?/gi, (match, entity) => {
        if (typeof htmlEntities[match] === 'string') {
            return htmlEntities[match];
        }

        if (entity.charAt(0) !== '#' || match.charAt(match.length - 1) !== ';') {
            // keep as is, invalid or unknown sequence
            return match;
        }

        let codePoint;
        if (entity.charAt(1) === 'x') {
            // hex
            codePoint = parseInt(entity.substr(2), 16);
        } else {
            // dec
            codePoint = parseInt(entity.substr(1), 10);
        }

        let output = '';

        if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
            // Invalid range, return a replacement character instead
            return '\uFFFD';
        }

        if (codePoint > 0xffff) {
            codePoint -= 0x10000;
            output += String.fromCharCode(((codePoint >>> 10) & 0x3ff) | 0xd800);
            codePoint = 0xdc00 | (codePoint & 0x3ff);
        }

        output += String.fromCharCode(codePoint);

        return output;
    });
}

export function escapeHtml(str) {
    return str.trim().replace(/[<>"'?&]/g, c => {
        let hex = c.charCodeAt(0).toString(16);
        if (hex.length < 2) {
            hex = '0' + hex;
        }
        return '&#x' + hex.toUpperCase() + ';';
    });
}

export function textToHtml(str) {
    let html = escapeHtml(str).replace(/\n/g, '<br />');
    return '<div>' + html + '</div>';
}

// htmlToText strips tags with regexes like `<br\b[^>]*>` and `<!--.*?-->`. Handed to
// String#replace as they are, the engine tries every candidate in turn and a candidate
// that does not close scans on to the next `>`, the end of the line or the end of the
// input before giving up, so an html part holding many unclosed `<`, `<a ` or `<!--`
// took seconds to minutes to convert. The helpers below give the same results in linear
// time.

// Characters that `.` does not match, so a `.*` can not run across them
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/g;

function lastLineTerminator(str) {
    return Math.max(str.lastIndexOf('\n'), str.lastIndexOf('\r'), str.lastIndexOf('\u2028'), str.lastIndexOf('\u2029'));
}

/**
 * Returns a function that finds the next match of a global regex at or after a position.
 *
 * Callers only ever ask about positions that move forward, so a match stays the answer
 * until a position passes it, and no match stays the answer for good. That way every part
 * of the string is scanned once, however many times it is asked about.
 *
 * @param {String} str String to search
 * @param {RegExp} regex Global regex to look for
 * @return {Function} `pos => match` of the next match, or null if there is none
 */
function createFinder(str, regex) {
    let searchedFrom = Infinity;
    let found = null;

    return pos => {
        if (pos < searchedFrom || (found && pos > found.index)) {
            regex.lastIndex = pos;
            found = regex.exec(str);
            searchedFrom = pos;
        }
        return found;
    };
}

/**
 * `str.replace(pattern, replacement)` for a pattern shaped like `<tag\b[^>]*>`.
 *
 * Such a pattern only fails at a candidate that has no `>` after it, so the text after
 * the last `>` can never match and is where every rescan happened. Leaving it out keeps
 * the native replace, and its speed, for everything else.
 *
 * @param {String} str String to process
 * @param {RegExp} pattern Global regex that ends on the first `>` after its start
 * @param {String} replacement Replacement text
 * @return {String} Processed string
 */
function replaceClosedTags(str, pattern, replacement) {
    const end = str.lastIndexOf('>') + 1;
    return str.slice(0, end).replace(pattern, replacement) + str.slice(end);
}

/**
 * `str.replace(pattern, replacement)` for a tag pattern that may fail even when a `>`
 * follows, like `<a\b[^>]*href...>`, or that runs on past its `>`.
 *
 * A candidate with no `>` after it ends the search, since no later candidate can close
 * either. A candidate that does not match skips every other candidate before the same
 * `>`, since those see the same tag body and fail the same way.
 *
 * @param {String} str String to process
 * @param {RegExp} prefix Global regex for the start of a candidate, which can not contain `>`
 * @param {RegExp} pattern The whole pattern as a sticky regex
 * @param {Function} replacement Function given the match and its groups
 * @return {String} Processed string
 */
function replaceTags(str, prefix, pattern, replacement) {
    const parts = [];
    // everything before this index is already in parts
    let copied = 0;
    let searchFrom = 0;

    while (true) {
        prefix.lastIndex = searchFrom;
        const candidate = prefix.exec(str);
        if (!candidate) {
            break;
        }

        const start = candidate.index;
        pattern.lastIndex = start;
        const match = pattern.exec(str);
        if (!match) {
            const gt = str.indexOf('>', start);
            if (gt < 0) {
                break;
            }
            searchFrom = gt + 1;
            continue;
        }

        parts.push(str.slice(copied, start), replacement(...match));
        copied = searchFrom = start + match[0].length;
    }

    parts.push(str.slice(copied));
    return parts.join('');
}

/**
 * `str.replace(pattern, replacement)` for a pattern like `<!--.*?-->` or
 * `<script\b[^>]*>.*?<\/script\b[^>]*>`, ie. an opener and a closer, either of which may
 * continue with `[^>]*>`, and a lazy `.*?` between them. The engine rescans to the end of
 * the line for every opener that is not closed.
 *
 * @param {String} str String to process
 * @param {RegExp} open Global regex for the opener
 * @param {Boolean} openToGt Whether the opener continues with `[^>]*>`
 * @param {RegExp} close Global regex for the closer
 * @param {Boolean} closeToGt Whether the closer continues with `[^>]*>`
 * @param {String} replacement Replacement text
 * @return {String} Processed string
 */
function replaceBlocks(str, open, openToGt, close, closeToGt, replacement) {
    const nextGt = createFinder(str, />/g);
    const nextClose = createFinder(str, close);
    const nextLineEnd = createFinder(str, LINE_TERMINATOR);
    const parts = [];
    let copied = 0;
    let searchFrom = 0;

    while (true) {
        open.lastIndex = searchFrom;
        const opener = open.exec(str);
        if (!opener) {
            break;
        }

        const start = opener.index;
        searchFrom = start + 1;

        // where the lazy `.*?` starts
        let from = start + opener[0].length;
        if (openToGt) {
            const gt = nextGt(from);
            if (!gt) {
                // neither this opener nor any later one can close
                break;
            }
            from = gt.index + 1;
        }

        const closer = nextClose(from);
        if (!closer) {
            // no closer follows this opener, so none follows a later one either
            break;
        }

        // `.*?` can not reach the closer across a line terminator
        const lineEnd = nextLineEnd(from);
        if (lineEnd && lineEnd.index < closer.index) {
            continue;
        }

        let end = closer.index + closer[0].length;
        if (closeToGt) {
            const gt = nextGt(end);
            if (!gt) {
                // this is the first closer after the opener, and any other one comes
                // later, so none of them is followed by `>`
                break;
            }
            end = gt.index + 1;
        }

        parts.push(str.slice(copied, start), replacement);
        copied = searchFrom = end;
    }

    parts.push(str.slice(copied));
    return parts.join('');
}

/**
 * `str.replace(pattern, '')` for `^.*<tag\b[^>]*>`, ie. drops everything up to and
 * including the last such tag on the first line.
 *
 * @param {String} str String to process
 * @param {RegExp} prefix Global regex for the start of the tag, which can not contain `>`
 * @return {String} Processed string
 */
function stripThroughLastTag(str, prefix) {
    const lineEnd = str.search(LINE_TERMINATOR);
    // `.*` stops at the first line terminator, and `[^>]*>` needs a `>` after the tag
    const limit = Math.min(lineEnd < 0 ? str.length : lineEnd, str.lastIndexOf('>'));

    let last = -1;
    prefix.lastIndex = 0;
    let match;
    while ((match = prefix.exec(str)) && match.index < limit) {
        last = match.index;
    }

    return last < 0 ? str : str.slice(str.indexOf('>', last) + 1);
}

/**
 * `str.replace(pattern, '')` for `<tag\b[^>]*>.*$`, ie. drops the first such tag whose
 * `>` is on the last line, and everything after it.
 *
 * @param {String} str String to process
 * @param {RegExp} prefix Global regex for the start of the tag, which can not contain `>`
 * @return {String} Processed string
 */
function stripFromFirstTag(str, prefix) {
    // `.*$` has to reach the end of the string without crossing a line terminator, so the
    // tag has to start after the last `>` that comes before the last line terminator
    const lineEnd = lastLineTerminator(str);
    prefix.lastIndex = lineEnd < 0 ? 0 : str.lastIndexOf('>', lineEnd) + 1;

    const match = prefix.exec(str);
    return match && match.index < str.lastIndexOf('>') ? str.slice(0, match.index) : str;
}

export function htmlToText(str) {
    // we can't process tags on multiple lines so remove newlines first
    str = str.replace(/\r?\n/g, '\u0001');

    str = replaceBlocks(str, /<!--/g, false, /-->/g, false, ' ');

    str = replaceClosedTags(str, /<br\b[^>]*>/gi, '\n');
    str = replaceClosedTags(str, /<\/?(p|div|table|tr|td|th)\b[^>]*>/gi, '\n\n');
    str = replaceBlocks(str, /<script\b/gi, true, /<\/script\b/gi, true, ' ');
    str = stripThroughLastTag(str, /<body\b/gi);
    str = stripThroughLastTag(str, /<\/head\b/gi);
    str = stripThroughLastTag(str, /<!doctype\b/gi);
    str = stripFromFirstTag(str, /<\/body\b/gi);
    str = stripFromFirstTag(str, /<\/html\b/gi);

    str = replaceTags(str, /<a\b/gi, /<a\b[^>]*href\s*=\s*["']?([^\s"']+)[^>]*>/iy, (match, href) => ` (${href}) `);

    str = replaceClosedTags(str, /<\/?(span|em|i|strong|b|u|a)\b[^>]*>/gi, '');

    // the whitespace after the tag may run on past the last `>`
    str = replaceTags(str, /<li\b/gi, /<li\b[^>]*>[\n\u0001\s]*/iy, () => '* ');

    str = replaceClosedTags(str, /<hr\b[^>]*>/g, '\n-------------\n');

    str = replaceClosedTags(str, /<[^>]*>/g, ' ');

    str = str
        // convert linebreak placeholders back to newlines
        .replace(/\u0001/g, '\n')

        .replace(/[ \t]+/g, ' ')

        .replace(/^\s+$/gm, '')

        .replace(/\n\n+/g, '\n\n')
        .replace(/^\n+/, '\n')
        .replace(/\n+$/, '\n');

    str = decodeHTMLEntities(str);

    return str;
}

// A message date is not always a date. PostalMime keeps the raw header value when it does
// not parse, and Intl.DateTimeFormat throws a RangeError on that, which used to reject the
// whole parse of any message carrying a forwarded copy with a broken Date header.
function formatDate(date) {
    if (typeof Intl === 'undefined') {
        return date;
    }

    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
        return date;
    }

    return new Intl.DateTimeFormat('default', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    }).format(parsed);
}

function formatTextAddress(address) {
    return []
        .concat(address.name || [])
        .concat(address.name ? `<${address.address}>` : address.address)
        .join(' ');
}

function formatTextAddresses(addresses) {
    let parts = [];

    let processAddress = (address, partCounter) => {
        if (partCounter) {
            parts.push(', ');
        }

        if (address.group) {
            let groupStart = `${address.name}:`;
            let groupEnd = `;`;

            parts.push(groupStart);
            address.group.forEach(processAddress);
            parts.push(groupEnd);
        } else {
            parts.push(formatTextAddress(address));
        }
    };

    addresses.forEach(processAddress);

    return parts.join('');
}

function formatHtmlAddress(address) {
    return `<a href="mailto:${escapeHtml(address.address)}" class="postal-email-address">${escapeHtml(address.name || `<${address.address}>`)}</a>`;
}

function formatHtmlAddresses(addresses) {
    let parts = [];

    let processAddress = (address, partCounter) => {
        if (partCounter) {
            parts.push('<span class="postal-email-address-separator">, </span>');
        }

        if (address.group) {
            let groupStart = `<span class="postal-email-address-group">${escapeHtml(address.name)}:</span>`;
            let groupEnd = `<span class="postal-email-address-group">;</span>`;

            parts.push(groupStart);
            address.group.forEach(processAddress);
            parts.push(groupEnd);
        } else {
            parts.push(formatHtmlAddress(address));
        }
    };

    addresses.forEach(processAddress);

    return parts.join(' ');
}

function foldLines(str, lineLength, afterSpace) {
    str = (str || '').toString();
    lineLength = lineLength || 76;

    let pos = 0,
        len = str.length,
        result = '',
        line,
        match;

    while (pos < len) {
        line = str.substr(pos, lineLength);
        if (line.length < lineLength) {
            result += line;
            break;
        }
        if ((match = line.match(/^[^\n\r]*(\r?\n|\r)/))) {
            line = match[0];
            result += line;
            pos += line.length;
            continue;
        } else if (
            (match = line.match(/(\s+)[^\s]*$/)) &&
            match[0].length - (afterSpace ? (match[1] || '').length : 0) < line.length
        ) {
            line = line.substr(0, line.length - (match[0].length - (afterSpace ? (match[1] || '').length : 0)));
        } else if ((match = str.substr(pos + line.length).match(/^[^\s]+(\s*)/))) {
            line = line + match[0].substr(0, match[0].length - (!afterSpace ? (match[1] || '').length : 0));
        }

        result += line;
        pos += line.length;
        if (pos < len) {
            result += '\r\n';
        }
    }

    return result;
}

export function formatTextHeader(message) {
    let rows = [];

    if (message.from) {
        // through the plural formatter, because `From:` may hold RFC 5322 group syntax
        // and a group has no address of its own
        rows.push({ key: 'From', val: formatTextAddresses([message.from]) });
    }

    if (message.subject) {
        rows.push({ key: 'Subject', val: message.subject });
    }

    if (message.date) {
        rows.push({ key: 'Date', val: formatDate(message.date) });
    }

    if (message.to && message.to.length) {
        rows.push({ key: 'To', val: formatTextAddresses(message.to) });
    }

    if (message.cc && message.cc.length) {
        rows.push({ key: 'Cc', val: formatTextAddresses(message.cc) });
    }

    if (message.bcc && message.bcc.length) {
        rows.push({ key: 'Bcc', val: formatTextAddresses(message.bcc) });
    }

    // Align keys and values by adding space between these two
    // Also make sure that the separator line is as long as the longest line
    // Should end up with something like this:
    /*
    -----------------------------
    From:    xx xx <xxx@xxx.com>
    Subject: Example Subject
    Date:    16/02/2021, 02:57:06
    To:      not@found.com
    -----------------------------
    */

    let maxKeyLength = rows
        .map(r => r.key.length)
        .reduce((acc, cur) => {
            return cur > acc ? cur : acc;
        }, 0);

    rows = rows.flatMap(row => {
        let sepLen = maxKeyLength - row.key.length;
        let prefix = `${row.key}: ${' '.repeat(sepLen)}`;
        let emptyPrefix = `${' '.repeat(row.key.length + 1)} ${' '.repeat(sepLen)}`;

        let foldedLines = foldLines(row.val, 80, true)
            .split(/\r?\n/)
            .map(line => line.trim());

        return foldedLines.map((line, i) => `${i ? emptyPrefix : prefix}${line}`);
    });

    let maxLineLength = rows
        .map(r => r.length)
        .reduce((acc, cur) => {
            return cur > acc ? cur : acc;
        }, 0);

    let lineMarker = '-'.repeat(maxLineLength);

    let template = `
${lineMarker}
${rows.join('\n')}
${lineMarker}
`;

    return template;
}

export function formatHtmlHeader(message) {
    let rows = [];

    if (message.from) {
        rows.push(
            // through the plural formatter, because `From:` may hold RFC 5322 group syntax
            // and a group has no address of its own
            `<div class="postal-email-header-key">From</div><div class="postal-email-header-value">${formatHtmlAddresses([message.from])}</div>`
        );
    }

    if (message.subject) {
        rows.push(
            `<div class="postal-email-header-key">Subject</div><div class="postal-email-header-value postal-email-header-subject">${escapeHtml(
                message.subject
            )}</div>`
        );
    }

    if (message.date) {
        rows.push(
            `<div class="postal-email-header-key">Date</div><div class="postal-email-header-value postal-email-header-date" data-date="${escapeHtml(
                message.date
            )}">${escapeHtml(formatDate(message.date))}</div>`
        );
    }

    if (message.to && message.to.length) {
        rows.push(
            `<div class="postal-email-header-key">To</div><div class="postal-email-header-value">${formatHtmlAddresses(message.to)}</div>`
        );
    }

    if (message.cc && message.cc.length) {
        rows.push(
            `<div class="postal-email-header-key">Cc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.cc)}</div>`
        );
    }

    if (message.bcc && message.bcc.length) {
        rows.push(
            `<div class="postal-email-header-key">Bcc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.bcc)}</div>`
        );
    }

    let template = `<div class="postal-email-header">${rows.length ? '<div class="postal-email-header-row">' : ''}${rows.join(
        '</div>\n<div class="postal-email-header-row">'
    )}${rows.length ? '</div>' : ''}</div>`;

    return template;
}
