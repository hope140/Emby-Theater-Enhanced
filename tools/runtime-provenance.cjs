'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OVERLAY_RUNTIME_PATH = 'electronapp/www/modules/common/playback/playbackmanager.js';
const OVERLAY_GENERATOR_PATH = 'tools/patch-playbackmanager.cjs';
const PACKAGE_RUNTIME_PATH = 'electronapp/package.json';
const PACKAGE_GENERATOR_PATH = 'tools/build.ps1';
const START_WRAPPERS = ['tools/Start-Enhanced.ps1', 'tools/Start-Enhanced.cmd'];
const OVERLAY_GENERATORS = new Map([
    [OVERLAY_RUNTIME_PATH, OVERLAY_GENERATOR_PATH],
    [PACKAGE_RUNTIME_PATH, PACKAGE_GENERATOR_PATH]
]);

function usage() {
    throw new Error('Usage: runtime-provenance.cjs <write|validate> <root> <runtime> <sourceCommit>');
}

function hashFile(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function exists(file) {
    try { return fs.statSync(file).isFile(); } catch (_) { return false; }
}

function walkFiles(root) {
    if (!fs.existsSync(root)) return [];
    const result = [];
    const pending = [root];
    while (pending.length) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a, b) => b.name.localeCompare(a.name))) {
            const file = path.join(current, entry.name);
            if (entry.isDirectory()) pending.push(file);
            else if (entry.isFile()) result.push(file);
        }
    }
    return result.sort((a, b) => a.localeCompare(b));
}

function slash(value) { return value.split(path.sep).join('/'); }

