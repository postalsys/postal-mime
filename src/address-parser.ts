import { decodeWords, isEncodedWordsOnly } from './decode-strings.js';
import type { Address, AddressParserOptions, Mailbox } from './types.js';

interface Token {
    type: 'operator' | 'text';
    value: string;
    /** the next character is not a separator, so the following token joins this one */
    noBreak?: boolean | undefined;
}

type AddressState = 'text' | 'address' | 'comment' | 'group';

/**
 * Any whitespace, the test for an angle-addr that needs recovering
 */
const HAS_WHITESPACE = /\s/;

/**
 * An addr-spec that carries its whitespace legally, inside a quoted local part. The
 * optional tail is the malformed shape: a real mailbox with wreckage trailing it.
 */
const QUOTED_LOCAL_ADDR = /^("(?:[^"\\]|\\[\s\S])*"@\S+)(?:\s+([\s\S]+))?$/;

/**
 * One run holding a single '@' and no whitespace, the shape an addr-spec has to have
 */
const ADDR_SPEC = /^[^@\s]+@[^@\s]+$/;

/**
 * The looser reading applied once the strict one finds nothing, which tolerates the
 * further '@' that a domain should not have but malformed headers carry anyway
 */
const LOOSE_ADDR_SPEC = /^[^@\s]+@\S+$/;

/**
 * An addr-spec sitting inside free text, together with the whitespace around it. Sticky
 * on purpose: it is only run at the offset looseAddressStart picks, see there.
 */
const LOOSE_TEXT_ADDR = /\s*\b[^@\s]+@[^\s]+\b\s*/y;

/**
 * Restores the quoting of a local part that was read out of a quoted string.
 *
 * RFC 5321 allows '@' inside a quoted local part, so handing '"user@evil.com"@good.com'
 * on as the bare 'user@evil.com@good.com' leaves it to the consumer which '@' splits the
 * domain off. Getting that wrong is a misrouting vector, so the quotes go back on. The
 * same holds for the other specials: a ',' or a ';' that loses its quotes reads as a
 * recipient separator once the consumer puts the address back into a header.
 *
 * @param address Address with an unquoted local part
 * @return Address with the local part as a quoted-string
 */
