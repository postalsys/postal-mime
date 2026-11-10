import { isWsp } from './decode-strings.js';
import type MimeNode from './mime-node.js';

interface Boundary {
    value: string;
    node: MimeNode;
    // push order, so that the outermost of two candidates is the one with the lower number
    order: number;
}

export interface BoundaryMatch {
    node: MimeNode;
    isTerminator: boolean;
}

// The line is decoded only to look it up. A boundary is ASCII (see MimeNode), and UTF-8
// decodes ASCII bytes as themselves and any other byte to a non-ASCII character, so a line
// that is not byte for byte a boundary never decodes to one. ignoreBOM keeps a leading
// EF BB BF from being dropped, which would let `--<BOM>abc` read as `--abc`
const keyDecoder = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * The boundaries of the open multipart parts, indexed by value.
 *
 * A line is looked up instead of being compared against every open boundary in turn. With a
 * scan, a line sharing a long prefix with every boundary of a deeply nested message cost
 * the nesting depth times that prefix to reject, so a message of n such lines cost depth
 * times its size. A lookup costs the length of the line, whatever the depth.
 */
export default class BoundaryStack {
    private byValue = new Map<string, Boundary[]>();
    private byNode = new Map<MimeNode, Boundary>();
    // how many open boundaries have each byte length, so that a line of a length no boundary
    // can match is turned away before it is decoded. A boundary is ASCII, so its string
    // length is its byte length
    private lengths = new Map<number, number>();
    private nextOrder = 0;

    get size(): number {
        return this.byNode.size;
    }

    /** Registers the boundary of a multipart node, which must be ASCII and not end in whitespace */
    push(value: string, node: MimeNode): void {
        const boundary = { value, node, order: this.nextOrder++ };
        const list = this.byValue.get(value);
        if (list) {
            list.push(boundary);
        } else {
            this.byValue.set(value, [boundary]);
        }
        this.byNode.set(node, boundary);
        this.lengths.set(value.length, (this.lengths.get(value.length) || 0) + 1);
    }

    /** Removes the boundary of a node, if it registered one */
    remove(node: MimeNode): void {
        const boundary = this.byNode.get(node);
        if (!boundary) {
            return;
        }
        this.byNode.delete(node);

        const list = this.byValue.get(boundary.value)!;
        if (list.length === 1) {
            this.byValue.delete(boundary.value);
        } else {
            list.splice(list.indexOf(boundary), 1);
        }

        const count = this.lengths.get(boundary.value.length)! - 1;
        if (count) {
            this.lengths.set(boundary.value.length, count);
        } else {
            this.lengths.delete(boundary.value.length);
        }
    }

    /**
     * Finds the boundary a line delimits or terminates: `--` and the boundary, optionally
     * `--`, then optional whitespace (RFC 2046 5.1.1). When the line matches more than one
     * open boundary, the outermost wins: a boundary may not appear inside the parts it
     * delimits, and when a nested multipart declares the boundary of an ancestor anyway, or
     * one that the ancestor's terminator matches, the ancestor's delimiter is the one every
     * other parser reads the line as. Reading it as the nested one instead gave the nested
     * multipart parts, and an attachment after the ancestor's terminator, that Python and
     * Go leave in the epilogue.
     */
    match(line: Uint8Array): BoundaryMatch | null {
        if (!this.byNode.size || line.length <= 2 || line[0] !== 0x2d || line[1] !== 0x2d) {
            return null;
        }

        // A boundary does not end in whitespace, so the trailing whitespace is never part of it
        let end = line.length;
        while (end > 2 && isWsp(line[end - 1])) {
            end--;
        }

        const delimiter = this.find(line, end);
        const terminator =
            end - 2 >= 2 && line[end - 1] === 0x2d && line[end - 2] === 0x2d ? this.find(line, end - 2) : null;

        if (terminator && (!delimiter || terminator.order < delimiter.order)) {
            return { node: terminator.node, isTerminator: true };
        }
        return delimiter ? { node: delimiter.node, isTerminator: false } : null;
    }

    // the outermost open boundary equal to line[2..end]
    private find(line: Uint8Array, end: number): Boundary | null {
        if (!this.lengths.has(end - 2)) {
            return null;
        }
        const list = this.byValue.get(keyDecoder.decode(line.subarray(2, end)));
        return list ? list[0] : null;
    }
}
