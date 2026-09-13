const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const cd2 = require('../src/electronapp/enhanced/cd2-service');
const cd2Ipc = require('../src/electronapp/enhanced/cd2-ipc');

function readyConfig(overrides) {
    return Object.assign({
        enabled: true,
        origin: cd2.parseOrigin('http://127.0.0.1:19798'),
        token: 'placeholder',
        localPrefix: cd2.normalizeLocalPath('X:\\Media'),
        cloudPrefix: cd2.normalizeCloudPath('/cloud/media'),
        totalBudgetMs: 100
    }, overrides || {});
}

function fakeTransport(handlers) {
    const calls = [];
    const client = {
        close() { calls.push({method: 'close'}); },
        waitForReady(deadline, callback) {
            calls.push({method: 'waitForReady', deadline});
            callback(null);
        }
    };
    for (const method of ['FindFileByPath', 'GetDownloadUrlPath']) {
        client[method] = function (request, metadata, options, callback) {
            const call = {method, request, metadata, options, cancelled: false};
            calls.push(call);
            const handler = handlers && handlers[method];
            if (handler) handler(call, callback);
            else if (method === 'FindFileByPath') callback(null, {fullPathName: request.path, size: '10', fileType: 'File', isDirectory: false});
            else callback(null, {downloadUrlPath: '/static/{SCHEME}/{HOST}/{PREVIEW}/file'});
            return {cancel() { call.cancelled = true; }};
        };
    }
    return {client, metadata: {}, status: {CANCELLED: 1, NOT_FOUND: 5, DEADLINE_EXCEEDED: 4, UNAVAILABLE: 14}, calls};
}

function serviceWith(handlers, config) {
    const transport = fakeTransport(handlers);
    return {
        service: cd2.createService({config: config || readyConfig(), transportFactory: () => transport}),
        transport
    };
}

test('CD2 configuration stays disabled or reports missing token and mapping', async () => {
    for (const [environment, reason] of [
        [{}, 'disabled'],
        [{ETE_CD2_ENABLED: '1', ETE_CD2_ORIGIN: 'http://127.0.0.1:19798', ETE_CD2_LOCAL_PREFIX: 'X:\\Media', ETE_CD2_CLOUD_PREFIX: '/cloud'}, 'missing_token'],
        [{ETE_CD2_ENABLED: '1', ETE_CD2_ORIGIN: 'http://127.0.0.1:19798', ETE_CD2_TOKEN: 'placeholder'}, 'missing_mapping']
    ]) {
        const service = cd2.createService({environment});
        assert.equal((await service.resolve({requestId: 'r1', candidates: ['X:\\Media\\a.mkv']})).reason, reason);
    }
});

test('empty cloud prefix is missing while explicit root mapping is valid', async () => {
    const base = {
        ETE_CD2_ENABLED: '1',
        ETE_CD2_ORIGIN: 'http://127.0.0.1:19798',
        ETE_CD2_TOKEN: 'placeholder',
        ETE_CD2_LOCAL_PREFIX: 'X:\\Media'
    };
    for (const cloudPrefix of [undefined, '', '   ']) {
        const environment = Object.assign({}, base);
        if (cloudPrefix !== undefined) environment.ETE_CD2_CLOUD_PREFIX = cloudPrefix;
        const service = cd2.createService({environment});
        assert.equal((await service.resolve({requestId: 'empty-cloud', candidates: ['X:\\Media\\a.mkv']})).reason, 'missing_mapping');
    }

    const rootConfig = cd2.readConfig(Object.assign({}, base, {ETE_CD2_CLOUD_PREFIX: '/'}));
    assert.equal(rootConfig.error, undefined);
    assert.equal(cd2.mapLocalPath('X:\\Media\\Show\\E01.mkv', rootConfig.localPrefix, rootConfig.cloudPrefix), '/Show/E01.mkv');
});

