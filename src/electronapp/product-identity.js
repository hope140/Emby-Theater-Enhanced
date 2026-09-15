'use strict';

function getAppName(metadata) {
    var info = metadata || {};
    return info.productName || info.name;
}

function setAppName(app, metadata) {
    var name = getAppName(metadata);
    if (!app || typeof app.setName !== 'function') throw new Error('Electron app.setName is required.');
    if (!name) throw new Error('Runtime package metadata requires productName or name.');
    app.setName(name);
    return name;
}

module.exports = {getAppName, setAppName};
