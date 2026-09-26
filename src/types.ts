// The public types of the package. They are type aliases rather than interfaces on
// purpose: an alias has an implicit index signature, so a parsed message stays
// assignable to `Record<string, unknown>`, which is how consumers hand it to loggers and
// storage helpers, and every optional property is declared as `T | undefined` so that the
// types also work under exactOptionalPropertyTypes. test/package-test.ts checks both.

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

/**
 * Raw email input accepted by the parser. A Node.js `Buffer` is a `Uint8Array`, so it is
 * covered by `ArrayBufferView` together with every other typed array and `DataView`.
 */
export type RawEmail = string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array>;

export type Header = {
    /** Lowercase header name */
    key: string;
    /** Original header name preserving case */
    originalKey: string;
    /** Header value, unfolded per RFC 5322 but otherwise unprocessed */
    value: string;
};

export type HeaderLine = {
    /** Lowercase header name */
    key: string;
    /** Complete raw header line including key and value (with folded lines merged) */
    line: string;
};

/**
 * Lowercased value of a Content-Disposition header. RFC 2183 defines `attachment` and
 * `inline`, but the token a message carries is passed through as it is, so other values
 * such as `form-data` occur as well. The two known values are spelled out for completion
 */
export type AttachmentDisposition = 'attachment' | 'inline' | (string & {});

export type Attachment = {
    /** Decoded file name, or null if the part did not name one */
    filename: string | null;
    /** Lowercase MIME type of the part */
    mimeType: string;
    /** Value of the Content-Disposition header, or null if the part did not have one */
    disposition: AttachmentDisposition | null;
    /** Set when the part is referenced from the HTML by its Content-ID, eg. an inline image */
    related?: boolean | undefined;
    /** Decoded Content-Description header */
    description?: string | undefined;
    /** Content-ID header, angle brackets included */
    contentId?: string | undefined;
    /** Uppercased `method` parameter of a calendar part, eg. `REQUEST` */
    method?: string | undefined;
    /**
     * Set when a `message/rfc822` part hit `maxRfc822NestingDepth` and was emitted as an
     * attachment instead of being parsed. Its own parts are not reflected in `text`,
     * `html` or `attachments`.
     */
    rfc822DepthExceeded?: boolean | undefined;
    /** Attachment content, a string when `attachmentEncoding` is `base64` or `utf8` */
    content: ArrayBuffer | Uint8Array | string;
    /** Set to the encoding of `content` when it is a string */
    encoding?: 'base64' | 'utf8' | undefined;
};

export type Email = {
    /** Every header of the message, in document order, duplicates included */
    headers: Header[];
    /** Raw header lines in the same order as `headers` */
    headerLines: HeaderLine[];
    from?: Address | undefined;
    sender?: Address | undefined;
    replyTo?: Address[] | undefined;
    deliveredTo?: string | undefined;
    returnPath?: string | undefined;
    to?: Address[] | undefined;
    cc?: Address[] | undefined;
    bcc?: Address[] | undefined;
    subject?: string | undefined;
    messageId?: string | undefined;
    inReplyTo?: string | undefined;
    references?: string | undefined;
    /** Sending time as an ISO 8601 string, or the raw header value if it does not parse as a date */
    date?: string | undefined;
    html?: string | undefined;
    text?: string | undefined;
    attachments: Attachment[];
};

export type AttachmentEncoding = 'base64' | 'utf8' | 'arraybuffer';

export type PostalMimeOptions = {
    /** Treat `message/rfc822` parts without a Content-Disposition as attachments */
    rfc822Attachments?: boolean | undefined;
    /** Treat every `message/rfc822` part as an attachment */
    forceRfc822Attachments?: boolean | undefined;
    /** How attachment content is returned, `arraybuffer` by default */
    attachmentEncoding?: AttachmentEncoding | undefined;
    /** Maximum MIME part nesting depth, 256 by default. Exceeding it rejects the parse */
    maxNestingDepth?: number | undefined;
    /** Maximum total header size in bytes across every part, 2 MiB by default. Exceeding it rejects the parse */
    maxHeadersSize?: number | undefined;
    /**
     * Maximum depth of inline `message/rfc822` parsing, 10 by default. Deeper messages
     * become attachments flagged with `rfc822DepthExceeded`, and 0 disables inline parsing
     */
    maxRfc822NestingDepth?: number | undefined;
};
