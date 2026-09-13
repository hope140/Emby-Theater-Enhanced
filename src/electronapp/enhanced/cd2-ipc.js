'use strict';

const RESOLVE_CHANNEL = 'enhanced-cd2-resolve';
const CANCEL_CHANNEL = 'enhanced-cd2-cancel';

function register(options) {
    const ipcMain = options.ipcMain;
    const service = options.service;
    const getWebContents = options.getWebContents;

    function isTrusted(event) {
        const expected = getWebContents();
        return !!expected && event && event.sender === expected;
    }

    ipcMain.handle(RESOLVE_CHANNEL, function (event, request) {
        if (!isTrusted(event)) return {status: 'miss', reason: 'untrusted_sender'};
        return service.resolve(request);
    });

    ipcMain.on(CANCEL_CHANNEL, function (event, request) {
        if (!isTrusted(event)) return;
        service.cancel(request && request.requestId);
    });

    return function unregister() {
        if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(RESOLVE_CHANNEL);
        if (typeof ipcMain.removeAllListeners === 'function') ipcMain.removeAllListeners(CANCEL_CHANNEL);
        service.close();
    };
}

module.exports = {
    CANCEL_CHANNEL: CANCEL_CHANNEL,
    RESOLVE_CHANNEL: RESOLVE_CHANNEL,
    register: register
};
