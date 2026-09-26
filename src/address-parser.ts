import { decodeWords, isEncodedWordsOnly } from './decode-strings.js';

/**
 * A single email address with an optional display name
 */
export type Mailbox = {
    /** Decoded display name, or an empty string if not set */
    name: string;
    /** Email address */
    address: string;
    group?: undefined;
};

/**
 * An RFC 5322 address group, eg. `Team: a@example.com, b@example.com;`
 */
export type AddressGroup = {
    /** Decoded group name */
    name: string;
    address?: undefined;
    /** Members of the group */
    group: Mailbox[];
};

export type Address = Mailbox | AddressGroup;

export type AddressParserOptions = {
    /** If true, address groups are unwrapped and a flat list of mailboxes is returned */
    flatten?: boolean | undefined;
};

interface Token {
    type: 'operator' | 'text';
    value: string;
    /** the next character is not a separator, so the following token joins this one */
    noBreak?: boolean | undefined;
}

type AddressState = 'text' | 'address' | 'comment' | 'group';

interface AddressMatch {
    index: number;
    length: number;
    value: string;
}

const WORD_CHAR_REGEX = /\w/;
const NON_SPACE_TOKEN_REGEX = /[^\s]+/g;

/**
 * Finds the first address looking token in a run of text.
 *
 * This replaces a `\s*\b[^@\s]+@[^\s]+\b\s*` scan over the whole string, which backtracks
 * quadratically: the leading `\s*` makes every position inside a whitespace run a viable
 * start, and `[^@\s]+` then gives back one character at a time looking for an '@'. A
 * single header well inside the default size limit could hold a core busy for minutes.
 *
 * Scanning whitespace delimited tokens instead is linear and keeps the word boundary
 * semantics of the regex: the local part has to open on a word character and the domain
 * has to end on one.
 *
 * @param text Text to search
 * @return `{index, length, value}` of the address, or null if there is none
 */
function findAddressInText(text: string): AddressMatch | null {
    NON_SPACE_TOKEN_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = NON_SPACE_TOKEN_REGEX.exec(text))) {
        const token = match[0];
        const at = token.indexOf('@');

        // `\b[^@\s]+@` needs at least one character before the '@'
        let start = 0;
        while (start < at && !WORD_CHAR_REGEX.test(token.charAt(start))) {
            start++;
        }
        if (start >= at) {
            continue;
        }

        // `[^\s]+\b` needs at least one character after the '@', ending on a word character
        let end = token.length;
        while (end > at + 1 && !WORD_CHAR_REGEX.test(token.charAt(end - 1))) {
            end--;
        }
        if (end <= at + 1) {
            continue;
        }

        return { index: match.index + start, length: end - start, value: token.substring(start, end) };
    }

    return null;
}

/**
 * Checks whether text holds an angle bracket address, ie. `<` and `>` around a run
 * without other angle brackets that has an '@' with at least one character on each side.
 *
 * Same answer as `/<[^<>]+@[^<>]+>/.test(text)`, which backtracks quadratically on a `<`
 * followed by a long run of '@' and no closing `>`.
 *
 * @param text Text to check
 * @return true if an angle bracket address is present
 */
function hasAngleAddress(text: string): boolean {
    // position right after the `<` that opened the current bracket, or -1
    let start = -1;
    // first '@' inside the bracket that has a character before it, or -1
    let at = -1;

    for (let i = 0; i < text.length; i++) {
        const chr = text.charAt(i);
        if (chr === '<') {
            start = i + 1;
            at = -1;
        } else if (chr === '>') {
            if (at >= 0 && at < i - 1) {
                return true;
            }
            start = -1;
            at = -1;
        } else if (chr === '@' && start >= 0 && at < 0 && i > start) {
            at = i;
        }
    }

    return false;
}

/**
 * Converts tokens for a single address into an address object
 *
 * @param tokens Tokens object
 * @param depth Current recursion depth for nested group protection
 * @return Address objects
 */
