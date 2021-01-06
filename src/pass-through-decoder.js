export default class PassThroughDecoder {
    constructor() {
        this.chunks = [];
    }

    update(line) {
        this.chunks.push(line);
        this.chunks.push('\n');
    }

    finalize() {
        // convert an array of arraybuffers into a blob and then back into a single arraybuffer
        let blob = new Blob(this.chunks, { type: 'application/octet-stream' });
        const fr = new FileReader();

        return new Promise((resolve, reject) => {
            fr.onload = function (e) {
                resolve(e.target.result);
            };

            fr.onerror = function (e) {
                reject(fr.error);
            };

            fr.readAsArrayBuffer(blob);
        });
    }
}
