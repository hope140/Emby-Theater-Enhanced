'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const preloadPreparation = require('./prepare-preload.cjs');

const OVERLAY_RUNTIME_PATH = 'electronapp/www/modules/common/playback/playbackmanager.js';
const OVERLAY_GENERATOR_PATH = 'tools/patch-playbackmanager.cjs';
const PACKAGE_RUNTIME_PATH = 'electronapp/package.json';
const PACKAGE_GENERATOR_PATH = 'tools/build.ps1';
const APP_RUNTIME_PATH = 'electronapp/www/app.js';
const APP_SOURCE_PATH = 'src/electronapp/www/app.js';
const APP_GENERATOR_PATH = 'tools/patch-external-player-registration.cjs';
const PREPARED_SOURCE_PATHS = Object.freeze([preloadPreparation.PREPARED_PRELOAD_PATH]);
const PREPARED_ARTIFACT_CONTRACT = Object.freeze([{
    preparedPath: preloadPreparation.PREPARED_PRELOAD_PATH,
    basePath: preloadPreparation.BASE_PRELOAD_PATH,
    runtimePath: preloadPreparation.RUNTIME_PRELOAD_PATH,
    generatorPath: 'tools/prepare-preload.cjs',
    category: 'prepared-workspace-artifact'
}]);
const EXCLUDED_SOURCE_PREFIXES = Object.freeze([
    'src/electronapp/www/modules/externalplayer/'
]);
const RUNTIME_OVERLAY_CONTRACT = Object.freeze([
    {runtimePath: APP_RUNTIME_PATH, sourcePath: APP_SOURCE_PATH, generatorPath: APP_GENERATOR_PATH},
    {runtimePath: OVERLAY_RUNTIME_PATH, sourcePath: 'src/electronapp/www/modules/common/playback/playbackmanager.js', generatorPath: OVERLAY_GENERATOR_PATH},
    {runtimePath: PACKAGE_RUNTIME_PATH, sourcePath: 'src/electronapp/package.json', generatorPath: PACKAGE_GENERATOR_PATH}
]);
const OVERLAY_GENERATORS = new Map(RUNTIME_OVERLAY_CONTRACT.map(entry => [entry.runtimePath, entry.generatorPath]));

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

function isExcludedSourcePath(sourcePath) {
    return EXCLUDED_SOURCE_PREFIXES.some(prefix => sourcePath.startsWith(prefix));
}

function isPreparedSourcePath(sourcePath) {
    return PREPARED_SOURCE_PATHS.indexOf(sourcePath) >= 0;
}

function sameStringArray(actual, expected) {
    return Array.isArray(actual) && actual.length === expected.length &&
        actual.every((value, index) => value === expected[index]);
}

function buildOverlayEntries(root, runtime) {
    return RUNTIME_OVERLAY_CONTRACT.map(contract => {
        const sourceFile = path.join(root, contract.sourcePath);
        const runtimeFile = path.join(runtime, contract.runtimePath);
        const generatorFile = path.join(root, contract.generatorPath);
        if (!exists(runtimeFile)) throw new Error('Provenance runtime overlay missing: ' + contract.runtimePath);
        if (!exists(generatorFile)) throw new Error('Provenance overlay generator missing: ' + contract.generatorPath);
        const sourcePresent = exists(sourceFile);
        return Object.assign({}, contract, {
            sourcePresent,
            sourceSha256: sourcePresent ? hashFile(sourceFile) : null,
            generatorSha256: hashFile(generatorFile),
            runtimeSha256: hashFile(runtimeFile)
        });
    });
}

