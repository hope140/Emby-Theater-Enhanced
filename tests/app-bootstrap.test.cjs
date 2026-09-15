'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bootstrap = require('../src/electronapp/enhanced/bootstrap');

function makeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ete-bootstrap-'));
    const runtimeRoot = path.join(root, 'runtime');
    const appDataPath = path.join(root, 'appdata');
    const seedPath = path.join(runtimeRoot, 'config', 'system.xml');
    fs.mkdirSync(path.dirname(seedPath), {recursive: true});
    fs.writeFileSync(seedPath, 'seed-system-config\n', 'utf8');
    return {root, runtimeRoot, appDataPath, seedPath, profileRoot: path.join(appDataPath, 'EmbyTheaterEnhanced')};
}

test('bootstrap creates profile directories and seeds missing files from packaged runtime root', () => {
    const fixture = makeFixture();
    try {
        const result = bootstrap.bootstrap({appDataPath: fixture.appDataPath, runtimeRoot: fixture.runtimeRoot});
        assert.equal(result.seedPath, fixture.seedPath);
        assert.equal(bootstrap.resolveSeedPath(fixture.runtimeRoot), fixture.seedPath);
        assert.equal(fs.existsSync(path.join(fixture.profileRoot, 'config')), true);
        assert.equal(fs.existsSync(path.join(fixture.profileRoot, 'cec-driver')), true);
        assert.equal(fs.readFileSync(path.join(fixture.profileRoot, 'config', 'system.xml'), 'utf8'), 'seed-system-config\n');
        assert.equal(fs.readFileSync(path.join(fixture.profileRoot, 'cec-driver', 'cancel'), 'utf8'), '');
    } finally {
        fs.rmSync(fixture.root, {recursive: true, force: true});
    }
});

test('bootstrap is idempotent and preserves existing user files', () => {
    const fixture = makeFixture();
    try {
        const first = bootstrap.bootstrap({appDataPath: fixture.appDataPath, runtimeRoot: fixture.runtimeRoot});
        fs.writeFileSync(first.systemConfig, 'user-system-config\n', 'utf8');
        fs.writeFileSync(first.cancelFile, 'user-cancel-marker\n', 'utf8');
        fs.writeFileSync(path.join(first.configDirectory, 'user-settings.json'), '{"keep":true}\n', 'utf8');

        const second = bootstrap.bootstrap({appDataPath: fixture.appDataPath, runtimeRoot: fixture.runtimeRoot});
        assert.equal(second.systemConfig, first.systemConfig);
        assert.equal(fs.readFileSync(first.systemConfig, 'utf8'), 'user-system-config\n');
        assert.equal(fs.readFileSync(first.cancelFile, 'utf8'), 'user-cancel-marker\n');
        assert.equal(fs.readFileSync(path.join(first.configDirectory, 'user-settings.json'), 'utf8'), '{"keep":true}\n');
    } finally {
        fs.rmSync(fixture.root, {recursive: true, force: true});
    }
});

test('installer and build inputs use the executable directly and exclude legacy launchers from runtime', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const installer = fs.readFileSync(path.join(repoRoot, 'installer', 'EmbyTheaterEnhanced.iss'), 'utf8');
    const build = fs.readFileSync(path.join(repoRoot, 'tools', 'build.ps1'), 'utf8');
    const provenance = fs.readFileSync(path.join(repoRoot, 'tools', 'runtime-provenance.cjs'), 'utf8');
    const installerEntries = installer.split(/\r?\n/).filter(line => /^Name:|^Filename:/.test(line));

    assert.match(installer, /Name: "\{group\}\\Emby Theater Enhanced"; Filename: "\{app\}\\Emby\.Theater\.exe";/);
    assert.match(installer, /Name: "\{autodesktop\}\\Emby Theater Enhanced"; Filename: "\{app\}\\Emby\.Theater\.exe";/);
    assert.match(installer, /Filename: "\{app\}\\Emby\.Theater\.exe"; WorkingDir: "\{app\}"; Description: "Launch Emby Theater Enhanced"/);
    assert.doesNotMatch(installer, /powershell\.exe|cmd\.exe|Start-Enhanced\.(ps1|cmd)/i);
    assert.doesNotMatch(build, /Start-Enhanced\.(ps1|cmd)/i);
    assert.doesNotMatch(provenance, /Start-Enhanced\.(ps1|cmd)/i);
    assert.equal(installerEntries.some(line => /powershell\.exe|cmd\.exe|Start-Enhanced/i.test(line)), false);
});
