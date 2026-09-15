'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const diagnostics = require('../src/electronapp/enhanced/diagnostics');
const diagnosticsIpc = require('../src/electronapp/enhanced/diagnostics-ipc');
const cd2Service = require('../src/electronapp/enhanced/cd2-service');
const strmResolver = require('../src/electronapp/resolvers/strm-resolver');

function tempRoot(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function baseContext() {
    return {
        item: {Path: 'C:\\Library\\Movie.mkv.strm'},
        mediaSource: {Path: 'C:\\Source\\Movie.mkv', Container: 'strm'},
        url: 'https://emby.example.test/videos/native-stream',
        playMethod: 'DirectPlay'
    };
}

async function resolveWith(kind, options) {
    const settings = options || {};
    const events = [];
    const result = await strmResolver.resolveAsync(baseContext(), {
        fs: {existsSync: value => settings.mount === true && value === 'C:\\Source\\Movie.mkv'},
        requestId: 'diagnostic-' + kind,
        onDiagnostic: event => events.push(event),
        cd2Transport: {
            resolve: async request => {
                if (kind === 'direct' && request.mode === undefined) {
                    return {status: 'hit', type: 'url', source: 'https://cdn.example.test/file?token=secret123', sourceKind: 'direct-url'};
                }
                if (kind === 'cd2' && request.mode === undefined) {
                    return {status: 'hit', type: 'url', source: 'http://127.0.0.1:19798/download/file', sourceKind: 'cd2-url'};
                }
                return {status: 'miss', reason: 'unavailable'};
            }
        }
    });
    return {result, events};
}

test('structured sanitizer redacts credentials, URLs, local paths, identifiers and unsafe objects', () => {
    const circular = {};
    circular.self = circular;
    const record = diagnostics.sanitizeRecord({category: 'privacy', event: 'input', details: {
        authorization: 'Bearer ABCDEFG',
        'X-Emby-Token': 'secret123',
        api_key: 'secret123',
        token: 'secret123',
        Cookie: 'session=secret123',
        password: 'secret123',
        message: 'api_key=secret123 token=secret123',
        url: 'https://example.com/video.mkv?token=secret123',
        directUrl: 'https://cdn.example.test/file?token=secret123',
        windowsPath: 'C:\\Users\\hope\\Movies\\movie.mkv',
        uncPath: '\\\\NAS\\Movies\\movie.mkv',
        posixPath: '/mnt/media/movie.mkv',
        deviceId: 'device-raw-value',
        circular: circular,
        undefinedValue: undefined,
        nullValue: null,
        hugeError: new Error('x'.repeat(10000))
    }});
    const serialized = JSON.stringify(record);

    assert.doesNotMatch(serialized, /ABCDEFG|secret123|C:\\Users\\hope|\\\\NAS\\Movies|\/mnt\/media\/movie\.mkv/);
    assert.match(serialized, /hostHash/);
    assert.match(serialized, /pathHash/);
    assert.match(serialized, /deviceIdHash/);
    assert.match(serialized, /Circular/);
    assert.ok(serialized.length < 20000);
    assert.deepEqual(diagnostics.sanitizeRecord(record), record);
});

test('logger creates the target directory, appends JSONL and rotates three bounded files', async () => {
    const root = tempRoot('ete-client-log-');
    try {
        const logger = diagnostics.createLogger(root);
        const paths = logger.getPaths();
        fs.mkdirSync(paths.directory, {recursive: true});
        fs.writeFileSync(paths.file, 'x'.repeat(diagnostics.LOG_MAX_BYTES + 1), 'utf8');
        await logger({category: 'test', event: 'rotate', details: {ok: true}});
        await logger.flush();

        assert.equal(fs.existsSync(paths.rotations[0]), true);
        assert.equal(fs.readFileSync(paths.rotations[0], 'utf8').startsWith('x'), true);
        assert.match(fs.readFileSync(paths.file, 'utf8'), /"event":"rotate"/);
        assert.equal(paths.rotations.length, 3);
        assert.equal((await logger.status()).logDirectory, diagnostics.DISPLAY_LOG_DIRECTORY);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('logger failure is fail-open for directory creation and append errors', async () => {
    const root = tempRoot('ete-client-log-fail-');
    const errorFs = {
        promises: {
            mkdir: async () => { throw new Error('mkdir-failed'); },
            stat: async () => { throw new Error('stat-failed'); },
            appendFile: async () => { throw new Error('append-failed'); },
            rename: async () => { throw new Error('rename-failed'); },
            unlink: async () => { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); },
            readFile: async () => { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); }
        }
    };
    try {
        const logger = diagnostics.createLogger(root, {fs: errorFs});
        assert.equal(await logger({category: 'test', event: 'fail', details: {value: true}}), false);
        await logger.flush();
        assert.equal(await logger.clear(), true);

        const appendFailureFs = {
            promises: {
                mkdir: async () => {},
                stat: async () => { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); },
                appendFile: async () => { throw new Error('append-failed'); },
                rename: async () => {},
                unlink: async () => { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); },
                readFile: async () => { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); }
            }
        };
        const appendLogger = diagnostics.createLogger(root, {fs: appendFailureFs});
        assert.equal(await appendLogger({category: 'test', event: 'append-fail', details: {value: true}}), false);
        await appendLogger.flush();
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('rotation failure still permits the current append and never reaches the caller', async () => {
    const root = tempRoot('ete-client-log-rotate-fail-');
    try {
        const paths = diagnostics.getLogPaths(root);
        fs.mkdirSync(paths.directory, {recursive: true});
        fs.writeFileSync(paths.file, 'x'.repeat(diagnostics.LOG_MAX_BYTES + 1), 'utf8');
        const rotateFailureFs = {
            promises: {
                mkdir: async directory => fs.promises.mkdir(directory, {recursive: true}),
                stat: async file => fs.promises.stat(file),
                appendFile: async (file, data, encoding) => fs.promises.appendFile(file, data, encoding),
                rename: async () => { throw new Error('rotation-failed'); },
                unlink: async () => { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); },
                readFile: async (file, encoding) => fs.promises.readFile(file, encoding)
            }
        };
        const logger = diagnostics.createLogger(root, {fs: rotateFailureFs});
        assert.equal(await logger({category: 'test', event: 'rotate-fail', details: {ok: true}}), true);
        await logger.flush();
        assert.match(fs.readFileSync(paths.file, 'utf8'), /"event":"rotate-fail"/);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('export tolerates malformed rotation lines and produces an AI-friendly deterministic summary', async () => {
    const root = tempRoot('ete-client-export-');
    try {
        const logger = diagnostics.createLogger(root);
        const paths = logger.getPaths();
        fs.mkdirSync(paths.directory, {recursive: true});
        fs.writeFileSync(paths.rotations[2], JSON.stringify({
            timestamp: '2026-09-16T00:00:00.000Z',
            level: 'info',
            category: 'resolver',
            event: 'route-selected',
            details: {requestId: 'r1', route: 'cd2-http', reason: 'cd2_hit', source: 'https://cdn.example.test/file?token=secret123'}
        }) + '\nnot-json\n', 'utf8');
        fs.writeFileSync(paths.file, [
            JSON.stringify({timestamp: '2026-09-16T00:00:01.000Z', level: 'info', category: 'cd2', event: 'resolve-hit', details: {requestId: 'r1', reason: 'cd2_hit', sourceKind: 'cd2-url'}}),
            JSON.stringify({timestamp: '2026-09-16T00:00:02.000Z', level: 'info', category: 'playback', event: 'core-playing', details: {requestId: 'r1'}})
        ].join('\n') + '\n', 'utf8');

        const report = await logger.exportReport({
            appVersion: '0.1.1',
            buildCommit: 'a'.repeat(40),
            platform: 'win32',
            arch: 'x64',
            electron: '18.3.15',
            chromium: '100',
            node: '16',
            deviceIdHash: diagnostics.hashIdentifier('device-raw')
        }, new Date('2026-09-16T00:00:03.000Z'));

        assert.match(report, /Last STRM Route: CD2 HTTP/);
        assert.match(report, /Last CD2 Result: HIT/);
        assert.match(report, /Last Mount Result: NOT REACHED/);
        assert.match(report, /Native Fallback: NO/);
        assert.match(report, /Playback Core Playing: YES/);
        assert.match(report, /Malformed JSONL lines omitted: 1/);
        assert.doesNotMatch(report, /secret123|cdn\.example\.test|token=secret123/);
        assert.match(report, /EmbyTheaterEnhanced-Diagnostics|Client Log|Diagnostic Report/);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('resolver results map to the four stable route names and mount telemetry contains only hashes', async () => {
    const direct = await resolveWith('direct');
    assert.equal(direct.result.sourceKind, 'direct-url');
    assert.equal(strmResolver.routeForResult(direct.result), 'direct-url');

    const cd2 = await resolveWith('cd2');
    assert.equal(cd2.result.sourceKind, 'cd2-url');
    assert.equal(strmResolver.routeForResult(cd2.result), 'cd2-http');

    const mount = await resolveWith('mount', {mount: true});
    assert.equal(mount.result.type, 'local');
    assert.equal(strmResolver.routeForResult(mount.result), 'mount');
    const mountHit = mount.events.find(event => event.category === 'mount' && event.event === 'resolve-hit');
    assert.ok(mountHit);
    assert.equal(typeof mountHit.details.mappedPathHash, 'string');
    assert.equal(mountHit.details.mappedPathHash.length, 16);
    assert.doesNotMatch(JSON.stringify(mountHit), /C:\\Source|Movie\.mkv|https:\/\//);

    const native = await resolveWith('native');
    assert.equal(native.result.type, 'native');
    assert.equal(strmResolver.routeForResult(native.result), 'native');
    assert.equal(native.result.source, baseContext().url);
});

test('CD2 telemetry records bounded result facts without candidates, source URLs or tokens', async () => {
    const events = [];
    const transport = {
        client: {
            waitForReady: (_deadline, callback) => callback(null),
            FindFileByPath: (request, _metadata, _options, callback) => callback(null, {
                fullPathName: request.path,
                size: '10',
                fileType: 'File',
                isDirectory: false
            }),
            GetDownloadUrlPath: (_request, _metadata, _options, callback) => callback(null, {
                downloadUrlPath: '/download/file'
            }),
            close() {}
        },
        metadata: {},
        status: {CANCELLED: 1, NOT_FOUND: 5, DEADLINE_EXCEEDED: 4, UNAVAILABLE: 14}
    };
    const service = cd2Service.createService({
        config: {
            enabled: true,
            origin: cd2Service.parseOrigin('http://127.0.0.1:19798'),
            token: 'secret123',
            localPrefix: 'X:\\Media',
            cloudPrefix: '/cloud/media',
            directUrlEnabled: false,
            totalBudgetMs: 100
        },
        transportFactory: () => transport,
        onDiagnostic: event => events.push(event)
    });
    try {
        const result = await service.resolve({requestId: 'cd2-observe', candidates: ['X:\\Media\\Movie.mkv']});
        assert.equal(result.status, 'hit');
        assert.deepEqual(events.map(event => event.event), ['resolve-start', 'resolve-hit']);
        assert.equal(events[0].details.candidateCount, 1);
        assert.equal(events[1].details.sourceKind, 'cd2-url');
        assert.equal(events[1].details.elapsedMs >= 0, true);
        assert.doesNotMatch(JSON.stringify(events), /Movie\.mkv|secret123|127\.0\.0\.1/);
    } finally {
        service.close();
    }
});

test('diagnostics IPC requires the trusted renderer and keeps export paths out of the response', async () => {
    const handlers = {};
    const trusted = {};
    const outputRoot = tempRoot('ete-client-ipc-');
    const exported = path.join(outputRoot, 'report.txt');
    let cleared = 0;
    const ipcMain = {
        handle(channel, handler) { handlers[channel] = handler; },
        removeHandler(channel) { delete handlers[channel]; }
    };
    const logger = {
        status: async () => ({enabled: true, logDirectory: diagnostics.DISPLAY_LOG_DIRECTORY, currentBytes: 12}),
        exportReport: async () => 'safe-report\n',
        getPaths: () => ({directory: path.join(outputRoot, 'logs')}),
        clear: async () => { cleared++; return true; }
    };
    const dialog = {showSaveDialog: async () => ({canceled: false, filePath: exported})};
    const shell = {openPath: async () => ''};
    try {
        diagnosticsIpc.register({
            ipcMain,
            logger,
            getWebContents: () => trusted,
            getBrowserWindow: () => ({}),
            app: {getPath: () => outputRoot},
            dialog,
            shell
        });
        assert.deepEqual(await handlers[diagnosticsIpc.CHANNELS.GET_STATUS]({sender: {}}), {status: 'error', reason: 'untrusted_sender'});
        assert.equal((await handlers[diagnosticsIpc.CHANNELS.GET_STATUS]({sender: trusted})).status, 'ok');
        assert.equal((await handlers[diagnosticsIpc.CHANNELS.EXPORT]({sender: trusted})).status, 'exported');
        assert.equal(fs.readFileSync(exported, 'utf8'), 'safe-report\n');
        assert.equal((await handlers[diagnosticsIpc.CHANNELS.CLEAR]({sender: trusted}, {})).reason, 'confirmation_required');
        assert.equal((await handlers[diagnosticsIpc.CHANNELS.CLEAR]({sender: trusted}, {confirmed: true})).status, 'cleared');
        assert.equal(cleared, 1);
    } finally {
        fs.rmSync(outputRoot, {recursive: true, force: true});
    }
});
