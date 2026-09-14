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
        directUrlEnabled: true,
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

test('successful DirectUrl lookup keeps the same-origin response available for fallback', async () => {
    const {service, transport} = serviceWith();
    const response = await service.resolve({requestId: 'play-1', candidates: ['X:\\Media\\Show\\E01.mkv']});

    assert.equal(response.status, 'hit');
    assert.equal(response.type, 'url');
    assert.match(response.source, /^http:\/\/127\.0\.0\.1:19798\//);
    assert.deepEqual(transport.calls.map(call => call.method), ['waitForReady', 'FindFileByPath', 'GetDownloadUrlPath']);
    assert.equal(transport.calls[1].request.path, '/cloud/media/Show/E01.mkv');
    assert.deepEqual(transport.calls[2].request, {path: '/cloud/media/Show/E01.mkv', preview: false, lazy_read: false, get_direct_url: true});
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

test('same-origin fallback validates empty, placeholders, foreign origin, port and scheme', async () => {
    const responses = [
        [{downloadUrlPath: ''}, 'invalid_download_url'],
        [{downloadUrlPath: '/{UNKNOWN}/file'}, 'invalid_download_url'],
        [{downloadUrlPath: 'http://example.test/file'}, 'invalid_download_url'],
        [{downloadUrlPath: 'http://127.0.0.1:19799/file'}, 'invalid_download_url'],
        [{downloadUrlPath: 'ftp://127.0.0.1:19798/file'}, 'invalid_download_url'],
        [{downloadUrlPath: '/file', directUrl: 'not-a-url'}, 'cd2_hit'],
        [{downloadUrlPath: '/file', externalUrl: 'https://example.test/file'}, 'cd2_hit']
    ];
    for (let index = 0; index < responses.length; index++) {
        const {service} = serviceWith({GetDownloadUrlPath: (_, cb) => cb(null, responses[index][0])});
        const response = await service.resolve({requestId: 'url-' + index, candidates: ['X:\\Media\\x.mkv']});
        assert.equal(response.reason, responses[index][1]);
    }
});

test('DirectUrl is enabled by default and can be explicitly disabled by environment', () => {
    const base = {
        ETE_CD2_ENABLED: '1',
        ETE_CD2_ORIGIN: 'http://127.0.0.1:19798',
        ETE_CD2_TOKEN: 'placeholder',
        ETE_CD2_LOCAL_PREFIX: 'X:\\Media',
        ETE_CD2_CLOUD_PREFIX: '/cloud'
    };
    assert.equal(cd2.readConfig(base).directUrlEnabled, true);
    assert.equal(cd2.readConfig(Object.assign({}, base, {ETE_CD2_DIRECT_URL: '0'})).directUrlEnabled, false);
});

test('valid DirectUrl with a safe User-Agent returns file-local request options', async () => {
    const {service, transport} = serviceWith({
        GetDownloadUrlPath: (call, cb) => {
            if (call.request.get_direct_url) {
                cb(null, {
                    directUrl: 'https://cdn.example.test/file?fixture=opaque',
                    userAgent: 'CD2-Client/1.0',
                    additionalHeaders: {},
                    expiresIn: '60',
                    downloadUrlPath: '/fallback/file'
                });
            } else {
                cb(null, {downloadUrlPath: '/fallback/file'});
            }
        }
    });

    const response = await service.resolve({requestId: 'direct-ua', candidates: ['X:\\Media\\x.mkv']});
    assert.equal(response.status, 'hit');
    assert.equal(response.sourceKind, 'direct-url');
    assert.equal(response.reason, 'direct_url_hit');
    assert.equal(response.source, 'https://cdn.example.test/file?fixture=opaque');
    assert.deepEqual(response.requestOptions, {userAgent: 'CD2-Client/1.0'});
    assert.equal(response.expiresAt, response.acquiredAt + 60000);
    assert.equal(transport.calls.filter(call => call.method === 'GetDownloadUrlPath').length, 1);
});

test('missing or malformed DirectUrl falls back to the validated same-origin URL', async () => {
    const cases = [
        {directUrl: undefined, downloadUrlPath: '/fallback/missing'},
        {directUrl: 'not-a-url', downloadUrlPath: ''},
        {directUrl: 'javascript:alert(1)', downloadUrlPath: '/fallback/scheme'},
        {directUrl: 'file:///C:/media.mkv', downloadUrlPath: '/fallback/file'},
        {directUrl: 'https://user:pass@cdn.example.test/file', downloadUrlPath: '/fallback/userinfo'},
        {directUrl: 'https://cdn.example.test/file#fragment', downloadUrlPath: '/fallback/fragment'},
        {directUrl: 'https://cdn.example.test/file', expiresIn: '0', downloadUrlPath: '/fallback/expiry'}
    ];

    for (let index = 0; index < cases.length; index++) {
        const {service, transport} = serviceWith({
            GetDownloadUrlPath: (call, cb) => {
                if (call.request.get_direct_url) cb(null, Object.assign({}, cases[index]));
                else cb(null, {downloadUrlPath: '/fallback/reacquired'});
            }
        });
        const response = await service.resolve({requestId: 'direct-missing-' + index, candidates: ['X:\\Media\\x.mkv']});
        assert.equal(response.status, 'hit');
        assert.equal(response.sourceKind, 'cd2-url');
        assert.equal(response.reason, 'cd2_hit');
        assert.match(response.source, /^http:\/\/127\.0\.0\.1:19798\//);
        assert.equal(transport.calls.filter(call => call.method === 'GetDownloadUrlPath').length, cases[index].downloadUrlPath ? 1 : 2);
    }
});

test('unsafe User-Agent and any non-empty additionalHeaders use same-origin fallback', async () => {
    let index = 0;
    for (const directFields of [
        {directUrl: 'https://cdn.example.test/file', userAgent: 'bad,ua', downloadUrlPath: '/fallback/ua'},
        {directUrl: 'https://cdn.example.test/file', userAgent: '', downloadUrlPath: '/fallback/empty-ua'},
        {directUrl: 'https://cdn.example.test/file', userAgent: 'bad\\ua', downloadUrlPath: '/fallback/backslash'},
        {directUrl: 'https://cdn.example.test/file', userAgent: 'bad\r\nua', downloadUrlPath: '/fallback/crlf'},
        {directUrl: 'https://cdn.example.test/file', userAgent: '非 ASCII', downloadUrlPath: '/fallback/non-ascii'},
        {directUrl: 'https://cdn.example.test/file', userAgent: 'safe', additionalHeaders: {'X-Synthetic-Header': 'fixture'}, downloadUrlPath: '/fallback/headers'}
    ]) {
        const {service} = serviceWith({
            GetDownloadUrlPath: (call, cb) => cb(null, directFields)
        });
        const response = await service.resolve({requestId: 'direct-unsafe-' + index++, candidates: ['X:\\Media\\x.mkv']});
        assert.equal(response.status, 'hit');
        assert.equal(response.sourceKind, 'cd2-url');
        assert.equal(response.reason, 'cd2_hit');
    }
});

test('DirectUrl transport rejection retries same-origin within the same request', async () => {
    const {service, transport} = serviceWith({
        GetDownloadUrlPath: (call, cb) => {
            if (call.request.get_direct_url) cb({code: 14});
            else cb(null, {downloadUrlPath: '/fallback/rejected'});
        }
    });
    const response = await service.resolve({requestId: 'direct-reject', candidates: ['X:\\Media\\x.mkv']});
    assert.equal(response.status, 'hit');
    assert.equal(response.sourceKind, 'cd2-url');
    assert.deepEqual(transport.calls.filter(call => call.method === 'GetDownloadUrlPath').map(call => call.request.get_direct_url), [true, false]);
});

test('DirectUrl timeout reserves part of the absolute budget for same-origin fallback', async () => {
    const {service, transport} = serviceWith({
        GetDownloadUrlPath: (call, cb) => {
            if (!call.request.get_direct_url) cb(null, {downloadUrlPath: '/fallback/after-timeout'});
        }
    }, readyConfig({totalBudgetMs: 430}));
    const started = Date.now();
    const response = await service.resolve({requestId: 'direct-timeout-fallback', candidates: ['X:\\Media\\x.mkv']});

    assert.equal(response.status, 'hit');
    assert.equal(response.sourceKind, 'cd2-url');
    assert.equal(response.directReason, 'timeout');
    assert.deepEqual(transport.calls.filter(call => call.method === 'GetDownloadUrlPath').map(call => call.request.get_direct_url), [true, false]);
    assert.ok(Date.now() - started >= 250 && Date.now() - started < 600);
});

test('known near-expiry DirectUrl is reacquired at most once', async () => {
    let directCalls = 0;
    const transport = fakeTransport({
        GetDownloadUrlPath: (call, cb) => {
            if (!call.request.get_direct_url) return cb(null, {downloadUrlPath: '/fallback/expiry'});
            directCalls++;
            cb(null, directCalls === 1
                ? {directUrl: 'https://cdn.example.test/old', expiresIn: '1'}
                : {directUrl: 'https://cdn.example.test/fresh', expiresIn: '60'});
        }
    });
    const service = cd2.createService({
        config: readyConfig({totalBudgetMs: 1000}),
        now: () => 100000,
        transportFactory: () => transport
    });

    const response = await service.resolve({requestId: 'direct-expiry', candidates: ['X:\\Media\\x.mkv']});
    assert.equal(response.status, 'hit');
    assert.equal(response.source, 'https://cdn.example.test/fresh');
    assert.equal(response.sourceKind, 'direct-url');
    assert.equal(directCalls, 2);
});

test('failed DirectUrl reacquire falls back to same-origin', async () => {
    const calls = [];
    const transport = fakeTransport({
        GetDownloadUrlPath: (call, cb) => {
            calls.push(call.request.get_direct_url);
            if (call.request.get_direct_url && calls.length === 1) return cb(null, {directUrl: 'https://cdn.example.test/old', expiresIn: '1'});
            if (call.request.get_direct_url) return cb({code: 14});
            return cb(null, {downloadUrlPath: '/fallback/after-expiry'});
        }
    });
    const service = cd2.createService({
        config: readyConfig({totalBudgetMs: 1000}),
        now: () => 100000,
        transportFactory: () => transport
    });

    const response = await service.resolve({requestId: 'direct-expiry-fail', candidates: ['X:\\Media\\x.mkv']});
    assert.equal(response.status, 'hit');
    assert.equal(response.sourceKind, 'cd2-url');
    assert.deepEqual(calls, [true, true, false]);
});

test('near-expiry reacquire timeout preserves a real same-origin window', async () => {
    const calls = [];
    let directCalls = 0;
    const transport = fakeTransport({
        FindFileByPath: (call, cb) => setTimeout(() => cb(null, {
            fullPathName: call.request.path,
            size: '10',
            fileType: 'File',
            isDirectory: false
        }), 250),
        GetDownloadUrlPath: (call, cb) => {
            calls.push(call.request.get_direct_url);
            if (!call.request.get_direct_url) return cb(null, {downloadUrlPath: '/fallback/reserved'});
            directCalls++;
            if (directCalls === 1) {
                setTimeout(() => cb(null, {directUrl: 'https://cdn.example.test/near-expiry', expiresIn: '1'}), 200);
            }
        }
    });
    const service = cd2.createService({
        config: readyConfig({totalBudgetMs: 750}),
        transportFactory: () => transport
    });
    const started = Date.now();

    const response = await service.resolve({requestId: 'reacquire-reserve', candidates: ['X:\\Media\\x.mkv']});
    const elapsed = Date.now() - started;

    assert.equal(response.status, 'hit');
    assert.equal(response.sourceKind, 'cd2-url');
    assert.equal(response.directReason, 'timeout');
    assert.deepEqual(calls, [true, true, false]);
    assert.ok(elapsed >= 500 && elapsed < 750);
});

test('explicit DirectUrl disable preserves the single same-origin RPC path', async () => {
    const {service, transport} = serviceWith(null, readyConfig({directUrlEnabled: false}));
    const response = await service.resolve({requestId: 'direct-disabled', candidates: ['X:\\Media\\x.mkv']});
    assert.equal(response.status, 'hit');
    assert.equal(response.sourceKind, 'cd2-url');
    assert.deepEqual(transport.calls.filter(call => call.method === 'GetDownloadUrlPath').map(call => call.request.get_direct_url), [false]);
});

test('cancelling a pending DirectUrl does not enter same-origin fallback', async () => {
    let callback;
    const {service, transport} = serviceWith({
        GetDownloadUrlPath: (call, cb) => {
            if (call.request.get_direct_url) callback = cb;
            else cb(null, {downloadUrlPath: '/fallback/should-not-run'});
        }
    }, readyConfig({totalBudgetMs: 500}));
    const pending = service.resolve({requestId: 'direct-cancel', candidates: ['X:\\Media\\x.mkv']});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.cancel('direct-cancel'), true);
    const response = await pending;
    assert.equal(response.status, 'cancelled');
    assert.equal(transport.calls.filter(call => call.method === 'GetDownloadUrlPath').length, 1);
    callback(null, {directUrl: 'https://cdn.example.test/late'});
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
