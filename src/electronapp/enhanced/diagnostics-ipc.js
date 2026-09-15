'use strict';

const fs = require('fs');
const path = require('path');
const diagnostics = require('./diagnostics');

const CHANNELS = Object.freeze({
    GET_STATUS: 'enhanced-diagnostics-status',
    EXPORT: 'enhanced-diagnostics-export',
    OPEN_DIRECTORY: 'enhanced-diagnostics-open-directory',
    CLEAR: 'enhanced-diagnostics-clear'
});

function register(options) {
    const settings = options || {};
    const ipcMain = settings.ipcMain;
    const logger = settings.logger;
    const getWebContents = settings.getWebContents;
    const getBrowserWindow = settings.getBrowserWindow || function () { return null; };
    const dialog = settings.dialog;
    const shell = settings.shell;
    const fileSystem = settings.fs || fs;
    const registered = [];

    function isTrusted(event) {
        const expected = typeof getWebContents === 'function' ? getWebContents() : null;
        return !!expected && event && event.sender === expected;
    }

    function rejectUntrusted() {
        return {status: 'error', reason: 'untrusted_sender'};
    }

    function registerHandler(channel, handler) {
        ipcMain.handle(channel, async function (event, request) {
            if (!isTrusted(event)) return rejectUntrusted();
            try {
                return await handler(request);
            } catch (_) {
                return {status: 'error', reason: 'diagnostics_operation_failed'};
            }
        });
        registered.push(channel);
    }

    registerHandler(CHANNELS.GET_STATUS, async function () {
        if (!logger || typeof logger.status !== 'function') return {status: 'error', reason: 'diagnostics_unavailable'};
        return Object.assign({status: 'ok'}, await logger.status());
    });

    registerHandler(CHANNELS.EXPORT, async function () {
        if (!logger || typeof logger.exportReport !== 'function' || !dialog || typeof dialog.showSaveDialog !== 'function') {
            return {status: 'error', reason: 'diagnostics_unavailable'};
        }
        const report = await logger.exportReport(typeof settings.getAppInfo === 'function' ? settings.getAppInfo() : {});
        const fileName = diagnostics.makeExportFileName(new Date());
        let defaultPath = fileName;
        try {
            if (settings.app && typeof settings.app.getPath === 'function') {
                defaultPath = path.join(settings.app.getPath('downloads'), fileName);
            }
        } catch (_) { }
        const result = await dialog.showSaveDialog(getBrowserWindow(), {
            title: '导出诊断日志',
            defaultPath: defaultPath,
            filters: [{name: 'Text', extensions: ['txt']}]
        });
        if (!result || result.canceled || !result.filePath) return {status: 'cancelled'};
        const outputPath = result.filePath;
        if (typeof fileSystem.promises !== 'object' || typeof fileSystem.promises.writeFile !== 'function') {
            return {status: 'error', reason: 'diagnostics_write_unavailable'};
        }
        await fileSystem.promises.writeFile(outputPath, report, 'utf8');
        return {status: 'exported', fileName: path.basename(outputPath)};
    });

    registerHandler(CHANNELS.OPEN_DIRECTORY, async function () {
        if (!logger || typeof logger.getPaths !== 'function' || !shell || typeof shell.openPath !== 'function') {
            return {status: 'error', reason: 'diagnostics_unavailable'};
        }
        const paths = logger.getPaths();
        const error = await shell.openPath(paths.directory);
        return error ? {status: 'error', reason: 'open_directory_failed'} : {status: 'opened'};
    });

    registerHandler(CHANNELS.CLEAR, async function (request) {
        if (!request || request.confirmed !== true) return {status: 'error', reason: 'confirmation_required'};
        if (!logger || typeof logger.clear !== 'function') return {status: 'error', reason: 'diagnostics_unavailable'};
        const cleared = await logger.clear();
        return cleared ? {status: 'cleared'} : {status: 'error', reason: 'clear_failed'};
    });

    return function unregister() {
        if (typeof ipcMain.removeHandler === 'function') registered.forEach(function (channel) { ipcMain.removeHandler(channel); });
    };
}

module.exports = {
    CHANNELS,
    register
};
