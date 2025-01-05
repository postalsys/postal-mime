export type RawEmail = string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream;

export type Header = Record<string, string>;

export type Address = {
    name: string;
    address?: string;
    group?: Address[]
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
    from: Address;
    sender?: Address;
    replyTo?: Address[];
    deliveredTo?: string;
    returnPath?: string;
    to?: Address[];
    cc?: Address[];
    bcc?: Address[];
    subject?: string;
    messageId: string;
    inReplyTo?: string;
    references?: string;
    date?: string;
    html?: string;
    text?: string;
    attachments: Attachment[];
};

declare type AddressParserOptions = {
    flatten?: boolean
}

declare function addressParser (
    str: string,
    options?: AddressParserOptions
): Address[];

declare function decodeWords (
    str: string
): string;

declare type PostalMimeOptions = {
    rfc822Attachments?: boolean,
    forceRfc822Attachments?: boolean,
    attachmentEncoding?: "base64" | "utf8" | "arraybuffer"
}

declare class PostalMime {
    constructor(options?: PostalMimeOptions);
    static parse(
        email: RawEmail,
        options?: PostalMimeOptions
    ): Promise<Email>;
    parse(email: RawEmail): Promise<Email>;
}

export { addressParser, decodeWords };
export default PostalMime;
