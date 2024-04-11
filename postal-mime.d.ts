export type RawEmail = string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream;

export type Header = Record<string, string>;

export type Address = {
	address: string;
	name: string;
};

export type Attachment = {
	filename: string | null;
	mimeType: string;
	disposition: "attachment" | "inline" | null;
	related?: boolean;
	contentId?: string;
    method?: string;
	content: Uint8Array;
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

declare class PostalMime {
	static parse(email: RawEmail): Promise<Email>;
	parse(email: RawEmail): Promise<Email>;
}

export default PostalMime;
