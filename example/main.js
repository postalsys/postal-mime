/* globals SharedWorker, document, postalMime */

const PostalMime = postalMime.default;

document.getElementById('btn').addEventListener('click', () => {
    // convert text into an ArrayBuffer and transfer to worker

    const blob = new Blob([document.getElementById('txt').value], { type: 'application/octet-stream' });
    const fr = new FileReader();

    fr.onload = function (e) {
        const ab = e.target.result;

        const parser = new PostalMime();
        parser
            .parse(ab)
            .then(result => {
                console.log(result);
            })
            .catch(err => console.error(err));
    };

    fr.readAsArrayBuffer(blob);
});
