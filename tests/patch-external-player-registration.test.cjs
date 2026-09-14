'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {patchFile} = require('../tools/patch-external-player-registration.cjs');

function withFixture(content, callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ete-app-registration-'));
    const file = path.join(root, 'app.js');
    fs.writeFileSync(file, content, 'utf8');
    try {
        return callback(file);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
}

test('patches an active Electron External Player registration', () => {
    withFixture('return (responses.electron && list.push("modules/externalplayer/plugin"), list.push("confirm"));\n', file => {
        const result = patchFile(file);
        assert.equal(result.action, 'patched');
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /modules\/externalplayer\/plugin/);
    });
});
test('already-clean app.js is an idempotent no-op', () => {
    const content = 'return responses.electron && list.push("modules/youtubeplayer/plugin");\n';
    withFixture(content, file => {
        const result = patchFile(file);
        assert.equal(result.action, 'already-clean');
        assert.equal(fs.readFileSync(file, 'utf8'), content);
    });
});

test('preserves Android external-player branch while removing Electron registration', () => {
    const android = '"android" === self.appMode && list.push("native/android/externalplayer"),\n';
    const electron = 'responses.electron && list.push("modules/externalplayer/plugin"),\n';
    withFixture(android + electron + 'list.push("confirm");\n', file => {
        patchFile(file);
        const patched = fs.readFileSync(file, 'utf8');
        assert.match(patched, /native\/android\/externalplayer/);
        assert.doesNotMatch(patched, /modules\/externalplayer\/plugin/);
    });
});

test('fails closed on duplicate or malformed Electron registrations', () => {
    const duplicate = 'responses.electron && list.push("modules/externalplayer/plugin");\n' +
        'responses.electron && list.push("modules/externalplayer/plugin");\n';
    withFixture(duplicate, file => {
        assert.throws(() => patchFile(file), /Multiple Electron External Player registrations/);
        assert.equal(fs.readFileSync(file, 'utf8'), duplicate);
    });

    const malformed = 'responses.electron && list.push("modules/externalplayer/plugin", extra);\n';
    withFixture(malformed, file => {
        assert.throws(() => patchFile(file), /Unrecognized Electron External Player registration/);
        assert.equal(fs.readFileSync(file, 'utf8'), malformed);
    });
});
