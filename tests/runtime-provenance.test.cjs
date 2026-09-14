'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const tool = path.join(repoRoot, 'tools', 'runtime-provenance.cjs');
const sourceCommit = '0123456789abcdef0123456789abcdef01234567';

function writeFile(file, content) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content, 'utf8');
}

function createFixture(root) {
    writeFile(path.join(root, 'vendor', 'runtime-manifest.json'), JSON.stringify({
        baseline: 'provenance-test-fixture',
        files: [],
        patchFiles: []
    }));
    writeFile(path.join(root, 'src', 'electronapp', 'some-normal-file.js'), 'module.exports = "normal";\n');
    writeFile(path.join(root, 'tools', 'Start-Enhanced.ps1'), 'param()\n');
    writeFile(path.join(root, 'tools', 'Start-Enhanced.cmd'), '@echo off\r\n');
}

function createRuntime(root, name) {
    const runtime = path.join(root, name);
    writeFile(path.join(runtime, 'electronapp', 'some-normal-file.js'), 'module.exports = "normal";\n');
    writeFile(path.join(runtime, 'Start-Enhanced.ps1'), 'param()\n');
    writeFile(path.join(runtime, 'Start-Enhanced.cmd'), '@echo off\r\n');
    return runtime;
}

function runProvenance(command, root, runtime) {
    const result = childProcess.spawnSync(process.execPath, [tool, command, root, runtime, sourceCommit], {
        encoding: 'utf8'
    });
    assert.equal(result.error, undefined, result.error && result.error.message);
    return {exitCode: result.status, report: JSON.parse(result.stdout)};
}

test('runtime provenance excludes the exact legacy subtree without weakening normal coverage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ete-provenance-'));
    try {
        createFixture(root);
        const legacySentinel = path.join(root, 'src', 'electronapp', 'www', 'modules', 'externalplayer', '__sentinel.js');
        writeFile(legacySentinel, 'module.exports = "legacy";\n');

        const runtimeWithLegacySource = createRuntime(root, 'runtime-with-legacy-source');
        const writtenWithLegacySource = runProvenance('write', root, runtimeWithLegacySource);
        assert.equal(writtenWithLegacySource.exitCode, 0);
        const manifestWithLegacySource = JSON.parse(fs.readFileSync(
            path.join(runtimeWithLegacySource, 'runtime-provenance.json'), 'utf8'
        ));
        const scopeWithLegacySource = manifestWithLegacySource.validatedProductScope;
        assert.deepEqual(scopeWithLegacySource.excludedSourcePrefixes, [
            'src/electronapp/www/modules/externalplayer/'
        ]);
        assert.equal(scopeWithLegacySource.files.some(entry => entry.sourcePath ===
            'src/electronapp/www/modules/externalplayer/__sentinel.js'), false);
        assert.equal(runProvenance('validate', root, runtimeWithLegacySource).exitCode, 0);

        fs.rmSync(path.dirname(legacySentinel), {recursive: true, force: true});
        const runtimeWithoutLegacySource = createRuntime(root, 'runtime-without-legacy-source');
        const writtenWithoutLegacySource = runProvenance('write', root, runtimeWithoutLegacySource);
        assert.equal(writtenWithoutLegacySource.exitCode, 0);
        const manifestWithoutLegacySource = JSON.parse(fs.readFileSync(
            path.join(runtimeWithoutLegacySource, 'runtime-provenance.json'), 'utf8'
        ));
        assert.deepEqual(
            manifestWithoutLegacySource.validatedProductScope.files.map(entry => entry.sourcePath),
            scopeWithLegacySource.files.map(entry => entry.sourcePath)
        );
        assert.equal(runProvenance('validate', root, runtimeWithoutLegacySource).exitCode, 0);

        fs.rmSync(path.join(runtimeWithoutLegacySource, 'electronapp', 'some-normal-file.js'));
        const normalMismatch = runProvenance('validate', root, runtimeWithoutLegacySource);
        assert.equal(normalMismatch.exitCode, 1);
        assert.equal(normalMismatch.report.status, 'failed');
        assert.equal(normalMismatch.report.errors.includes(
            'runtime-file-missing:electronapp/some-normal-file.js'
        ), true);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