test('origin and single-prefix mapping enforce local transport and path boundaries', () => {
    assert.ok(cd2.parseOrigin('http://127.0.0.1:19798'));
    assert.ok(cd2.parseOrigin('http://localhost:19798'));
    assert.ok(cd2.parseOrigin('https://cd2.example.test:443'));
    for (const invalid of ['ftp://127.0.0.1:19798', 'http://192.0.2.1:19798', 'http://user@127.0.0.1:19798', 'http://127.0.0.1:19798/?x=1', 'http://127.0.0.1:19798/#x']) {
        assert.equal(cd2.parseOrigin(invalid), null);
    }

    assert.equal(cd2.mapLocalPath('x:/MEDIA/Show/E01.mkv', 'X:\\Media', '/cloud/media'), '/cloud/media/Show/E01.mkv');
    assert.equal(cd2.mapLocalPath('X:\\Show\\E01.mkv', 'X:', '/cloud'), '/cloud/Show/E01.mkv');
    assert.equal(cd2.mapLocalPath('X:\\Media2\\E01.mkv', 'X:\\Media', '/cloud/media'), null);
    assert.equal(cd2.mapLocalPath('X:\\Media\\..\\secret', 'X:\\Media', '/cloud/media'), null);
    assert.equal(cd2.mapLocalPath('\\\\server\\share\\Show\\E01.mkv', '\\\\SERVER\\SHARE', '/cloud'), '/cloud/Show/E01.mkv');
    assert.equal(cd2.mapLocalPath('/srv/media/Show/E01.mkv', '/srv/media', '/cloud'), '/cloud/Show/E01.mkv');
    assert.equal(cd2.mapLocalPath('/srv/Media/Show/E01.mkv', '/srv/media', '/cloud'), null);
    assert.equal(cd2.mapLocalPath('/srv/media2/E01.mkv', '/srv/media', '/cloud'), null);
    assert.equal(cd2.mapLocalPath('/srv/media/../secret', '/srv/media', '/cloud'), null);
});

test('successful lookup uses only the two V1 unary RPCs and get_direct_url=false', async () => {
    const {service, transport} = serviceWith();
    const response = await service.resolve({requestId: 'play-1', candidates: ['X:\\Media\\Show\\E01.mkv']});

    assert.equal(response.status, 'hit');
    assert.equal(response.type, 'url');
    assert.match(response.source, /^http:\/\/127\.0\.0\.1:19798\//);
    assert.deepEqual(transport.calls.map(call => call.method), ['waitForReady', 'FindFileByPath', 'GetDownloadUrlPath']);
    assert.equal(transport.calls[1].request.path, '/cloud/media/Show/E01.mkv');
    assert.deepEqual(transport.calls[2].request, {path: '/cloud/media/Show/E01.mkv', preview: false, lazy_read: false, get_direct_url: false});
    assert.ok(transport.calls.filter(call => call.options).every(call => call.options.deadline instanceof Date));
});

test('RPC failures, missing files, directories and malformed file responses fail closed', async () => {
    const cases = [
        [{FindFileByPath: (_, cb) => cb({code: 14})}, 'unavailable'],
        [{FindFileByPath: (_, cb) => cb({code: 5})}, 'not_found'],
        [{FindFileByPath: (_, cb) => cb(null, {fullPathName: '/x', size: '1', fileType: 'Directory', isDirectory: true})}, 'invalid_file'],
        [{FindFileByPath: (_, cb) => cb(null, {fullPathName: '/x', size: '1', fileType: 'Other', isDirectory: false})}, 'invalid_file'],
        [{FindFileByPath: (_, cb) => cb(null, {})}, 'invalid_file'],
        [{FindFileByPath: (_, cb) => cb(null, {fullPathName: '/x', size: '-1', fileType: 'File'})}, 'invalid_file']
    ];
    for (let index = 0; index < cases.length; index++) {
        const {service} = serviceWith(cases[index][0]);
        const response = await service.resolve({requestId: 'failure-' + index, candidates: ['X:\\Media\\x.mkv']});
        assert.equal(response.status, 'miss');
        assert.equal(response.reason, cases[index][1]);
    }
});

test('real grpc-js connection refusal stays inside the bounded fallback budget', async () => {
    const service = cd2.createService({config: readyConfig({
        origin: cd2.parseOrigin('http://127.0.0.1:1'),
        totalBudgetMs: 80
    })});
    const started = Date.now();
    const response = await service.resolve({requestId: 'refused-1', candidates: ['X:\\Media\\x.mkv']});
    service.close();
    assert.equal(response.status, 'miss');
    assert.ok(['unavailable', 'timeout'].includes(response.reason));
    assert.ok(Date.now() - started < 500);
});

test('download URL validation rejects empty, placeholders, foreign origin, port, scheme and direct results', async () => {
    const responses = [
        [{downloadUrlPath: ''}, 'invalid_download_url'],
        [{downloadUrlPath: '/{UNKNOWN}/file'}, 'invalid_download_url'],
        [{downloadUrlPath: 'http://example.test/file'}, 'invalid_download_url'],
        [{downloadUrlPath: 'http://127.0.0.1:19799/file'}, 'invalid_download_url'],
        [{downloadUrlPath: 'ftp://127.0.0.1:19798/file'}, 'invalid_download_url'],
        [{downloadUrlPath: '/file', directUrl: 'https://example.test/file'}, 'unsupported_response'],
        [{downloadUrlPath: '/file', externalUrl: 'https://example.test/file'}, 'unsupported_response']
    ];
    for (let index = 0; index < responses.length; index++) {
        const {service} = serviceWith({GetDownloadUrlPath: (_, cb) => cb(null, responses[index][0])});
        const response = await service.resolve({requestId: 'url-' + index, candidates: ['X:\\Media\\x.mkv']});
        assert.equal(response.reason, responses[index][1]);
    }
});

test('absolute timeout cancels a slow unary call and late callbacks stay ignored', async () => {
    let lateCallback;
    const {service, transport} = serviceWith({FindFileByPath: (_, cb) => { lateCallback = cb; }}, readyConfig({totalBudgetMs: 20}));
    const response = await service.resolve({requestId: 'slow-1', candidates: ['X:\\Media\\x.mkv']});

    assert.equal(response.reason, 'timeout');
    assert.equal(transport.calls.find(call => call.method === 'FindFileByPath').cancelled, true);
    lateCallback(null, {fullPathName: '/cloud/media/x.mkv', size: '1', fileType: 'File'});
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(transport.calls.filter(call => call.method === 'GetDownloadUrlPath').length, 0);
});

test('cancel stops the active unary call and resolves as cancelled', async () => {
    let callback;
    const {service, transport} = serviceWith({FindFileByPath: (_, cb) => { callback = cb; }}, readyConfig({totalBudgetMs: 100}));
    const pending = service.resolve({requestId: 'cancel-1', candidates: ['X:\\Media\\x.mkv']});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.cancel('cancel-1'), true);
    callback({code: 1});
    const response = await pending;
    assert.equal(response.status, 'cancelled');
    assert.equal(transport.calls.find(call => call.method === 'FindFileByPath').cancelled, true);
});

