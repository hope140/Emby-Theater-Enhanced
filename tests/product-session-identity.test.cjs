'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const productIdentity = require('../src/electronapp/product-identity');

function fakeApp() {
    const calls = [];
    return {
        calls,
        setName(value) {
            calls.push(value);
        }
    };
}

test('product identity prefers runtime productName', () => {
    const app = fakeApp();
    assert.equal(productIdentity.setAppName(app, {
        name: 'emby-theater-enhanced',
        productName: 'Emby Theater Enhanced'
    }), 'Emby Theater Enhanced');
    assert.deepEqual(app.calls, ['Emby Theater Enhanced']);
});

test('product identity falls back to runtime name', () => {
    const app = fakeApp();
    assert.equal(productIdentity.setAppName(app, {
        name: 'fallback-product'
    }), 'fallback-product');
    assert.deepEqual(app.calls, ['fallback-product']);
    assert.equal(productIdentity.getAppName({name: 'fallback-product', productName: ''}), 'fallback-product');
});

test('product startup and acceptance use the same runtime identity helper before product startup', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const main = fs.readFileSync(path.join(repoRoot, 'src/electronapp/main.js'), 'utf8');
    const acceptance = fs.readFileSync(path.join(repoRoot, 'tools/acceptance-electron.cjs'), 'utf8');
    const identityCall = main.indexOf('productIdentity.setAppName(app, productMetadata);');

    assert.match(main, /require\('\.\/package\.json'\)/);
    assert.match(main, /require\('\.\/product-identity'\)/);
    assert.ok(identityCall >= 0, 'product startup must set the runtime identity');
    assert.ok(identityCall < main.indexOf('appBootstrap.bootstrap('), 'identity must be set before bootstrap');
    assert.ok(identityCall < main.indexOf('function loadStartInfo()'), 'identity must be set before loadStartInfo');
    assert.match(main, /name: app\.name/);
    assert.match(main, /version: app\.getVersion\(\)/);
    assert.match(main, /deviceName: os\.hostname\(\)/);
    assert.match(main, /deviceId: os\.hostname\(\)/);
    assert.doesNotMatch(main, /app\.setName\(['"]Emby Theater Enhanced['"]\)/);

    assert.match(acceptance, /require\(path\.join\(runtime,'electronapp\/product-identity\.js'\)\)/);
    assert.match(acceptance, /productIdentity\.setAppName\(app, metadata\)/);
    assert.doesNotMatch(acceptance, /app\.setName\(metadata\.productName \|\| metadata\.name\)/);
});