function _handleAddress(tokens: Token[], depth: number): Address[] {
    let isGroup = false;
    let state: AddressState = 'text';
    let addresses: Address[] = [];
    let data: Record<AddressState, string[]> & { textWasQuoted: boolean[] } = {
        address: [],
        comment: [],
        group: [],
        text: [],
        textWasQuoted: [] // Track which text tokens came from inside quotes
    };
    let i: number;
    let len: number;
    let insideQuotes = false; // Track if we're currently inside a quoted string

    // Filter out <addresses>, (comments) and regular text
    for (i = 0, len = tokens.length; i < len; i++) {
        let token = tokens[i];
        let prevToken = i ? tokens[i - 1] : null;
        if (token.type === 'operator') {
            switch (token.value) {
                case '<':
                    state = 'address';
                    insideQuotes = false;
                    break;
                case '(':
                    state = 'comment';
                    insideQuotes = false;
                    break;
                case ':':
                    state = 'group';
                    isGroup = true;
                    insideQuotes = false;
                    break;
                case '"':
                    // Track quote state for text tokens
                    insideQuotes = !insideQuotes;
                    state = 'text';
                    break;
                default:
                    state = 'text';
                    insideQuotes = false;
                    break;
            }
        } else if (token.value) {
            if (state === 'address') {
                // handle use case where unquoted name includes a "<"
                // Apple Mail truncates everything between an unexpected < and an address
                // and so will we
                token.value = token.value.replace(/^[^<]*<\s*/, '');
            }

            if (prevToken && prevToken.noBreak && data[state].length) {
                // join values
                data[state][data[state].length - 1] += token.value;
                if (state === 'text' && insideQuotes) {
                    data.textWasQuoted[data.textWasQuoted.length - 1] = true;
                }
            } else {
                data[state].push(token.value);
                if (state === 'text') {
                    data.textWasQuoted.push(insideQuotes);
                }
            }
        }
    }

    // If there is no text but a comment, replace the two
    if (!data.text.length && data.comment.length) {
        data.text = data.comment;
        data.comment = [];
    }

    if (isGroup) {
        // http://tools.ietf.org/html/rfc2822#appendix-A.1.3
        const text = data.text.join(' ');

        // Parse group members, but flatten any nested groups (RFC 5322 doesn't allow nesting)
        let groupMembers: Mailbox[] = [];
        if (data.group.length) {
            let parsedGroup = parseAddressList(data.group.join(','), depth + 1);
            // Flatten: if any member is itself a group, extract its members into the sequence
            parsedGroup.forEach(member => {
                if (member.group) {
                    // Nested group detected - flatten it by adding its members directly
                    for (const nestedMember of member.group) {
                        groupMembers.push(nestedMember);
                    }
                } else {
                    groupMembers.push(member);
                }
            });
        }

        addresses.push({
            name: decodeWords(text),
            group: groupMembers
        });
    } else {
        // If no address was found, try to detect one from regular text
        if (!data.address.length && data.text.length) {
            for (i = data.text.length - 1; i >= 0; i--) {
                // Security fix: Do not extract email addresses from quoted strings
                // RFC 5321 allows @ inside quoted local-parts like "user@domain"@example.com
                // Extracting emails from quoted text leads to misrouting vulnerabilities
                if (!data.textWasQuoted[i] && data.text[i].match(/^[^@\s]+@[^@\s]+$/)) {
                    data.address = data.text.splice(i, 1);
                    data.textWasQuoted.splice(i, 1);
                    break;
                }
            }

            // still no address
            if (!data.address.length) {
                for (i = data.text.length - 1; i >= 0; i--) {
                    // Security fix: Do not extract email addresses from quoted strings
                    if (!data.textWasQuoted[i]) {
                        // handles an email address that has more than one @
                        const found = findAddressInText(data.text[i]);
                        if (found) {
                            data.address = [found.value];
                            // the address and the whitespace around it collapse to one space.
                            // trimEnd rather than `/\s+$/`, which retries at every position of
                            // a whitespace run that is not at the end and is quadratic in it.
                            data.text[i] = (
                                data.text[i].substring(0, found.index).trimEnd() +
                                ' ' +
                                data.text[i].substring(found.index + found.length).trimStart()
                            ).trim();
                            break;
                        }
                        data.text[i] = data.text[i].trim();
                    }
                }
            }
        }

        // If there's still no text but a comment exists, replace the two
        if (!data.text.length && data.comment.length) {
            data.text = data.comment;
            data.comment = [];
        }

        // Keep only the first address occurrence, push others to regular text
        if (data.address.length > 1) {
            data.text = data.text.concat(data.address.splice(1));
        }

        // Join values with spaces
        const text = data.text.join(' ');
        const addressValue = data.address.join(' ');

        // `^=\?[^=]+?=$` could not match a base64 word whose padding puts an '=' inside it,
        // so whether a bare encoded word was decoded or left to become the address itself
        // came down to whether its payload happened to need padding.
        if (!addressValue && isEncodedWordsOnly(text.trim())) {
            // try to extract words from text content
            const decodedText = decodeWords(text);
            // Security: only re-parse if decoded text contains angle-bracket addresses.
            // Without this, a bare encoded email (e.g. =?utf-8?B?dGVzdEBldmlsLmNv?=)
            // would be fabricated into an address from attacker-controlled input.
            if (hasAngleAddress(decodedText)) {
                const parsedSubAddresses = addressParser(decodedText);
                if (parsedSubAddresses && parsedSubAddresses.length) {
                    return parsedSubAddresses;
                }
            }
            // No usable address found - treat decoded text as display name only
            return [{ address: '', name: decodedText }];
        }

        const address: Mailbox = {
            address: addressValue || text || '',
            name: decodeWords(text || addressValue || '')
        };

        if (address.address === address.name) {
            if (address.address.match(/@/)) {
                address.name = '';
            } else {
                address.address = '';
            }
        }

        addresses.push(address);
    }

    return addresses;
}

