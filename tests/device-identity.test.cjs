'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const identity = require('../src/electronapp/device-identity');

function withTempDirectory(callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ete-device-identity-'));
    try { return callback(root); } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

function identityFile(root) {
    return path.join(root, 'config', 'device-identity.json');
}

test('first run generates and atomically persists a valid UUID', () => {
    withTempDirectory(root => {
        const file = identityFile(root);
        const value = identity.getOrCreateDeviceId(file);
        assert.equal(identity.isValidDeviceId(value), true);
        assert.equal(value, JSON.parse(fs.readFileSync(file, 'utf8')).deviceId);
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
        assert.equal(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp')).length, 0);
    });
});

test('same profile returns the same device id across runs', () => {
    withTempDirectory(root => {
        const file = identityFile(root);
        const first = identity.getOrCreateDeviceId(file);
        const second = identity.getOrCreateDeviceId(file);
        assert.equal(second, first);
    });
});

test('clean profiles receive different device ids', () => {
    withTempDirectory(root => {
        const first = identity.getOrCreateDeviceId(identityFile(path.join(root, 'one')));
        const second = identity.getOrCreateDeviceId(identityFile(path.join(root, 'two')));
        assert.notEqual(second, first);
    });
});

test('device id is independent from the hostname and device name remains hostname', () => {
    withTempDirectory(root => {
        const value = identity.getOrCreateDeviceId(identityFile(root));
        assert.notEqual(value, os.hostname());
    });
    const main = fs.readFileSync(path.join(repoRoot, 'src/electronapp/main.js'), 'utf8');
    assert.match(main, /deviceName:\s*os\.hostname\(\)/);
    assert.match(main, /deviceId:\s*persistentDeviceId/);
    assert.doesNotMatch(main, /deviceId:\s*os\.hostname\(\)/);
});

test('missing and corrupt identity files regenerate safely', () => {
    withTempDirectory(root => {
        const file = identityFile(root);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, '{"version":1,"deviceId":"not-a-uuid"}\n', 'utf8');
        const value = identity.getOrCreateDeviceId(file);
        assert.equal(identity.isValidDeviceId(value), true);
        assert.equal(identity.readDeviceId(file), value);
    });
});

test('randomBytes fallback creates a UUID v4 without a machine-specific value', () => {
    const bytes = Buffer.alloc(16, 0);
    const value = identity.generateDeviceId({randomBytes: () => Buffer.from(bytes)});
    assert.equal(identity.isValidDeviceId(value), true);
    assert.equal(value[14], '4');
    assert.match(value[19], /[89ab]/i);
});

test('startup resolves the persistent id before loadStartInfo and does not add app identity logic', () => {
    const mainPath = path.join(repoRoot, 'src/electronapp/main.js');
    const main = fs.readFileSync(mainPath, 'utf8');
    const identityCall = main.indexOf('deviceIdentity.getOrCreateDeviceId(');
    assert.ok(identityCall >= 0, 'startup must resolve a persistent device id');
    assert.ok(identityCall < main.indexOf('function loadStartInfo()'), 'device id must precede loadStartInfo');
    assert.ok(identityCall < main.indexOf("app.on('ready'"), 'device id must precede the ready handler');
    assert.match(main, /appBootstrapState\.configDirectory/);
    assert.doesNotMatch(main, /app\.setName\(/, 'this branch must not carry the product-session-identity fix');
});

test('HTTP and WebSocket identity chains consume the same appStartInfo device id', () => {
    const appHost = fs.readFileSync(path.join(repoRoot, 'src/electronapp/apphost.js'), 'utf8');
    assert.match(appHost, /deviceId:\s*function\s*\(\)\s*\{[\s\S]*?return appStartInfo\.deviceId;/);

    const webRoot = path.join(repoRoot, 'src/electronapp/www');
    const vendorRoot = path.join(repoRoot, 'vendor/carnival/electronapp/www');
    const readRuntimeFile = relative => {
        for (const root of [webRoot, vendorRoot]) {
            const file = path.join(root, relative);
            if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
        }
        throw new Error('Prepared runtime input is required for identity-chain test: ' + relative);
    };
    const app = readRuntimeFile('app.js');
    const connectionManager = readRuntimeFile('modules/emby-apiclient/connectionmanager.js');
    const apiClient = readRuntimeFile('modules/emby-apiclient/apiclient.js');
    assert.match(app, /apphost\.deviceId\(\)/);
    assert.match(connectionManager, /deviceId:\s*this\.deviceId\(\)/);
    assert.match(apiClient, /deviceId="\.concat\(this\.deviceId\(\)\)/);
});

test('identity helper has no token, user, server, or hostname dependency', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src/electronapp/device-identity.js'), 'utf8');
    assert.doesNotMatch(source, /hostname|token|server|userId|appName|appVersion/i);
    assert.match(source, /randomUUID|randomBytes/);
});
