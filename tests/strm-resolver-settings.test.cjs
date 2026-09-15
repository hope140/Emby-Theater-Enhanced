'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pathRules = require('../src/electronapp/resolvers/path-rules');
const strmResolver = require('../src/electronapp/resolvers/strm-resolver');
const configStore = require('../src/electronapp/enhanced/strm-config-store');
const configIpc = require('../src/electronapp/enhanced/strm-config-ipc');
const cd2Service = require('../src/electronapp/enhanced/cd2-service');

const libmpvSource = fs.readFileSync(path.join(__dirname, '../src/electronapp/plugins/libmpv.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '../src/electronapp/plugins/mpvplayer/strm.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(__dirname, '../src/electronapp/plugins/mpvplayer/strm.html'), 'utf8');

function temporaryRoot(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function baseRule(overrides) {
    return Object.assign({
        id: 'rule-main',
        sourcePrefix: '/media/115',
        mountPrefix: 'X:\\115',
        cloudPrefix: '/115',
        storageType: 'cloud-mount',
        strategy: 'cloud-first',
        order: ['direct-url', 'cd2-http', 'mount', 'native'],
        originState: 'USER',
        enabled: true
    }, overrides || {});
}

function baseConfig(rule, overrides) {
    return Object.assign({
        version: 1,
        enabled: true,
        cd2: {
            enabled: true,
            origin: 'http://127.0.0.1:19798',
            tokenConfigured: false,
            directUrlEnabled: true
        },
        rules: [baseRule(rule)]
    }, overrides || {});
}

function playbackContext(sourcePath) {
    return {
        item: {Path: 'C:\\Library\\Show\\Dune.mkv.strm', MediaType: 'Video', Type: 'Movie'},
        mediaSource: {Path: sourcePath, Container: 'strm', MediaStreams: []},
        url: 'https://emby.example.test/native',
        playMethod: 'DirectPlay'
    };
}

test('settings route and renderer avoid appSettings/localStorage for resolver configuration', () => {
    assert.match(libmpvSource, /path: 'mpvplayer\/strm\.html'/);
    assert.match(libmpvSource, /controller: pluginManager\.mapPath\(self, 'mpvplayer\/strm\.js'\)/);
    assert.match(libmpvSource, /category: 'Playback'/);
    assert.match(settingsHtml, /STRM 智能解析/);
    assert.match(settingsHtml, /CloudDrive2/);
    assert.match(settingsSource, /enhanced-strm-config-get/);
    assert.doesNotMatch(settingsSource, /localStorage/);
    assert.doesNotMatch(settingsSource, /appSettings/);
    assert.match(settingsSource, /textContent/);
});

test('path rules enforce boundary and path-style case semantics', () => {
    assert.equal(pathRules.prefixMatches('X:\\MEDIA\\Movies\\Dune.mkv', 'x:\\media'), true);
    assert.equal(pathRules.prefixMatches('X:\\Media2\\Dune.mkv', 'X:\\Media'), false);
    assert.equal(pathRules.prefixMatches('\\\\NAS\\Media\\Movie.mkv', '\\\\nas\\media'), true);
    assert.equal(pathRules.prefixMatches('/media/nas/Movies/Dune.mkv', '/media/nas'), true);
    assert.equal(pathRules.prefixMatches('/media/NAS/Movies/Dune.mkv', '/media/nas'), false);
    assert.equal(pathRules.prefixMatches('/media/nas0/Dune.mkv', '/media/nas'), false);
    assert.equal(pathRules.replacePrefix('/media/nas/Movies/Dune.mkv', '/media/nas', '\\\\NAS\\Media'), '\\\\NAS\\Media\\Movies\\Dune.mkv');
    assert.equal(pathRules.replacePrefix('/media/nas/../secret.mkv', '/media/nas', 'X:\\Media'), null);
    assert.equal(pathRules.normalizeWindows('X:folder'), null);
});

test('persistent config stores rules and token separately without returning token', () => {
    const root = temporaryRoot('ete-strm-config-');
    const store = configStore.createStore({rootDir: root, environment: {}});
    const input = store.getPublicConfig();
    input.rules = [baseRule()];

    const saved = store.save(input);
    store.setToken('Bearer test-secret-value');
    const publicText = JSON.stringify(store.getPublicConfig());
    const paths = store.getConfigPaths();

    assert.equal(saved.rules[0].originState, 'USER');
    assert.equal(store.getPublicConfig().cd2.tokenConfigured, true);
    assert.doesNotMatch(publicText, /test-secret-value/);
    assert.doesNotMatch(JSON.stringify(saved), /test-secret-value/);
    assert.match(fs.readFileSync(paths.secretsPath, 'utf8'), /test-secret-value/);
    assert.equal(JSON.parse(fs.readFileSync(paths.configPath, 'utf8')).cd2.tokenConfigured, undefined);

    const restarted = configStore.createStore({rootDir: root, environment: {ETE_CD2_TOKEN: 'other-value'}});
    assert.equal(restarted.getPublicConfig().cd2.tokenConfigured, true);
    assert.deepEqual(restarted.getPublicConfig().rules, store.getPublicConfig().rules);
});

test('legacy environment bootstraps one AUTO rule once and persistent config wins on restart', () => {
    const root = temporaryRoot('ete-strm-legacy-');
    const legacy = {
        ETE_CD2_ENABLED: '1',
        ETE_CD2_ORIGIN: 'http://127.0.0.1:19798',
        ETE_CD2_TOKEN: 'legacy-token',
        ETE_CD2_LOCAL_PREFIX: 'X:\\115',
        ETE_CD2_CLOUD_PREFIX: '/115',
        ETE_CD2_DIRECT_URL: '0'
    };
    const first = configStore.createStore({rootDir: root, environment: legacy});
    const firstConfig = first.getPublicConfig();

    assert.equal(firstConfig.enabled, true);
    assert.equal(firstConfig.cd2.enabled, true);
    assert.equal(firstConfig.cd2.directUrlEnabled, false);
    assert.equal(firstConfig.cd2.tokenConfigured, true);
    assert.equal(firstConfig.rules.length, 1);
    assert.equal(firstConfig.rules[0].originState, 'AUTO');
    assert.equal(firstConfig.rules[0].sourcePrefix, 'X:\\115');
    assert.equal(firstConfig.rules[0].mountPrefix, 'X:\\115');

    const second = configStore.createStore({
        rootDir: root,
        environment: Object.assign({}, legacy, {ETE_CD2_DIRECT_URL: '1', ETE_CD2_LOCAL_PREFIX: 'Y:\\changed'})
    });
    assert.deepEqual(second.getPublicConfig(), firstConfig);
});

test('legacy CD2 disabled keeps STRM resolver enabled and reaches Mount', async () => {
    const root = temporaryRoot('ete-strm-legacy-disabled-');
    const store = configStore.createStore({
        rootDir: root,
        environment: {
            ETE_CD2_ENABLED: '0',
            ETE_CD2_ORIGIN: 'http://127.0.0.1:19798',
            ETE_CD2_SOURCE_PREFIX: '/media/115',
            ETE_CD2_MOUNT_PREFIX: 'X:\\115',
            ETE_CD2_CLOUD_PREFIX: '/115'
        }
    });
    const config = store.getPublicConfig();
    const service = cd2Service.createService({config: store.getRuntimeConfig()});

    assert.equal(config.enabled, true);
    assert.equal(config.cd2.enabled, false);
    assert.equal(service.configState(), 'disabled');

    try {
        const result = await strmResolver.resolveAsync(playbackContext('/media/115/Movies/Dune.mkv'), {
            config: config,
            fs: {existsSync: value => value === 'X:\\115\\Movies\\Dune.mkv'},
            requestId: 'legacy-cd2-disabled',
            cd2Transport: {
                resolve: request => service.resolve(request),
                cancel: requestId => service.cancel(requestId)
            }
        });

        assert.equal(result.type, 'local');
        assert.equal(result.source, 'X:\\115\\Movies\\Dune.mkv');
        assert.equal(result.reason, 'mount_hit');
        assert.notEqual(result.reason, 'resolver_disabled');
    } finally {
        service.close();
    }
});

test('config validation rejects traversal and incomplete custom order', () => {
    assert.throws(() => configStore.normalizeConfig({
        version: 1,
        cd2: {origin: 'http://127.0.0.1:19798'},
        rules: [baseRule({sourcePrefix: '/media/../secret'})]
    }), /invalid_source_prefix/);
    assert.throws(() => configStore.normalizeConfig({
        version: 1,
        cd2: {origin: 'http://127.0.0.1:19798'},
        rules: [baseRule({cloudPrefix: '/cloud/../secret'})]
    }), /invalid_cloud_prefix/);
    assert.throws(() => configStore.normalizeConfig({
        version: 1,
        cd2: {origin: 'http://127.0.0.1:19798'},
        rules: [baseRule({strategy: 'custom', order: ['mount', 'native', 'native', 'direct-url']})]
    }), /invalid_strategy_order/);
    assert.throws(() => configStore.normalizeConfig({
        version: 1,
        cd2: {origin: 'http://127.0.0.1:19798'},
        rules: [baseRule({storageType: 'provider-framework'})]
    }), /invalid_storage_type/);
});

test('AUTO discovery can update AUTO but never overwrites USER', () => {
    const root = temporaryRoot('ete-strm-auto-');
    const store = configStore.createStore({rootDir: root, environment: {}});
    store.applyDiscovery([baseRule({originState: 'AUTO'})]);

    let result = store.applyDiscovery([baseRule({mountPrefix: 'Y:\\115', originState: 'AUTO'})]);
    assert.equal(result.rules[0].mountPrefix, 'Y:\\115');
    assert.equal(result.rules[0].originState, 'AUTO');

    result = store.save(Object.assign(result, {
        rules: [baseRule({mountPrefix: 'Z:\\115', originState: 'AUTO'})]
    }));
    assert.equal(result.rules[0].mountPrefix, 'Z:\\115');
    assert.equal(result.rules[0].originState, 'USER');

    result = store.applyDiscovery([baseRule({mountPrefix: 'Q:\\115', originState: 'AUTO'})]);
    assert.equal(result.rules[0].mountPrefix, 'Z:\\115');
    assert.equal(result.rules[0].originState, 'USER');
});

test('DISABLED rule suppresses the same automatic mapping until explicitly restored', () => {
    const root = temporaryRoot('ete-strm-disabled-');
    const store = configStore.createStore({rootDir: root, environment: {}});
    store.applyDiscovery([baseRule({originState: 'AUTO'})]);

    let result = store.disableRule('rule-main');
    assert.equal(result.rules[0].originState, 'DISABLED');
    assert.equal(result.rules[0].enabled, false);

    result = store.applyDiscovery([baseRule({originState: 'AUTO'})]);
    assert.equal(result.rules.length, 1);
    assert.equal(result.rules[0].originState, 'DISABLED');
    assert.equal(result.rules[0].enabled, false);

    result = store.restoreAutoRule('rule-main');
    assert.equal(result.rules[0].originState, 'AUTO');
    assert.equal(result.rules[0].enabled, true);
});

test('longest prefix matching selects the most specific enabled rule', () => {
    const config = baseConfig(null, {
        rules: [
            baseRule({id: 'parent', sourcePrefix: '/media/115'}),
            baseRule({id: 'child', sourcePrefix: '/media/115/Movies/4K', mountPrefix: 'Y:\\4K'})
        ]
    });
    const selected = strmResolver.selectRule({
        sourcePath: '/media/115/Movies/4K/Dune.mkv',
        sidecarPath: '/media/115/Movies/4K/Dune.mkv.strm'
    }, config);
    assert.equal(selected.id, 'child');
    assert.equal(strmResolver.selectRule({
        sourcePath: '/media/1150/Dune.mkv',
        sidecarPath: '/media/1150/Dune.mkv.strm'
    }, config), null);
});

test('sourcePath identity wins over a longer sidecar rule', () => {
    const config = baseConfig(null, {
        rules: [
            baseRule({id: 'source-rule', sourcePrefix: '/media/115'}),
            baseRule({id: 'sidecar-rule', sourcePrefix: 'C:\\Library\\4K'})
        ]
    });
    const selected = strmResolver.selectRule({
        sourcePath: '/media/115/Movies/Dune.mkv',
        sidecarPath: 'C:\\Library\\4K\\Dune.mkv.strm'
    }, config);
    assert.equal(selected.id, 'source-rule');
});

test('valid absolute sourcePath with no match does not fall back to sidecar identity', () => {
    const config = baseConfig(null, {
        rules: [baseRule({id: 'sidecar-rule', sourcePrefix: 'C:\\Library\\4K'})]
    });
    assert.equal(strmResolver.selectRule({
        sourcePath: '/other/storage/Dune.mkv',
        sidecarPath: 'C:\\Library\\4K\\Dune.mkv.strm'
    }, config), null);
});

test('HTTP sourcePath permits sidecar identity fallback', () => {
    const config = baseConfig(null, {
        rules: [baseRule({id: 'sidecar-rule', sourcePrefix: 'C:\\Library\\Show'})]
    });
    const selected = strmResolver.selectRule({
        sourcePath: 'https://emby.example.test/videos/dune',
        sidecarPath: 'C:\\Library\\Show\\Dune.mkv.strm'
    }, config);
    assert.equal(selected.id, 'sidecar-rule');
});

test('cloud-first uses DirectUrl before the other configured stages', async () => {
    const calls = [];
    const result = await strmResolver.resolveAsync(playbackContext('/media/115/Movies/Dune.mkv'), {
        fs: {existsSync: () => false},
        requestId: 'cloud-first-test',
        config: baseConfig(),
        cd2Transport: {
            resolve: async request => {
                calls.push(request.mode);
                return {
                    status: 'hit',
                    type: 'url',
                    source: 'https://cdn.example.test/dune',
                    sourceKind: 'direct-url',
                    requestOptions: {userAgent: 'safe-agent'}
                };
            }
        }
    });
    assert.equal(result.type, 'url');
    assert.equal(result.sourceKind, 'direct-url');
    assert.deepEqual(calls, ['direct']);
});

test('mount-first returns deterministic mapped Mount before CD2', async () => {
    const calls = [];
    const result = await strmResolver.resolveAsync(playbackContext('/media/115/Movies/Dune.mkv'), {
        fs: {
            existsSync: value => {
                calls.push(value);
                return value === 'X:\\115\\Movies\\Dune.mkv';
            }
        },
        requestId: 'mount-first-test',
        config: baseConfig({strategy: 'mount-first', order: ['mount', 'direct-url', 'cd2-http', 'native']}),
        cd2Transport: {resolve: async () => { throw new Error('CD2 must not run'); }}
    });
    assert.equal(result.type, 'local');
    assert.equal(result.source, 'X:\\115\\Movies\\Dune.mkv');
    assert.deepEqual(calls, ['X:\\115\\Movies\\Dune.mkv']);
});

test('custom order can place same-origin CD2 after a DirectUrl miss', async () => {
    const modes = [];
    const result = await strmResolver.resolveAsync(playbackContext('/media/115/Movies/Dune.mkv'), {
        fs: {existsSync: () => false},
        requestId: 'custom-order-test',
        config: baseConfig({
            strategy: 'custom',
            order: ['mount', 'direct-url', 'cd2-http', 'native']
        }),
        cd2Transport: {
            resolve: async request => {
                modes.push(request.mode);
                return request.mode === 'direct'
                    ? {status: 'miss', reason: 'unsupported_user_agent'}
                    : {status: 'hit', type: 'url', source: 'http://127.0.0.1:19798/fallback', sourceKind: 'cd2-url'};
            }
        }
    });
    assert.equal(result.sourceKind, 'cd2-url');
    assert.deepEqual(modes, ['direct', 'same-origin']);
});

test('configured resolver falls back to Native after every stage misses', async () => {
    const modes = [];
    const context = playbackContext('/media/115/Movies/Dune.mkv');
    const result = await strmResolver.resolveAsync(context, {
        fs: {existsSync: () => false},
        requestId: 'native-fallback-test',
        config: baseConfig(),
        cd2Transport: {
            resolve: async request => {
                modes.push(request.mode);
                return {status: 'miss', reason: 'unavailable'};
            }
        }
    });
    assert.equal(result.type, 'native');
    assert.equal(result.source, context.url);
    assert.equal(result.fallback, true);
    assert.deepEqual(modes, ['direct', 'same-origin']);
});

test('configured resolver propagates Abort and does not enter Mount fallback', async () => {
    const controller = new AbortController();
    let cancelled = false;
    let release;
    const pending = strmResolver.resolveAsync(playbackContext('/media/115/Movies/Dune.mkv'), {
        fs: {existsSync: () => { throw new Error('Mount must not run'); }},
        requestId: 'abort-configured-test',
        signal: controller.signal,
        config: baseConfig(),
        cd2Transport: {
            resolve: () => new Promise(resolve => { release = resolve; }),
            cancel: () => {
                cancelled = true;
                release({status: 'cancelled', reason: 'cancelled'});
            }
        }
    });
    controller.abort();
    await assert.rejects(pending, error => error && error.name === 'AbortError');
    assert.equal(cancelled, true);
});

test('CD2 direct and same-origin modes share the found file within one request', async () => {
    const calls = [];
    const transport = {
        client: {
            waitForReady(_deadline, callback) {
                calls.push('waitForReady');
                callback(null);
            },
            FindFileByPath(request, _metadata, _options, callback) {
                calls.push('FindFileByPath');
                callback(null, {fullPathName: request.path, size: '1', fileType: 'File'});
                return {cancel() {}};
            },
            GetDownloadUrlPath(request, _metadata, _options, callback) {
                calls.push(request.get_direct_url ? 'direct' : 'same-origin');
                callback(null, request.get_direct_url
                    ? {directUrl: 'https://cdn.example.test/file', userAgent: 'bad,ua'}
                    : {downloadUrlPath: '/fallback/file'});
                return {cancel() {}};
            },
            close() {}
        },
        metadata: {},
        status: {CANCELLED: 1, NOT_FOUND: 5, DEADLINE_EXCEEDED: 4, UNAVAILABLE: 14}
    };
    const service = cd2Service.createService({
        config: {
            enabled: true,
            origin: cd2Service.parseOrigin('http://127.0.0.1:19798'),
            token: 'test-token',
            directUrlEnabled: true,
            totalBudgetMs: 100,
            rules: [baseRule()]
        },
        transportFactory: () => transport
    });
    const deadlineAt = Date.now() + 100;
    const direct = await service.resolve({
        requestId: 'mode-test',
        ruleId: 'rule-main',
        mode: 'direct',
        deadlineAt,
        candidates: ['/media/115/Movies/Dune.mkv']
    });
    const sameOrigin = await service.resolve({
        requestId: 'mode-test',
        ruleId: 'rule-main',
        mode: 'same-origin',
        deadlineAt,
        candidates: ['/media/115/Movies/Dune.mkv']
    });
    service.close();

    assert.equal(direct.reason, 'unsupported_user_agent');
    assert.equal(sameOrigin.sourceKind, 'cd2-url');
    assert.deepEqual(calls, ['waitForReady', 'FindFileByPath', 'direct', 'same-origin']);
});

test('an expired shared CD2 deadline cannot allocate a fresh mode budget', async () => {
    const calls = [];
    const service = cd2Service.createService({
        config: {
            enabled: true,
            origin: cd2Service.parseOrigin('http://127.0.0.1:19798'),
            token: 'test-token',
            directUrlEnabled: true,
            totalBudgetMs: 100,
            rules: [baseRule()]
        },
        transportFactory: () => ({
            client: {
                waitForReady() { calls.push('waitForReady'); },
                close() {}
            },
            metadata: {},
            status: {}
        })
    });
    const response = await service.resolve({
        requestId: 'expired-mode',
        ruleId: 'rule-main',
        mode: 'same-origin',
        deadlineAt: Date.now() - 1,
        candidates: ['/media/115/Movies/Dune.mkv']
    });
    service.close();
    assert.equal(response.reason, 'timeout');
    assert.deepEqual(calls, []);
});

test('CD2 connection test performs a bounded authenticated read-only probe', async () => {
    const calls = [];
    const service = cd2Service.createService({
        config: {
            enabled: true,
            origin: cd2Service.parseOrigin('http://127.0.0.1:19798'),
            token: 'test-token',
            directUrlEnabled: true,
            totalBudgetMs: 100,
            rules: []
        },
        transportFactory: () => ({
            client: {
                waitForReady(_deadline, callback) {
                    calls.push('waitForReady');
                    callback(null);
                },
                FindFileByPath(request, _metadata, _options, callback) {
                    calls.push(request.path);
                    callback(null, {fullPathName: '/', size: '0', fileType: 'Directory'});
                    return {cancel() {}};
                },
                close() {}
            },
            metadata: {},
            status: {UNAUTHENTICATED: 16, PERMISSION_DENIED: 7, NOT_FOUND: 5}
        })
    });
    assert.deepEqual(await service.testConnection(), {status: 'ok', reason: 'connected'});
    service.close();
    assert.deepEqual(calls, ['waitForReady', '/']);
});

test('config IPC trusts only the active renderer and never returns a secret', async () => {
    const root = temporaryRoot('ete-strm-ipc-');
    const store = configStore.createStore({rootDir: root, environment: {}});
    const handlers = {};
    const ipcMain = {
        handle(name, handler) { handlers[name] = handler; },
        removeHandler(name) { delete handlers[name]; }
    };
    const trusted = {};
    const unregister = configIpc.register({
        ipcMain,
        store,
        getWebContents: () => trusted,
        createTestService: () => ({
            async testConnection() { return {status: 'ok', reason: 'connected'}; },
            close() {}
        })
    });

    const rejected = await handlers[configIpc.CHANNELS.GET]({sender: {}});
    assert.equal(rejected.reason, 'untrusted_sender');
    await handlers[configIpc.CHANNELS.SET_TOKEN]({sender: trusted}, {token: 'ipc-secret-value'});
    const publicConfig = await handlers[configIpc.CHANNELS.GET]({sender: trusted});
    assert.equal(publicConfig.cd2.tokenConfigured, true);
    assert.doesNotMatch(JSON.stringify(publicConfig), /ipc-secret-value/);
    assert.deepEqual(await handlers[configIpc.CHANNELS.TEST_CONNECTION]({sender: trusted}), {
        status: 'ok',
        reason: 'connected'
    });
    unregister();
    assert.equal(handlers[configIpc.CHANNELS.GET], undefined);
});
