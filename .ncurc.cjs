module.exports = {
    upgrade: true,
    reject: [
        // license changes
        'iframe-resizer'
    ],
    target: name => {
        // typescript-eslint declares a peer range that excludes TypeScript 7
        if (name === 'typescript') {
            return 'minor';
        }
        return 'latest';
    }
};
