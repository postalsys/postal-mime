export type RawEmail = string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream;

export type Header = {
    /** Lowercase header name */
    key: string;
    /** Header value */
    value: string;
};

export type HeaderLine = {
    /** Lowercase header name */
    key: string;
    /** Complete raw header line including key and value (with folded lines merged) */
    line: string;
};

export type Mailbox = {
    name: string;
    address: string;
    group?: undefined;
};

export type Address =
    | Mailbox
    | {
          name: string;
          address?: undefined;
          group: Mailbox[];
      };

export type Attachment = {
    filename: string | null;
    mimeType: string;
    disposition: "attachment" | "inline" | null;
    related?: boolean;
    description?: string;
    contentId?: string;
    method?: string;
    content: ArrayBuffer | string;
    encoding?: "base64" | "utf8";
};

export type Email = {
    headers: Header[];
    headerLines: HeaderLine[];
    from?: Address;
    sender?: Address;
    replyTo?: Address[];
    deliveredTo?: string;
    returnPath?: string;
    to?: Address[];
    cc?: Address[];
    bcc?: Address[];
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    date?: string;
    html?: string;
    text?: string;
    attachments: Attachment[];
};

export type AddressParserOptions = {
    flatten?: boolean
}

export function addressParser (
    str: string,
    options?: AddressParserOptions
): Address[];

export function decodeWords (
    str: string
): string;

export type PostalMimeOptions = {
    rfc822Attachments?: boolean,
    forceRfc822Attachments?: boolean,
    attachmentEncoding?: "base64" | "utf8" | "arraybuffer",
    maxNestingDepth?: number,
    maxHeadersSize?: number
}

export default class PostalMime {
    constructor(options?: PostalMimeOptions);
    static parse(
        email: RawEmail,
        options?: PostalMimeOptions
    ): Promise<Email>;
    parse(email: RawEmail): Promise<Email>;
}