function quoteLocalPart(address: string): string {
    const lastAt = address.lastIndexOf('@');
    if (lastAt < 0) {
        // no domain to split off, nothing can be misrouted
        return address;
    }

    const user = address.substring(0, lastAt);
    if (/^[^\s"(),:;<>@[\\\]]+$/.test(user) || /^"(?:[^"\\]|\\[\s\S])*"$/.test(user)) {
        // a local part that carries no special reads the same with or without the quotes,
        // and one that is already a complete quoted-string needs nothing either
        return address;
    }

    return '"' + user.replace(/["\\]/g, '\\$&') + '"@' + address.substring(lastAt + 1);
}

/**
 * The characters JS `\s` matches, which the scan below has to agree with to land on the
 * same match LOOSE_TEXT_ADDR would.
 */
function isSpaceCode(code: number): boolean {
    return (
        code === 0x20 ||
        (code >= 0x09 && code <= 0x0d) ||
        code === 0xa0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200a) ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000 ||
        code === 0xfeff
    );
}

/**
 * The characters JS `\w` matches without the unicode flag, the set the `\b` in
 * LOOSE_TEXT_ADDR is read against. charCodeAt off either end of the string gives NaN,
 * which compares false throughout, so out of range reads as a non-word character.
 */
function isWordCode(code: number): boolean {
    return (
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x5f
    );
}

/**
 * Whether `\b` holds at an offset
 */
function isBoundary(text: string, at: number): boolean {
    return isWordCode(text.charCodeAt(at - 1)) !== isWordCode(text.charCodeAt(at));
}

/**
 * Offset of the first '@' in `text` between `from` and `to`, or -1 when the range holds none.
 * Bounded rather than indexOf, which would scan on to the end of the header once for every
 * whitespace delimited run and make the walk below quadratic.
 */
function indexOfAt(text: string, from: number, to: number): number {
    for (let i = from; i < to; i++) {
        if (text.charCodeAt(i) === 0x40) {
            return i;
        }
    }

    return -1;
}

/**
 * Finds the offset LOOSE_TEXT_ADDR matches at, or -1 when it does not match at all.
 *
 * Letting the pattern search for itself is quadratic: '[^@\s]+' is retried from every
 * offset and rescans the run to the next '@' each time, so a single header well inside
 * the default size limit could hold a core busy for minutes. The search is also
 * unnecessary. '[^@\s]+' crosses neither whitespace nor a '@', so a match can only begin
 * at the head of a whitespace delimited run or just past a '@' inside one, and '[^\s]+\b'
 * gives characters back until it lands on a boundary, so the only end it can take in that
 * run is the last boundary in it. Both are found in one pass, and the pattern is then run
 * at that single offset.
 *
 * @param text Free text to look in
 * @return Offset to match at, or -1
 */
function looseAddressStart(text: string): number {
    const len = text.length;
    let pos = 0;

    while (pos < len) {
        while (pos < len && isSpaceCode(text.charCodeAt(pos))) {
            pos++;
        }
        if (pos >= len) {
            break;
        }

        const runStart = pos;
        let runEnd = pos;
        while (runEnd < len && !isSpaceCode(text.charCodeAt(runEnd))) {
            runEnd++;
        }

        let at = indexOfAt(text, runStart, runEnd);
        if (at >= 0) {
            let lastBoundary = -1;
            for (let k = runEnd; k > runStart; k--) {
                if (isBoundary(text, k)) {
                    lastBoundary = k;
                    break;
                }
            }

            let atomStart = runStart;
            while (lastBoundary >= 0 && at >= 0) {
                // '[^@\s]+' has to cover a character before the '@' and '[^\s]+' one after it,
                // and the boundary that ends the match has to sit past both
                if (at > atomStart && runEnd > at + 1 && lastBoundary > at + 1) {
                    for (let start = atomStart; start < at; start++) {
                        if (isBoundary(text, start)) {
                            if (start > runStart) {
                                return start;
                            }
                            // the leading '\s*' is greedy, so a match that begins at the run
                            // takes the whitespace in front of it along
                            let padded = runStart;
                            while (padded > 0 && isSpaceCode(text.charCodeAt(padded - 1))) {
                                padded--;
                            }
                            return padded;
                        }
                    }
                }
                atomStart = at + 1;
                at = indexOfAt(text, atomStart, runEnd);
            }
        }

        pos = runEnd;
    }

    return -1;
}

/**
 * Recovers the addr-spec from an angle-addr that came back holding unquoted whitespace.
 *
 * A malformed header can put more than a mailbox between the angle brackets, most often
 * because the generator wrote the recipient twice: '<user@example.com user@example.com>'
 * or '<example.com user@example.com>'. Whitespace is not addr-spec, so the whole run can
 * never be a mailbox, and passing it on as the address loses the recipient that is
 * sitting right there in the header.
 *
 * The run that still reads as an addr-spec is kept and whatever is left over becomes
 * display text. Candidates are read strictly first and then under the looser grammar,
 * the same two tiers the unquoted text fallback applies, so that '<a@b@c.com junk>' and a
 * bare 'a@b@c.com junk' agree on the recipient.
 *
 * A quoted local part is left alone: RFC 5321 allows whitespace inside it, so
 * '<"user name"@example.com>' is well formed and means exactly what it says.
 *
 * @param address Collected address
 * @param text Collected display text
 * @return The address and the display text, with any leftovers moved to the text
 */
function recoverAddrSpec(address: string, text: string): { address: string; text: string } {
    if (!HAS_WHITESPACE.test(address)) {
        return { address, text };
    }

    let rest: string[];

    const quoted = address.match(QUOTED_LOCAL_ADDR);
    if (quoted) {
        if (!quoted[2]) {
            // the whitespace sits inside the quoted local part, this is a well formed mailbox
            return { address, text };
        }

        // a real mailbox with wreckage trailing it, so peel the addr-spec off whole rather
        // than splitting into the quotes
        address = quoted[1];
        rest = [quoted[2]];
    } else {
        if (address.indexOf('"') >= 0) {
            // Splitting on whitespace loses track of where a quoted string starts and ends,
            // and addresses are never taken out of quoted strings: the run picked out of
            // '<junk "user@evil.com b"@good.com>' would be an address from the domain the
            // quotes were hiding. Every well formed shape was handled above, so the original
            // is the honest answer
            return { address, text };
        }

        const parts = address.split(/\s+/);

        let addrIndex = parts.findIndex(part => ADDR_SPEC.test(part));
        if (addrIndex < 0) {
            addrIndex = parts.findIndex(part => LOOSE_ADDR_SPEC.test(part));
        }

        if (addrIndex < 0) {
            // nothing in there reads as an address, there is no better answer than the original
            return { address, text };
        }

        address = parts.splice(addrIndex, 1)[0];
        rest = parts;
    }

    return {
        address,
        text: [text, ...rest].filter(part => part).join(' ')
    };
}

/**
 * Takes the RFC 5322 comments out of the contents of an angle-addr.
 *
 * The tokenizer tracks a single open operator, so once '<' is open a '(' is plain text and
 * a comment inside the brackets reached the address verbatim: 'Name <user@example.com(x)evil.com>'
 * put 'user@example.com(x)evil.com' into the address, a value that is no mailbox and that a
 * consumer stripping the comment reads as 'user@example.comevil.com'. A comment is folding
 * whitespace, so it is read as a space that splits two atoms and as nothing next to an '@',
 * the same rule the token walk applies outside the brackets. Quoted strings and domain
 * literals are copied through untouched, a '(' in there is not a comment.
 *
 * @param address Contents of the angle brackets
 * @return The address with the comments removed, and the text of the comments
 */
function stripAddressComments(address: string): { address: string; comments: string[] } {
    const comments: string[] = [];
    let result = '';
    let comment = '';
    let depth = 0;
    let closer = '';
    // carried along rather than read back off the growing result, which would flatten it on
    // every comment (see lastChars in _handleAddress)
    let lastChar = '';

    for (let i = 0, len = address.length; i < len; i++) {
        const chr = address.charAt(i);

        if (depth) {
            if (chr === '\\' && i < len - 1) {
                comment += address.charAt(++i);
            } else if (chr === '(') {
                depth++;
                comment += chr;
            } else if (chr === ')' && !--depth) {
                comments.push(comment.trim());
                comment = '';
                if (lastChar !== '@' && address.charAt(i + 1) !== '@') {
                    result += ' ';
                    lastChar = ' ';
                }
            } else {
                comment += chr;
            }
            continue;
        }

        if (closer) {
            if (chr === '\\' && closer === '"' && i < len - 1) {
                result += chr + address.charAt(++i);
                lastChar = address.charAt(i);
                continue;
            }
            if (chr === closer) {
                closer = '';
            }
        } else if (chr === '"') {
            closer = '"';
        } else if (chr === '[') {
            closer = ']';
        } else if (chr === '(') {
            depth = 1;
            continue;
        }

        result += chr;
        lastChar = chr;
    }

    if (depth) {
        // an unterminated comment runs to the end of the address
        comments.push(comment.trim());
    }

    return { address: result.trim(), comments: comments.filter(text => text) };
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
    // Last character of the run each state is currently accumulating. Reading it back off
    // the accumulator with slice(-1) makes the engine flatten the whole growing string on
    // every token, which is quadratic over an address built from many comment-joined atoms.
    // A run only ever grows by the token appended below, so the character is carried along.
    const lastChars: Record<AddressState, string> = { address: '', comment: '', group: '', text: '' };

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
            // An empty quoted string is dropped by the tokenizer, leaving no text token of its
            // own to record the quoting on, so the pair of quote operators right in front of
            // this token is all that is left of it and the run it opens carries the quoting
            // instead. Without this '""@example.com' reads as the bare '@example.com'. It only
            // ever opens a run: a run already holding unquoted text is not a quoted string
            const prevPrevToken = i > 1 ? tokens[i - 2] : null;
            const opensAfterEmptyQuotedString =
                prevToken?.type === 'operator' &&
                prevToken.value === '"' &&
                !!prevToken.noBreak &&
                prevPrevToken?.type === 'operator' &&
                prevPrevToken.value === '"';

            if (state === 'address') {
                // handle use case where unquoted name includes a "<"
                // Apple Mail truncates everything between an unexpected < and an address
                // and so will we
                token.value = token.value.replace(/^[^<]*<\s*/, '');
            }

            // A comment is folding whitespace. It may sit inside an addr-spec, on either side
            // of the '@', but it cannot join two atoms into one: gluing across it would read
            // 'user@example.com(x)evil.com' as the single domain 'example.comevil.com' and
            // name a domain the sender never wrote.
            const joins =
                prevToken &&
                prevToken.noBreak &&
                data[state].length &&
                (prevToken.value !== ')' || lastChars[state] === '@' || token.value.charAt(0) === '@');

            if (joins) {
                // join values
                data[state][data[state].length - 1] += token.value;
                if (state === 'text' && insideQuotes) {
                    data.textWasQuoted[data.textWasQuoted.length - 1] = true;
                }
            } else {
                data[state].push(token.value);
                if (state === 'text') {
                    data.textWasQuoted.push(insideQuotes || opensAfterEmptyQuotedString);
                }
            }
            lastChars[state] = token.value.charAt(token.value.length - 1);
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
        // Comments come out of the angle-addr before anything asks whether one was found, so
        // that brackets holding nothing but a comment read the same as empty ones
        const addressComments: string[] = [];
        const addressParts: string[] = [];
        for (const part of data.address) {
            if (part.indexOf('(') < 0) {
                addressParts.push(part);
                continue;
            }
            const stripped = stripAddressComments(part);
            for (const comment of stripped.comments) {
                addressComments.push(comment);
            }
            if (stripped.address) {
                addressParts.push(stripped.address);
            }
        }
        data.address = addressParts;

        // If no address was found, try to detect one from regular text
        if (!data.address.length && data.text.length) {
            for (i = data.text.length - 1; i >= 0; i--) {
                // Security fix: Do not extract email addresses from quoted strings
                // RFC 5321 allows @ inside quoted local-parts like "user@domain"@example.com
                // Extracting emails from quoted text leads to misrouting vulnerabilities
                if (!data.textWasQuoted[i] && ADDR_SPEC.test(data.text[i])) {
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
                        const part = data.text[i];
                        const start = looseAddressStart(part);
                        if (start >= 0) {
                            LOOSE_TEXT_ADDR.lastIndex = start;
                            const match = LOOSE_TEXT_ADDR.exec(part);
                            if (match) {
                                data.address = [match[0].trim()];
                                // the match takes the whitespace around the address along, so
                                // the text on either side is joined with a single space
                                data.text[i] = (
                                    part.slice(0, start) +
                                    ' ' +
                                    part.slice(start + match[0].length)
                                ).trim();
                                break;
                            }
                        }
                        data.text[i] = part.trim();
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

        // An address is only taken from unquoted text, so anything left in the text at this
        // point that still has to serve as the address carries its quoting in this flag
        const addressFromQuotedText = !data.address.length && data.textWasQuoted.some(wasQuoted => wasQuoted);

        // Join values with spaces
        let text = data.text.join(' ');
        let addressValue = data.address.join(' ');

        // `^=\?[^=]+?=$` could not match a base64 word whose padding puts an '=' inside it,
        // so whether a bare encoded word was decoded or left to become the address itself
        // came down to whether its payload happened to need padding.
        if (!addressValue && isEncodedWordsOnly(text.trim())) {
            // try to extract words from text content
            const decodedText = decodeWords(text);
            // Security: only re-parse if decoded text contains angle-bracket addresses.
            // Without this, a bare encoded email (e.g. =?utf-8?B?dGVzdEBldmlsLmNv?=)
            // would be fabricated into an address from attacker-controlled input. A quoted
            // encoded word is never re-parsed, addresses are not taken out of quoted strings
            if (!addressFromQuotedText && hasAngleAddress(decodedText)) {
                const parsedSubAddresses = parseAddressList(decodedText, depth + 1);
                if (parsedSubAddresses.length) {
                    return parsedSubAddresses;
                }
            }
            // No usable address found - treat decoded text as display name only
            return [{ address: '', name: decodedText }];
        }

        if (addressFromQuotedText && text.indexOf('@') >= 0) {
            // The mailbox is still sitting in the text, so it moves over here and is quoted
            // before the recovery below rather than after it. Anything else the text holds
            // came along with it: a comment ends the domain but leaves the atoms behind it in
            // the same text, so '"user"@example.com(x)evil.com' would otherwise hand on
            // 'user@example.com evil.com', a second domain riding along in a value that is no
            // addr-spec at all. Putting the quotes back first is what lets the recovery tell
            // the whitespace a quoted local part may carry from the wreckage trailing one
            addressValue = quoteLocalPart(text);
            text = '';
        }

        ({ address: addressValue, text } = recoverAddrSpec(addressValue, text));

        // a comment names the mailbox only when nothing else does, as one outside the brackets
        if (!text && addressComments.length) {
            text = addressComments.join(' ');
        }

        const rawName = text || addressValue || '';
        const address: Mailbox = {
            address: addressValue || text || '',
            name: decodeWords(rawName)
        };

        // The raw comparison is the check Nodemailer makes, it holds when a single source
        // filled both fields. The decoded one is added because postal-mime decodes names,
        // which also catches a name that decodes to the address itself. Comparing only the
        // decoded name kept a name that mixes an encoded word with plain text as the address
        if (address.address === rawName || address.address === address.name) {
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
    inDomainLiteral: boolean;
    /** last non-whitespace character of the current text node, or '' */
    lastTextChar: string;
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
        this.inDomainLiteral = false;
        this.lastTextChar = '';

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
        // Track RFC 5322 domain-literals ("[" *dtext "]"). Operator characters such as the
        // ":" of an IPv6 address-literal (user@[IPv6:2001:db8::1]) are dtext and must not be
        // read as the group delimiter while inside the brackets. Quoted strings and comments
        // are handled via operatorExpecting, so this state is only entered when no operator
        // is open. The list separators "," and ";" always end the literal, so that an
        // unclosed "[" can not swallow later recipients. A domain-literal only ever follows
        // the '@' of an addr-spec, so a "[" anywhere else, eg. in a display name, stays plain
        // text. Otherwise it would hide the comment, quoted string or angle-addr after it and
        // let the header pick a different mailbox than the one RFC 5322 reads.
        if (!this.escaped && !this.operatorExpecting) {
            if (!this.inDomainLiteral && chr === '[' && this.lastTextChar === '@') {
                this.inDomainLiteral = true;
            } else if (this.inDomainLiteral && (chr === ']' || chr === ',' || chr === ';')) {
                this.inDomainLiteral = false;
            }
        }

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
            this.lastTextChar = '';
            this.operatorExpecting = '';
            this.escaped = false;

            return;
        } else if (!this.operatorExpecting && !this.inDomainLiteral && chr in this.operators) {
            this.node = {
                type: 'operator',
                value: chr
            };
            this.list.push(this.node);
            this.node = null;
            this.lastTextChar = '';
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
            if (chr !== ' ' && chr !== '\t') {
                this.lastTextChar = chr;
            }
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

    // Merge fragments produced when unquoted display names contain commas.
    // "Joe Foo, PhD <joe@example.com>" is split on the comma into
    // [{name:"Joe Foo", address:""}, {name:"PhD", address:"joe@example.com"}].
    // Recombine: a name-only entry followed by an entry with both name and address.
    // Walked back to front so that a run of fragments folds into one entry in a single
    // pass. Splicing each fragment out of the list instead would be quadratic.
    const mergedAddresses: Address[] = [];
    for (let i = parsedAddresses.length - 1; i >= 0; i--) {
        const current = parsedAddresses[i];
        const next = mergedAddresses.length ? mergedAddresses[mergedAddresses.length - 1] : null;
        if (next && current.address === '' && current.name && !current.group && next.address && next.name) {
            next.name = current.name + ', ' + next.name;
        } else {
            mergedAddresses.push(current);
        }
    }

    return mergedAddresses.reverse();
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
