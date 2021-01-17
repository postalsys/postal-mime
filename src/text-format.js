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

        var output = '';

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

export function htmlToText(str) {
    str = str
        // we can't process tags on multiple lines so remove newlines first
        .replace(/\r?\n/g, '\u0001')
        .replace(/<\!\-\-.*?\-\->/gi, ' ')

        .replace(/<br\b[^>]*>/gi, '\n')
        .replace(/<\/?(p|div|table|tr|td|th)\b[^>]*>/gi, '\n\n')
        .replace(/<script\b[^>]*>.*?<\/script\b[^>]*>/gi, ' ')
        .replace(/^.*<body\b[^>]*>/i, '')
        .replace(/^.*<\/head\b[^>]*>/i, '')
        .replace(/^.*<\!doctype\b[^>]*>/i, '')
        .replace(/<\/body\b[^>]*>.*$/i, '')
        .replace(/<\/html\b[^>]*>.*$/i, '')

        .replace(/<a\b[^>]*href\s*=\s*["']?([^\s"']+)[^>]*>/gi, ' ($1) ')

        .replace(/<\/?(span|em|i|strong|b|u|a)\b[^>]*>/gi, '')

        .replace(/<li\b[^>]*>[\n\u0001\s]*/gi, '* ')

        .replace(/<hr\b[^>]*>/g, '\n-------------\n')

        .replace(/<[^>]*>/g, ' ')

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

function formatTextAddress(address) {
    return [address.name || []].concat(address.name ? `<${address.address}>` : address.address).join(' ');
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

    return parts.join(' ');
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

export function formatTextHeader(message) {
    let rows = [];

    if (message.from) {
        rows.push(`From: ${formatTextAddress(message.from)}`);
    }

    if (message.subject) {
        rows.push(`Subject: ${escapeHtml(message.subject)}`);
    }

    if (message.date) {
        let dateOptions = {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false
        };

        let dateStr = typeof Intl === 'undefined' ? message.date : new Intl.DateTimeFormat('default', dateOptions).format(new Date(message.date));

        rows.push(`Date: ${dateStr}`);
    }

    if (message.to && message.to.length) {
        rows.push(`To: ${formatTextAddresses(message.to)}`);
    }

    if (message.cc && message.cc.length) {
        rows.push(`Cc: ${formatTextAddresses(message.cc)}`);
    }

    if (message.bcc && message.bcc.length) {
        rows.push(`Bcc: ${formatTextAddresses(message.bcc)}`);
    }

    let template = `
------------------------------
${rows.join('\n')}
------------------------------
`;

    return template;
}

export function formatHtmlHeader(message) {
    let rows = [];

    if (message.from) {
        rows.push(`<th>From</th><td>${formatHtmlAddress(message.from)}</td>`);
    }

    if (message.subject) {
        rows.push(`<th>Subject</th><td>${escapeHtml(message.subject)}</td>`);
    }

    if (message.date) {
        let dateOptions = {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false
        };

        let dateStr = typeof Intl === 'undefined' ? message.date : new Intl.DateTimeFormat('default', dateOptions).format(new Date(message.date));

        rows.push(`<th>Date</th><td>${escapeHtml(dateStr)}</td>`);
    }

    if (message.to && message.to.length) {
        rows.push(`<th>To</th><td>${formatHtmlAddresses(message.to)}</td>`);
    }

    if (message.cc && message.cc.length) {
        rows.push(`<th>Cc</th><td>${formatHtmlAddresses(message.cc)}</td>`);
    }

    if (message.bcc && message.bcc.length) {
        rows.push(`<th>Bcc</th><td>${formatHtmlAddresses(message.bcc)}</td>`);
    }

    let template = `<table>${rows.length ? '<tr>' : ''}${rows.join('</tr><tr>')}${rows.length ? '</tr>' : ''}</table>`;

    return template;
}