function sourceEntries(root) {
    const sourceRoot = path.join(root, 'src', 'electronapp');
    const entries = walkFiles(sourceRoot).map(file => {
        const relative = slash(path.relative(sourceRoot, file));
        return {
            sourcePath: 'src/electronapp/' + relative,
            runtimePath: 'electronapp/' + relative,
            relation: 'copied'
        };
    });
    for (const wrapper of START_WRAPPERS) {
        entries.push({sourcePath: wrapper, runtimePath: slash(path.basename(wrapper)), relation: 'copied'});
    }
    for (const entry of entries) {
        const generatorPath = OVERLAY_GENERATORS.get(entry.runtimePath);
        if (generatorPath) {
            entry.relation = 'overlay';
            entry.overlay = {generatorPath};
        }
    }
    return entries.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function baselineIdentity(root) {
    const manifestPath = path.join(root, 'vendor', 'runtime-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
        manifestPath: 'vendor/runtime-manifest.json',
        sha256: hashFile(manifestPath),
        baseline: manifest.baseline || 'unknown',
        vendorFileCount: Array.isArray(manifest.files) ? manifest.files.length : null,
        vendorPatchFileCount: Array.isArray(manifest.patchFiles) ? manifest.patchFiles.length : null,
        coverage: 'vendor files are identified by the external runtime manifest, not by sourceCommit'
    };
}

function writeManifest(root, runtime, sourceCommit) {
    if (!/^[0-9a-fA-F]{40}$/.test(sourceCommit || '')) throw new Error('sourceCommit must be a 40-character git commit.');
    const entries = sourceEntries(root);
    const files = entries.map(entry => {
        const sourceFile = path.join(root, entry.sourcePath);
        const runtimeFile = path.join(runtime, entry.runtimePath);
        if (!exists(sourceFile) || !exists(runtimeFile)) throw new Error('Provenance input missing: ' + entry.sourcePath);
        const value = Object.assign({}, entry, {
            sourceSha256: hashFile(sourceFile),
            runtimeSha256: hashFile(runtimeFile)
        });
        if (value.overlay) value.overlay.generatorSha256 = hashFile(path.join(root, value.overlay.generatorPath));
        return value;
    });
    const manifest = {
        schemaVersion: 1,
        sourceCommit: sourceCommit.toLowerCase(),
        baselineIdentity: baselineIdentity(root),
        validatedProductScope: {
            sourceRoot: 'src/electronapp',
            runtimeRoot: 'electronapp',
            includesIgnoredSourceFiles: true,
            includesStartWrappers: true,
            description: 'All repo-owned src/electronapp files plus Start-Enhanced wrappers; package metadata and PlaybackManager are recorded as explicit build overlays',
            fileCount: files.length,
            files
        },
        exclusions: ['vendor baseline payload', 'node_modules production closure', 'Electron runtime binaries', 'native mpv binary']
    };
    fs.writeFileSync(path.join(runtime, 'runtime-provenance.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return {status: 'passed', sourceCommit: manifest.sourceCommit, fileCount: files.length};
}

function failedValidation(runtime, sourceCommit, errors, files, manifest) {
    return {
        schemaVersion: 1,
        status: 'failed',
        sourceCommit: sourceCommit || '',
        runtimeName: path.basename(runtime),
        manifest: 'runtime-provenance.json',
        baselineIdentity: manifest && manifest.baselineIdentity || null,
        validatedProductScope: manifest && manifest.validatedProductScope
            ? {sourceRoot: manifest.validatedProductScope.sourceRoot, runtimeRoot: manifest.validatedProductScope.runtimeRoot, fileCount: manifest.validatedProductScope.fileCount}
            : null,
        files: files || [],
        errors
    };
}

function validateManifest(root, runtime, sourceCommit) {
    const errors = [];
    const manifestPath = path.join(runtime, 'runtime-provenance.json');
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
        return failedValidation(runtime, sourceCommit, ['runtime-provenance-missing-or-invalid'], [], null);
    }
    if (manifest.schemaVersion !== 1) errors.push('unsupported-provenance-schema');
    if (manifest.sourceCommit !== String(sourceCommit || '').toLowerCase()) errors.push('source-commit-mismatch');
    if (!manifest.baselineIdentity || manifest.baselineIdentity.manifestPath !== 'vendor/runtime-manifest.json') errors.push('baseline-identity-missing');
    else {
        const baselinePath = path.join(root, manifest.baselineIdentity.manifestPath);
        if (!exists(baselinePath)) errors.push('baseline-manifest-missing');
        else if (hashFile(baselinePath) !== manifest.baselineIdentity.sha256) errors.push('baseline-manifest-changed');
    }
    const scope = manifest.validatedProductScope;
    if (!scope || scope.sourceRoot !== 'src/electronapp' || scope.runtimeRoot !== 'electronapp' || scope.includesIgnoredSourceFiles !== true || !Array.isArray(scope.files)) {
        return failedValidation(runtime, sourceCommit, errors.concat('validated-product-scope-missing'), [], manifest);
    }
    const expected = sourceEntries(root);
    const bySource = new Map(scope.files.map(entry => [entry.sourcePath, entry]));
    const expectedSources = new Set(expected.map(entry => entry.sourcePath));
    for (const entry of expected) if (!bySource.has(entry.sourcePath)) errors.push('manifest-file-missing:' + entry.sourcePath);
    for (const entry of scope.files) if (!expectedSources.has(entry.sourcePath)) errors.push('manifest-file-extra:' + entry.sourcePath);
    if (scope.fileCount !== scope.files.length || scope.files.length !== expected.length) errors.push('product-file-count-mismatch');

    const checks = [];
    for (const expectedEntry of expected) {
        const entry = bySource.get(expectedEntry.sourcePath);
        if (!entry) continue;
        const sourceFile = path.join(root, entry.sourcePath);
        const runtimeFile = path.join(runtime, entry.runtimePath);
        const sourceExists = exists(sourceFile);
        const runtimeExists = exists(runtimeFile);
        const sourceSha256 = sourceExists ? hashFile(sourceFile) : null;
        const runtimeSha256 = runtimeExists ? hashFile(runtimeFile) : null;
        const sourceMatch = sourceSha256 === entry.sourceSha256;
        const runtimeMatch = runtimeSha256 === entry.runtimeSha256;
        const expectedOverlay = expectedEntry.overlay || null;
        const actualOverlay = entry.overlay || null;
        const overlayMatch = expectedOverlay
            ? !!actualOverlay && actualOverlay.generatorPath === expectedOverlay.generatorPath
            : !actualOverlay;
        const relationMatch = entry.relation === expectedEntry.relation &&
            entry.runtimePath === expectedEntry.runtimePath && overlayMatch;
        const copiedMatch = entry.relation === 'overlay' || sourceSha256 === runtimeSha256;
        const check = {
            sourcePath: entry.sourcePath,
            runtimePath: entry.runtimePath,
            relation: entry.relation,
            sourceSha256,
            runtimeSha256,
            manifestSourceSha256: entry.sourceSha256,
            manifestRuntimeSha256: entry.runtimeSha256,
            relationMatch,
            sourceMatch,
            runtimeMatch,
            valid: sourceExists && runtimeExists && relationMatch && sourceMatch && runtimeMatch && copiedMatch
        };
        if (expectedOverlay || actualOverlay) {
            const generatorPath = actualOverlay && actualOverlay.generatorPath;
            const generatorFile = generatorPath ? path.join(root, generatorPath) : '';
            check.generatorMatch = !!expectedOverlay && !!actualOverlay &&
                generatorPath === expectedOverlay.generatorPath &&
                entry.relation === 'overlay' && exists(generatorFile) &&
                hashFile(generatorFile) === actualOverlay.generatorSha256;
            check.valid = check.valid && check.generatorMatch;
            if (!check.generatorMatch) errors.push('overlay-generator-mismatch:' + (generatorPath || entry.sourcePath));
        }
        if (!relationMatch) errors.push('manifest-relation-mismatch:' + entry.sourcePath);
        if (!sourceExists) errors.push('source-file-missing:' + entry.sourcePath);
        if (!runtimeExists) errors.push('runtime-file-missing:' + entry.runtimePath);
        if (sourceExists && !sourceMatch) errors.push('source-hash-mismatch:' + entry.sourcePath);
        if (runtimeExists && !runtimeMatch) errors.push('runtime-hash-mismatch:' + entry.runtimePath);
        if (entry.relation !== 'overlay' && sourceExists && runtimeExists && sourceSha256 !== runtimeSha256) errors.push('copy-hash-mismatch:' + entry.sourcePath);
        checks.push(check);
    }
    return {
        schemaVersion: 1,
        status: errors.length ? 'failed' : 'passed',
        sourceCommit: String(sourceCommit || '').toLowerCase(),
        runtimeName: path.basename(runtime),
        manifest: 'runtime-provenance.json',
        baselineIdentity: manifest.baselineIdentity,
        validatedProductScope: {
            sourceRoot: scope.sourceRoot,
            runtimeRoot: scope.runtimeRoot,
            includesIgnoredSourceFiles: scope.includesIgnoredSourceFiles === true,
            fileCount: scope.fileCount,
            currentFileCount: expected.length
        },
        files: checks,
        errors
    };
}

const [command, rootArg, runtimeArg, sourceCommit] = process.argv.slice(2);
if (!command || !rootArg || !runtimeArg || !sourceCommit) usage();
const root = path.resolve(rootArg);
const runtime = path.resolve(runtimeArg);
const result = command === 'write'
    ? writeManifest(root, runtime, sourceCommit)
    : command === 'validate'
        ? validateManifest(root, runtime, sourceCommit)
        : usage();
process.stdout.write(JSON.stringify(result) + '\n');
if (result.status === 'failed') process.exitCode = 1;
