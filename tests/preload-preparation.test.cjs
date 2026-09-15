'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preparation = require('../tools/prepare-preload.cjs');

const vendorPreload = "const { ipcRenderer } = require('electron');\r\nwindow.ipc = ipcRenderer;\r\nconst fs = require('fs');\r\nwindow.fs = fs;\r\nconst os = require('os');\r\nwindow.dirName = os.tmpdir();\r\nwindow.appdata = process.env.APPDATA;\r\n";

test('prepared preload is deterministic, sticky and based only on vendor input', () => {
    const prepared = preparation.buildPreparedPreload(vendorPreload);
    assert.match(prepared, /window\.ipc = ipcRenderer/);
    assert.match(prepared, new RegExp(preparation.PREPARED_PRELOAD_MARKER));
    assert.match(prepared, /window\.__etePepperReadiness/);
    assert.match(prepared, /window\.__eteDiagnosticHash/);
    assert.match(prepared, /function beginRun/);
    assert.match(prepared, /diagnostics\.collect/);
    assert.equal(prepared, preparation.buildPreparedPreload(vendorPreload));
    assert.equal(prepared.includes('E:\\Emby Theater Enhanced'), false);
});

test('prepare writes and reuses the same generated artifact without external files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ete-preload-'));
    try {
        const vendorPath = path.join(root, preparation.BASE_PRELOAD_PATH);
        fs.mkdirSync(path.dirname(vendorPath), {recursive: true});
        fs.writeFileSync(vendorPath, vendorPreload, 'utf8');

        const first = preparation.prepare(root);
        const target = path.join(root, preparation.PREPARED_PRELOAD_PATH);
        assert.equal(first.status, 'passed');
        assert.equal(first.changed, true);
        assert.equal(fs.readFileSync(target, 'utf8'), preparation.buildPreparedPreload(vendorPreload));

        const second = preparation.prepare(root);
        assert.equal(second.changed, false);
        assert.equal(second.preparedSha256, first.preparedSha256);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});
