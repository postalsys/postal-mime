/* globals iFrameResize */

import PostalMime from '../src/postal-mime.js';

function browseFileContents() {
    let iElm = document.createElement('input');
    iElm.setAttribute('type', 'file');
    iElm.style.width = '1px';
    iElm.style.height = '1px';
    iElm.style.position = 'absolute';
    iElm.style.left = '-1000px';
    iElm.style.top = '-1000px';
    document.body.appendChild(iElm);

    return new Promise((resolve, reject) => {
        iElm.addEventListener('change', () => {
            const reader = new FileReader();

            reader.addEventListener('load', event => {
                const fileContents = event.target.result;
                document.body.removeChild(iElm);
                resolve(fileContents);
            });

            reader.addEventListener('error', err => {
                console.error(err);
                document.body.removeChild(iElm);
                reject(new Error('Failed loading file'));
            });

            reader.addEventListener('abort', () => {
                document.body.removeChild(iElm);
                reject(new Error('Failed loading file'));
            });

            if (!iElm.files || !iElm.files[0]) {
                document.body.removeChild(iElm);
                return resolve(null);
            }

            reader.readAsArrayBuffer(iElm.files[0]);
        });

        iElm.click();
    });
}

function formatAddress(address) {
    const a = document.createElement('a');
    a.classList.add('email-address');
    a.textContent = address.name || `<${address.address}>`;
    a.href = `mailto:${address.address}`;
    return a;
}

function formatAddresses(addresses) {
    let parts = [];

    let processAddress = (address, partCounter) => {
        if (partCounter) {
            let sep = document.createElement('span');
            sep.classList.add('email-address-separator');
            sep.textContent = ', ';
            parts.push(sep);
        }

        if (address.group) {
            let groupStart = document.createElement('span');
            groupStart.classList.add('email-address-group');
            let groupEnd = document.createElement('span');
            groupEnd.classList.add('email-address-group');

            groupStart.textContent = `${address.name}:`;
            groupEnd.textContent = `;`;

            parts.push(groupStart);
            address.group.forEach(processAddress);
            parts.push(groupEnd);
        } else {
            parts.push(formatAddress(address));
        }
    };

    addresses.forEach(processAddress);

    const result = document.createDocumentFragment();
    parts.forEach(part => {
        result.appendChild(part);
    });
    return result;
}

let iframeResizer;

function renderEmail(email) {
    document.getElementById('email-container').style.display = 'block';

    if (email.subject) {
        document.getElementById('subject-content').style.display = 'block';
        document.getElementById('subject-content').textContent = email.subject;
    } else {
        document.getElementById('subject-content').style.display = 'none';
    }

    if (email.from) {
        document.getElementById('from-container').style.display = 'flex';
        document.querySelector('#from-container .content').innerHTML = '';
        document.querySelector('#from-container .content').appendChild(formatAddress(email.from));
    } else {
        document.getElementById('from-container').style.display = 'none';
    }

    for (let type of ['to', 'cc', 'bcc']) {
        if (email[type] && email[type].length) {
            document.getElementById(`${type}-container`).style.display = 'flex';
            document.querySelector(`#${type}-container .content`).innerHTML = '';
            document.querySelector(`#${type}-container .content`).appendChild(formatAddresses(email[type]));
        } else {
            document.getElementById(`${type}-container`).style.display = 'none';
        }
    }

    if (email.date) {
        document.getElementById('date-container').style.display = 'flex';
        document.querySelector('#date-container .content').innerHTML = '';

        let dateOptions = {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false
        };

        document.querySelector('#date-container .content').textContent = new Intl.DateTimeFormat('default', dateOptions).format(new Date(email.date));
    } else {
        document.getElementById('date-container').style.display = 'none';
    }

    const htmlContainerElm = document.getElementById('html-container');
    const htmlContentElm = document.getElementById('html-content');

    if (iframeResizer) {
        iframeResizer[0].iFrameResizer.close();
        iframeResizer = false;
    }

    htmlContentElm.innerHTML = '';
    if (email.html) {
        const htmlIframe = document.createElement('iframe');
        const iframeKey = `iframe-${Date.now()}`;

        htmlIframe.setAttribute('id', iframeKey);

        // div tag in which iframe will be added should have id attribute with value myDIV
        htmlContentElm.appendChild(htmlIframe);
        htmlContainerElm.style.display = 'block';

        htmlIframe.contentWindow.document.open();
        htmlIframe.contentWindow.document.write(email.html);
        htmlIframe.contentWindow.document.close();

        const iframeScript = document.createElement('script');
        iframeScript.setAttribute('src', '../node_modules/iframe-resizer/js/iframeResizer.contentWindow.js');
        htmlIframe.contentWindow.document.getElementsByTagName('head')[0].appendChild(iframeScript);

        const cssLink = document.createElement('link');
        cssLink.href = './email.css';
        cssLink.type = 'text/css';
        cssLink.rel = 'stylesheet';
        htmlIframe.contentWindow.document.getElementsByTagName('head')[0].appendChild(cssLink);

        htmlIframe.contentWindow.document.querySelectorAll('img').forEach(img => {
            if (/^cid:/.test(img.src)) {
                // replace with inline attachment
                const cid = img.src.substr(4).trim();
                const attachment = email.attachments.find(attachment => attachment.contentId && attachment.contentId === `<${cid}>`);
                if (attachment) {
                    img.src = URL.createObjectURL(new Blob([attachment.content], { type: attachment.mimeType }));
                }
            }
        });

        htmlIframe.contentWindow.document.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
        });

        iframeResizer = iFrameResize({ checkOrigin: false }, `#${iframeKey}`);
    } else {
        htmlContainerElm.style.display = 'none';
    }

    const textContainerElm = document.getElementById('text-container');
    const textContentElm = document.getElementById('text-content');
    textContentElm.innerHTML = '';
    if (email.text) {
        textContentElm.textContent = email.text;
        textContainerElm.style.display = 'block';
    } else {
        textContainerElm.style.display = 'none';
    }

    if (email.attachments && email.attachments.length) {
        document.getElementById('attachments-container').style.display = 'block';
        document.querySelector('#attachments-container .content').innerHTML = '';

        email.attachments.forEach(attachment => {
            const attachmentLink = document.createElement('a');
            attachmentLink.href = URL.createObjectURL(new Blob([attachment.content], { type: attachment.mimeType }));
            attachmentLink.download = attachment.filename || 'attachment';
            attachmentLink.textContent = attachment.filename || `attachment (${attachment.mimeType})`;
            attachmentLink.classList.add('attachment-link');

            document.querySelector('#attachments-container .content').appendChild(attachmentLink);
        });
    } else {
        document.getElementById('attachments-container').style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('open-file').addEventListener('click', () => {
        const parser = new PostalMime();
        browseFileContents()
            .then(file => parser.parse(file))
            .then(email => {
                console.log(JSON.stringify(email, false, 2));
                renderEmail(email);
            })
            .catch(err => console.error(err));
    });
});
