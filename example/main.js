const myWorker = new SharedWorker('../src/postalmime.js');

document.getElementById('btn').addEventListener('click', () => {
    // convert text into an ArrayBuffer and transfer to worker

    const blob = new Blob([document.getElementById('txt').value], { type: 'application/octet-stream' });
    const fr = new FileReader();

    fr.onload = function (e) {
        const ab = e.target.result;
        myWorker.port.postMessage({ content: ab }, [ab]);
    };

    fr.readAsArrayBuffer(blob);
});

myWorker.port.onmessage = function (e) {
    console.log(e.data);
    console.log('Message received from worker');
};