test('IPC exposes only trusted resolve and cancel operations', async () => {
    const handlers = {};
    const listeners = {};
    const calls = [];
    const trusted = {};
    const ipcMain = {
        handle(name, fn) { handlers[name] = fn; },
        on(name, fn) { listeners[name] = fn; },
        removeHandler(name) { delete handlers[name]; },
        removeAllListeners(name) { delete listeners[name]; }
    };
    const unregister = cd2Ipc.register({
        ipcMain,
        getWebContents: () => trusted,
        service: {
            resolve(request) { calls.push(['resolve', request.requestId]); return {status: 'miss', reason: 'test'}; },
            cancel(requestId) { calls.push(['cancel', requestId]); },
            close() { calls.push(['close']); }
        }
    });

    assert.equal((await handlers[cd2Ipc.RESOLVE_CHANNEL]({sender: {}}, {requestId: 'bad'})).reason, 'untrusted_sender');
    await handlers[cd2Ipc.RESOLVE_CHANNEL]({sender: trusted}, {requestId: 'good'});
    listeners[cd2Ipc.CANCEL_CHANNEL]({sender: trusted}, {requestId: 'good'});
    unregister();
    assert.deepEqual(calls, [['resolve', 'good'], ['cancel', 'good'], ['close']]);
});

test('fake HTTP fixture covers 200, Range 206, 404, 500, redirect and timeout', async () => {
    const body = Buffer.from('fixture-media');
    const server = http.createServer((request, response) => {
        if (request.url === '/redirect') { response.writeHead(307, {Location: '/media'}); return response.end(); }
        if (request.url === '/missing') { response.writeHead(404); return response.end(); }
        if (request.url === '/error') { response.writeHead(500); return response.end(); }
        if (request.url === '/slow') return setTimeout(() => response.end(body), 80);
        if (request.url !== '/media') { response.writeHead(404); return response.end(); }
        if (request.headers.range === 'bytes=0-0') {
            response.writeHead(206, {'Accept-Ranges': 'bytes', 'Content-Range': 'bytes 0-0/' + body.length, 'Content-Length': '1'});
            return response.end(body.subarray(0, 1));
        }
        response.writeHead(200, {'Accept-Ranges': 'bytes', 'Content-Length': String(body.length)});
        response.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (path, options) => new Promise((resolve, reject) => {
        const req = http.get({host: '127.0.0.1', port, path, headers: options && options.headers}, response => {
            response.resume(); response.on('end', () => resolve(response));
        });
        req.setTimeout(options && options.timeout || 200, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
    try {
        assert.equal((await request('/media')).statusCode, 200);
        assert.equal((await request('/media', {headers: {Range: 'bytes=0-0'}})).statusCode, 206);
        assert.equal((await request('/missing')).statusCode, 404);
        assert.equal((await request('/error')).statusCode, 500);
        assert.equal((await request('/redirect')).statusCode, 307);
        await assert.rejects(request('/slow', {timeout: 10}), /timeout/);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
