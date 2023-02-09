declare namespace postalMime {
    type RawEmail = string | ArrayBuffer | Blob | Buffer;

    type Header = Record<string, string>;

    type Address = {
        address: string;
        name: string;
    };

    type Attachment = {
        filename: string;
        mimeType: string;
        disposition: 'attachment' | 'inline' | null;
        related?: boolean;
        contentId?: string;
        content: string;
    };

    type Email = {
        headers: Header[];
        from: Address;
        sender?: Address;
        replyTo?: Address[];
        deliveredTo?: string;
        returnPath?: string;
        to: Address[];
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
}

declare class PostalMime {
    parse(email: postalMime.RawEmail): Promise<postalMime.Email>;
}

export default PostalMime;