function sourceEntries(root) {
    const sourceRoot = path.join(root, 'src', 'electronapp');
    const entries = walkFiles(sourceRoot).map(file => {
        const relative = slash(path.relative(sourceRoot, file));
        const sourcePath = 'src/electronapp/' + relative;
        if (isExcludedSourcePath(sourcePath) || isPreparedSourcePath(sourcePath)) return null;
        return {
            sourcePath,
            runtimePath: 'electronapp/' + relative,
            relation: 'copied'
        };
    }).filter(Boolean);
    for (const entry of entries) {
        const generatorPath = OVERLAY_GENERATORS.get(entry.runtimePath);
        if (generatorPath) {
            entry.relation = 'overlay';
            entry.overlay = {generatorPath};
        }
    }
    return entries.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function buildPreparedArtifactEntries(root, runtime) {
    return PREPARED_ARTIFACT_CONTRACT.map(contract => {
        const baseFile = path.join(root, contract.basePath);
        const preparedFile = path.join(root, contract.preparedPath);
        const runtimeFile = path.join(runtime, contract.runtimePath);
        const generatorFile = path.join(root, contract.generatorPath);
        if (!exists(baseFile) || !exists(preparedFile) || !exists(runtimeFile) || !exists(generatorFile)) {
            throw new Error('Prepared artifact input missing: ' + contract.preparedPath);
        }
        const baseText = fs.readFileSync(baseFile, 'utf8');
        const expectedText = preloadPreparation.buildPreparedPreload(baseText);
        const baseSha256 = hashFile(baseFile);
        const generatorSha256 = hashFile(generatorFile);
        const preparedSha256 = hashFile(preparedFile);
        const runtimeSha256 = hashFile(runtimeFile);
        const expectedPreparedSha256 = preloadPreparation.sha256(Buffer.from(expectedText, 'utf8'));
        if (preparedSha256 !== expectedPreparedSha256) {
            throw new Error('Prepared artifact hash mismatch: ' + contract.preparedPath);
        }
        if (runtimeSha256 !== preparedSha256) {
            throw new Error('Prepared artifact runtime mismatch: ' + contract.preparedPath + ' -> ' + contract.runtimePath);
        }
        return {
            preparedPath: contract.preparedPath,
            basePath: contract.basePath,
            runtimePath: contract.runtimePath,
            generatorPath: contract.generatorPath,
            category: contract.category,
            baseSha256: baseSha256,
            generatorSha256: generatorSha256,
            expectedPreparedSha256: expectedPreparedSha256,
            preparedSha256: preparedSha256,
            runtimeSha256: runtimeSha256
        };
    });
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
    const buildOverlays = buildOverlayEntries(root, runtime);
    const preparedArtifacts = buildPreparedArtifactEntries(root, runtime);
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
            excludedSourcePrefixes: [...EXCLUDED_SOURCE_PREFIXES],
            preparedSourcePaths: [...PREPARED_SOURCE_PATHS],
            description: 'All non-excluded repo-owned src/electronapp files; prepared workspace artifacts and package metadata/PlaybackManager are recorded separately',
            fileCount: files.length,
            files
        },
        buildOverlays,
        preparedArtifacts,
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
        buildOverlays: manifest && Array.isArray(manifest.buildOverlays) ? manifest.buildOverlays : [],
        validatedProductScope: manifest && manifest.validatedProductScope
            ? {
                sourceRoot: manifest.validatedProductScope.sourceRoot,
                runtimeRoot: manifest.validatedProductScope.runtimeRoot,
                excludedSourcePrefixes: Array.isArray(manifest.validatedProductScope.excludedSourcePrefixes)
                    ? manifest.validatedProductScope.excludedSourcePrefixes : [],
                preparedSourcePaths: Array.isArray(manifest.validatedProductScope.preparedSourcePaths)
                    ? manifest.validatedProductScope.preparedSourcePaths : [],
                fileCount: manifest.validatedProductScope.fileCount
            }
            : null,
        preparedArtifacts: manifest && Array.isArray(manifest.preparedArtifacts) ? manifest.preparedArtifacts : [],
        files: files || [],
        errors
    };
}

