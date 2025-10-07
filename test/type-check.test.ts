/**
 * TypeScript type checking tests
 * This file verifies that type definitions are correct and usable
 * It's compiled by TypeScript but not executed as runtime tests
 */

import { Buffer } from 'node:buffer';
import type {
    RawEmail,
    Email,
    Address,
    Mailbox,
    Header,
    Attachment,
    PostalMimeOptions,
    AddressParserOptions
} from '../postal-mime';

// Type guard for Address
function isMailbox(addr: Address): addr is Mailbox {
    return addr.group === undefined;
}

// Test: All types are properly exported and usable
function testTypeExports() {
    const raw1: RawEmail = 'string';
    const raw2: RawEmail = Buffer.from('test');
    const raw3: RawEmail = new Uint8Array();
    const raw4: RawEmail = new ArrayBuffer(0);

    const header: Header = { key: 'subject', value: 'Test' };
    const mailbox: Mailbox = { name: 'John', address: 'john@example.com' };
    const group: Address = { name: 'Team', group: [mailbox] };

    const attachment: Attachment = {
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        disposition: 'attachment',
        content: new ArrayBuffer(0)
    };

    const email: Email = {
        headers: [header],
        attachments: [attachment],
        from: mailbox,
        to: [mailbox, group]
    };

    const options: PostalMimeOptions = {
        attachmentEncoding: 'base64',
        maxNestingDepth: 100
    };

    const addrOptions: AddressParserOptions = {
        flatten: true
    };
}

// Test: Type narrowing works correctly
function testTypeNarrowing(email: Email) {
    // Optional fields
    if (email.subject !== undefined) {
        const subject: string = email.subject;
    }

    // Address type narrowing
    if (email.from) {
        if (isMailbox(email.from)) {
            const addr: string = email.from.address;
        } else {
            const members: Mailbox[] = email.from.group;
        }
    }

    // Array handling
    if (email.to) {
        email.to.forEach((addr) => {
            if (isMailbox(addr)) {
                console.log(addr.address);
            } else {
                addr.group.forEach((m) => console.log(m.address));
            }
        });
    }

    // Attachment encoding
    email.attachments.forEach((att) => {
        if (att.encoding === 'base64' || att.encoding === 'utf8') {
            const str: string = att.content as string;
        }
    });
}

// Test: Required vs optional fields
function testRequiredFields(email: Email) {
    // Required fields - no error
    const headers: Header[] = email.headers;
    const attachments: Attachment[] = email.attachments;

    // Optional fields - can be undefined
    const from: Address | undefined = email.from;
    const subject: string | undefined = email.subject;
}

// Export to make this a module
export {};