/**
 * Tokenizer for address field strings
 */
class Tokenizer {
    str: string;
    operatorCurrent: string;
    operatorExpecting: string;
    node: Token | null;
    escaped: boolean;
    list: Token[];
    /**
     * Operator tokens and which tokens are expected to end the sequence
     */
    operators: Record<string, string>;

    /**
     * @param str Address field string
     */
    constructor(str: string) {
        this.str = (str || '').toString();
        this.operatorCurrent = '';
        this.operatorExpecting = '';
        this.node = null;
        this.escaped = false;

        this.list = [];

        this.operators = {
            '"': '"',
            '(': ')',
            '<': '>',
            ',': '',
            ':': ';',
            // Semicolons are not a legal delimiter per the RFC2822 grammar other
            // than for terminating a group, but they are also not valid for any
            // other use in this context.  Given that some mail clients have
            // historically allowed the semicolon as a delimiter equivalent to the
            // comma in their UI, it makes sense to treat them the same as a comma
            // when used outside of a group.
            ';': ''
        };
    }

    /**
     * Tokenizes the original input string
     *
     * @return An array of operator|text tokens
     */
    tokenize(): Token[] {
        let list: Token[] = [];

        for (let i = 0, len = this.str.length; i < len; i++) {
            let chr = this.str.charAt(i);
            let nextChr = i < len - 1 ? this.str.charAt(i + 1) : null;
            this.checkChar(chr, nextChr);
        }

        this.list.forEach(node => {
            node.value = (node.value || '').toString().trim();
            if (node.value) {
                list.push(node);
            }
        });

        return list;
    }