function validateBuildOverlays(root, runtime, manifest, errors) {
    let expected;
    try {
        expected = buildOverlayEntries(root, runtime);
    } catch (error) {
        errors.push('build-overlay-input-missing');
        return [];
    }
    const actual = manifest && Array.isArray(manifest.buildOverlays) ? manifest.buildOverlays : [];
    if (actual.length !== expected.length) errors.push('build-overlay-contract-mismatch');
    const checks = expected.map((expectedEntry, index) => {
        const entry = actual[index] || {};
        const contractMatch = entry.runtimePath === expectedEntry.runtimePath &&
            entry.sourcePath === expectedEntry.sourcePath &&
            entry.generatorPath === expectedEntry.generatorPath;
        const sourcePresenceMatch = entry.sourcePresent === expectedEntry.sourcePresent;
        const sourceMatch = entry.sourceSha256 === expectedEntry.sourceSha256;
        const generatorMatch = entry.generatorSha256 === expectedEntry.generatorSha256;
        const runtimeMatch = entry.runtimeSha256 === expectedEntry.runtimeSha256;
        const valid = contractMatch && sourcePresenceMatch && sourceMatch && generatorMatch && runtimeMatch;
        if (!contractMatch) errors.push('build-overlay-contract-mismatch:' + expectedEntry.runtimePath);
        if (!sourcePresenceMatch) errors.push('build-overlay-source-presence-mismatch:' + expectedEntry.sourcePath);
        if (!sourceMatch) errors.push('build-overlay-source-hash-mismatch:' + expectedEntry.sourcePath);
        if (!generatorMatch) errors.push('build-overlay-generator-mismatch:' + expectedEntry.generatorPath);
        if (!runtimeMatch) errors.push('build-overlay-runtime-hash-mismatch:' + expectedEntry.runtimePath);
        return Object.assign({}, entry, {
            contractMatch,
            sourcePresenceMatch,
            sourceMatch,
            generatorMatch,
            runtimeMatch,
            valid
        });
    });
    return checks;
}

function validatePreparedArtifacts(root, runtime, manifest, errors) {
    let expected;
    try {
        expected = buildPreparedArtifactEntries(root, runtime);
    } catch (error) {
        errors.push(String(error && error.message || '').indexOf('Prepared artifact runtime mismatch:') === 0
            ? 'prepared-artifact-runtime-mismatch' : 'prepared-artifact-input-missing');
        return [];
    }
    const actual = manifest && Array.isArray(manifest.preparedArtifacts) ? manifest.preparedArtifacts : [];
    if (actual.length !== expected.length) errors.push('prepared-artifact-contract-mismatch');
    return expected.map((expectedEntry, index) => {
        const entry = actual[index] || {};
        const fields = ['preparedPath', 'basePath', 'runtimePath', 'generatorPath', 'category', 'baseSha256', 'generatorSha256', 'expectedPreparedSha256', 'preparedSha256', 'runtimeSha256'];
        const matches = fields.every(field => entry[field] === expectedEntry[field]);
        if (!matches) errors.push('prepared-artifact-mismatch:' + expectedEntry.preparedPath);
        return Object.assign({}, entry, {valid: matches});
    });
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
    if (!sameStringArray(scope.excludedSourcePrefixes, EXCLUDED_SOURCE_PREFIXES)) {
        errors.push('source-exclusion-contract-mismatch');
    }
    if (!sameStringArray(scope.preparedSourcePaths, PREPARED_SOURCE_PATHS)) {
        errors.push('prepared-source-contract-mismatch');
    }
    const buildOverlays = validateBuildOverlays(root, runtime, manifest, errors);
    const preparedArtifacts = validatePreparedArtifacts(root, runtime, manifest, errors);
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
            excludedSourcePrefixes: Array.isArray(scope.excludedSourcePrefixes) ? scope.excludedSourcePrefixes : [],
            preparedSourcePaths: Array.isArray(scope.preparedSourcePaths) ? scope.preparedSourcePaths : [],
            fileCount: scope.fileCount,
            currentFileCount: expected.length
        },
        buildOverlays,
        preparedArtifacts,
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
