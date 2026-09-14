'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '../src/electronapp/main.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(__dirname, '../src/electronapp/shell.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '../src/electronapp/preload.js'), 'utf8');
const cd2Ipc = require('../src/electronapp/enhanced/cd2-ipc');

function assertNoActiveContract(source, label, pattern) {
    assert.doesNotMatch(source, pattern, label + ' must not remain in product source');
}

test('dead process channels and helpers are absent while active IPC stays wired', () => {
    for (const [label, pattern] of [
        ['mpvPosEvent registration', /mpvPosEvent/],
        ['mpvPos producer', /mpvPos/],
        ['mpv named-pipe path', /mpv-socket/],
        ['shellstart dispatch', /shellstart/],
        ['shellclose dispatch', /shellclose/],
        ['startProcess helper', /startProcess/],
        ['closeProcess helper', /closeProcess/],
        ['process table', /\bprocesses\b/]
    ]) {
        assertNoActiveContract(mainSource, label, pattern);
    }

    assert.match(mainSource, /var \{ ipcMain \} = require\('electron'\)/);
    assert.match(mainSource, /require\('\.\/enhanced\/cd2-ipc'\)/);
    assert.match(mainSource, /enhanced-diagnostics/);
    assert.match(preloadSource, /window\.ipc = ipcRenderer/);
    assert.match(preloadSource, /enhanced-diagnostics/);
});

test('Electron host keeps openurl dispatch and active host commands', () => {
    assert.match(mainSource, /case 'openurl':[\s\S]{0,220}electron\.shell\.openExternal/);
    for (const command of ['windowstate-Normal', 'sleep', 'shutdown', 'video-on', 'video-off', 'audio-on', 'audio-off', 'loaded']) {
        assert.match(mainSource, new RegExp("case '" + command + "'"));
    }
});

test('Electron shell exposes openUrl only and preserves its protocol request', async () => {
    let shell;
    const requests = [];
    class FakeXMLHttpRequest {
        open(method, url, asynchronous) {
            this.method = method;
            this.url = url;
            this.asynchronous = asynchronous;
        }

        send() {
            requests.push({method: this.method, url: this.url, asynchronous: this.asynchronous});
            this.response = 'ok';
            this.onload();
        }
    }

    vm.runInNewContext(shellSource, {
        XMLHttpRequest: FakeXMLHttpRequest,
        Promise,
        define(dependencies, factory) {
            assert.equal(dependencies.length, 0);
            shell = factory();
        }
    }, {filename: 'electron-shell.js'});

    assert.equal(typeof shell.openUrl, 'function');
    assert.equal(Object.prototype.hasOwnProperty.call(shell, 'canExec'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(shell, 'exec'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(shell, 'close'), false);

    const url = 'https://example.test/watch?id=42';
    assert.equal(await shell.openUrl(url), 'ok');
    assert.deepEqual(requests, [{
        method: 'GET',
        url: 'electronapphost://openurl?url=' + url,
        asynchronous: true
    }]);
});

test('CD2 resolve/cancel IPC remains a trusted active bridge', async () => {
    const handlers = {};
    const listeners = {};
    const calls = [];
    const trustedSender = {};
    const ipcMain = {
        handle(name, handler) { handlers[name] = handler; },
        on(name, handler) { listeners[name] = handler; },
        removeHandler(name) { delete handlers[name]; },
        removeAllListeners(name) { delete listeners[name]; }
    };
    const unregister = cd2Ipc.register({
        ipcMain,
        getWebContents: () => trustedSender,
        service: {
            resolve(request) { calls.push(['resolve', request.requestId]); return {status: 'hit'}; },
            cancel(requestId) { calls.push(['cancel', requestId]); },
            close() { calls.push(['close']); }
        }
    });

    assert.equal(typeof handlers[cd2Ipc.RESOLVE_CHANNEL], 'function');
    assert.equal(typeof listeners[cd2Ipc.CANCEL_CHANNEL], 'function');
    assert.deepEqual(await handlers[cd2Ipc.RESOLVE_CHANNEL]({sender: trustedSender}, {requestId: 'r1'}), {status: 'hit'});
    listeners[cd2Ipc.CANCEL_CHANNEL]({sender: trustedSender}, {requestId: 'r1'});
    unregister();
    assert.deepEqual(calls, [['resolve', 'r1'], ['cancel', 'r1'], ['close']]);
});

test('Anime4K config helper and unrelated CEC process execution remain present', () => {
    assert.match(mainSource, /require\('child_process'\)\.exec/);
    assert.match(mainSource, /notepad\.exe/);
    assert.match(mainSource, /Anime4K\.conf/);

    const cecSource = fs.readFileSync(path.join(__dirname, '../src/electronapp/cec/cec.js'), 'utf8');
    assert.match(cecSource, /child_process\.spawn/);
    assert.match(mainSource, /electroncec/);
});