    /**
     * Checks if a character is an operator or text and acts accordingly
     *
     * @param chr Character from the address field
     * @param nextChr The character that follows, or null at the end of the field
     */
    checkChar(chr: string, nextChr: string | null): void {
        if (this.escaped) {
            // ignore next condition blocks
        } else if (chr === this.operatorExpecting) {
            this.node = {
                type: 'operator',
                value: chr
            };

            if (nextChr && ![' ', '\t', '\r', '\n', ',', ';'].includes(nextChr)) {
                this.node.noBreak = true;
            }

            this.list.push(this.node);
            this.node = null;
            this.operatorExpecting = '';
            this.escaped = false;

            return;
        } else if (!this.operatorExpecting && chr in this.operators) {
            this.node = {
                type: 'operator',
                value: chr
            };
            this.list.push(this.node);
            this.node = null;
            this.operatorExpecting = this.operators[chr];
            this.escaped = false;
            return;
        } else if (this.operatorExpecting === '"' && chr === '\\') {
            this.escaped = true;
            return;
        }

        if (!this.node) {
            this.node = {
                type: 'text',
                value: ''
            };
            this.list.push(this.node);
        }

        if (chr === '\n') {
            // Convert newlines to spaces. Carriage return is ignored as \r and \n usually
            // go together anyway and there already is a WS for \n. Lone \r means something is fishy.
            chr = ' ';
        }

        if (chr.charCodeAt(0) >= 0x21 || [' ', '\t'].includes(chr)) {
            // skip command bytes
            this.node.value += chr;
        }

        this.escaped = false;
    }
}

/**
 * Maximum recursion depth for parsing nested groups.
 * RFC 5322 doesn't allow nested groups, so this is a safeguard against
 * malicious input that could cause stack overflow.
 */
const MAX_NESTED_GROUP_DEPTH = 50;

/**
 * Parses an address list, recursing into groups. The depth is threaded through the
 * calls rather than taken from an option, so a caller supplied options object can not
 * seed it and lift the recursion limit.
 *
 * @param str Address field
 * @param depth Current recursion depth for nested group protection
 * @return An array of address objects
 */
function parseAddressList(str: string, depth: number): Address[] {
    // Prevent stack overflow from deeply nested groups (DoS protection)
    if (depth > MAX_NESTED_GROUP_DEPTH) {
        return [];
    }

    let tokenizer = new Tokenizer(str);
    let tokens = tokenizer.tokenize();

    let addresses: Token[][] = [];
    let address: Token[] = [];
    const parsedAddresses: Address[] = [];

    tokens.forEach(token => {
        if (token.type === 'operator' && (token.value === ',' || token.value === ';')) {
            if (address.length) {
                addresses.push(address);
            }
            address = [];
        } else {
            address.push(token);
        }
    });

    if (address.length) {
        addresses.push(address);
    }

    // Appended in place. Rebuilding the list with concat() for every address copies
    // everything parsed so far and is quadratic in the number of addresses.
    for (const tokens of addresses) {
        for (const address of _handleAddress(tokens, depth)) {
            parsedAddresses.push(address);
        }
    }

    return parsedAddresses;
}

/**
 * Parses structured e-mail addresses from an address field
 *
 * Example:
 *
 *    'Name <address@domain>'
 *
 * will be converted to
 *
 *     [{name: 'Name', address: 'address@domain'}]
 *
 * @param str Address field
 * @param options Optional options object
 * @return An array of address objects
 */
function addressParser(str: string, options?: AddressParserOptions): Address[] {
    const parsedAddresses = parseAddressList(str, 0);

    if (options && options.flatten) {
        let addresses: Mailbox[] = [];
        let walkAddressList = (list: Address[]): void => {
            list.forEach(address => {
                if (address.group) {
                    return walkAddressList(address.group);
                } else {
                    addresses.push(address);
                }
            });
        };
        walkAddressList(parsedAddresses);
        return addresses;
    }

    return parsedAddresses;
}

// expose to the world
export default addressParser;
