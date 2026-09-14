const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const strmResolver = require('../src/electronapp/resolvers/strm-resolver');

function createFixture(name, sourcePath) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ete-strm-resolver-'));
    const sidecarPath = path.join(directory, name);

    return {
        directory,
        sidecarPath,
        sourcePath: sourcePath || 'https://media.example.test/stream',
        nativeSource: 'https://emby.example.test/videos/native-stream',
        cleanup() {
            fs.rmSync(directory, {recursive: true, force: true});
        }
    };
}

function resolveFor(fixture, overrides, dependencies) {
    return strmResolver.resolve(Object.assign({
        item: {Path: fixture.sidecarPath},
        mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
        url: fixture.nativeSource,
        playMethod: 'DirectPlay'
    }, overrides || {}), dependencies || {fs});
}

test('STRM detection uses Item.Path suffix or MediaSource.Container', () => {
    assert.equal(strmResolver.isStrm({
        item: {Path: 'D:\\Media\\Movie.mkv.STRM'},
        mediaSource: {Container: 'mkv'}
    }), true);
    assert.equal(strmResolver.isStrm({
        item: {Path: 'D:\\Media\\Movie.mkv'},
        mediaSource: {Container: 'STRM'}
    }), true);
    assert.equal(strmResolver.isStrm({
        item: {Path: 'D:\\Media\\Movie.mkv'},
        mediaSource: {Container: 'mkv'}
    }), false);
});

test('sidecar stem rule resolves an existing local media file', () => {
    const fixture = createFixture('Movie.mkv.strm');
    const expected = path.join(fixture.directory, 'Movie.mkv');
    fs.writeFileSync(expected, 'fixture');

    try {
        const result = resolveFor(fixture);

        assert.deepEqual(result, {
            type: 'local',
            source: expected,
            reason: 'mount_hit',
            isStrm: true,
            localExists: true,
            fallback: false
        });
    } finally {
        fixture.cleanup();
    }
});

test('a higher-priority sidecar hit is returned before unsupported or malformed source parsing', () => {
    for (const sourcePath of [
        'not-a-supported-source',
        'https://media.example.test/%E0%A4%A.mkv'
    ]) {
        const fixture = createFixture('Movie.mkv.strm', sourcePath);
        const expected = path.join(fixture.directory, 'Movie.mkv');
        fs.writeFileSync(expected, 'fixture');

        try {
            const result = resolveFor(fixture);

            assert.equal(result.type, 'local');
            assert.equal(result.source, expected);
            assert.equal(result.reason, 'mount_hit');
        } finally {
            fixture.cleanup();
        }
    }
});

test('local MediaSource.Path and URL pathname/query rules resolve only existing files', () => {
    const localFixture = createFixture('Mounted.strm', 'D:\\Mounts\\Mounted.mkv');
    const localPath = 'D:\\Mounts\\Mounted.mkv';
    const localFs = {existsSync: value => value === localPath};
    const localResult = resolveFor(localFixture, {
        mediaSource: {Path: localPath, Container: 'strm'}
    }, {fs: localFs});

    assert.equal(localResult.type, 'local');

    localFixture.cleanup();

    const urlFixture = createFixture('中文 片名.strm', 'https://media.example.test/library/%E4%B8%AD%E6%96%87%20%E7%89%87%E5%90%8D.mkv');
    const urlExpected = path.join(urlFixture.directory, '中文 片名.mkv');
    fs.writeFileSync(urlExpected, 'fixture');

    try {
        const urlResult = resolveFor(urlFixture);
        assert.equal(urlResult.type, 'local');
        assert.equal(urlResult.source, urlExpected);
    } finally {
        urlFixture.cleanup();
    }

    const queryFixture = createFixture('Query.strm', 'https://media.example.test/download?id=opaque&filename=Query%20Name.mkv');
    const queryExpected = path.join(queryFixture.directory, 'Query Name.mkv');
    fs.writeFileSync(queryExpected, 'fixture');

    try {
        const queryResult = resolveFor(queryFixture);
        assert.equal(queryResult.type, 'local');
        assert.equal(queryResult.source, queryExpected);
    } finally {
        queryFixture.cleanup();
    }
});

test('Windows local source paths require an existing file', () => {
    const fixture = createFixture('Mounted.strm', 'D:\\Mounts\\Mounted.mkv');
    const result = strmResolver.resolve({
        item: {Path: fixture.sidecarPath},
        mediaSource: {Path: 'D:\\Mounts\\Mounted.mkv', Container: 'strm'},
        url: fixture.nativeSource,
        playMethod: 'DirectPlay'
    }, {
        fs: {existsSync: value => value === 'D:\\Mounts\\Mounted.mkv'}
    });

    try {
        assert.equal(result.type, 'local');
        assert.equal(result.source, 'D:\\Mounts\\Mounted.mkv');
    } finally {
        fixture.cleanup();
    }
});

test('missing local files fall back to the native source', () => {
    const fixture = createFixture('Movie.mkv.strm');

    try {
        const result = resolveFor(fixture);

        assert.equal(result.type, 'native');
        assert.equal(result.source, fixture.nativeSource);
        assert.equal(result.reason, 'mount_missing');
        assert.equal(result.fallback, true);
    } finally {
        fixture.cleanup();
    }
});

test('non-media sidecar extensions are not mount candidates', () => {
    for (const extension of ['txt', 'nfo']) {
        const fixture = createFixture(`Movie.${extension}.strm`);
        fs.writeFileSync(path.join(fixture.directory, `Movie.${extension}`), 'fixture');

        try {
            const result = resolveFor(fixture);

            assert.equal(result.type, 'native');
            assert.equal(result.source, fixture.nativeSource);
            assert.equal(result.reason, 'mount_missing');
        } finally {
            fixture.cleanup();
        }
    }
});

test('invalid input and malformed URL decoding never replace the native source', () => {
    const fixture = createFixture('Movie.mkv.strm', 'https://media.example.test/%E0%A4%A.mkv');

    try {
        const missingItem = resolveFor(fixture, {item: null});
        const missingMediaSource = resolveFor(fixture, {mediaSource: null});
        const missingSourcePath = resolveFor(fixture, {mediaSource: {Container: 'strm'}});
        const invalidUrl = resolveFor(fixture);

        assert.equal(missingItem.type, 'native');
        assert.equal(missingItem.source, fixture.nativeSource);
        assert.equal(missingItem.reason, 'invalid_context');
        assert.equal(missingMediaSource.type, 'native');
        assert.equal(missingMediaSource.source, fixture.nativeSource);
        assert.equal(missingMediaSource.reason, 'invalid_context');
        assert.equal(missingSourcePath.type, 'native');
        assert.equal(missingSourcePath.source, fixture.nativeSource);
        assert.equal(missingSourcePath.reason, 'invalid_context');
        assert.equal(invalidUrl.type, 'native');
        assert.equal(invalidUrl.source, fixture.nativeSource);
        assert.equal(invalidUrl.reason, 'parse_failed');
    } finally {
        fixture.cleanup();
    }
});

test('non-STRM media preserves the native source', () => {
    const fixture = createFixture('Movie.mkv');

    try {
        const result = resolveFor(fixture, {
            item: {Path: fixture.sidecarPath},
            mediaSource: {Path: fixture.sourcePath, Container: 'mkv'}
        });

        assert.equal(result.type, 'native');
        assert.equal(result.source, fixture.nativeSource);
        assert.equal(result.reason, 'not_strm');
    } finally {
        fixture.cleanup();
    }
});

test('Transcode is protected even when a deterministic mount candidate exists', () => {
    const fixture = createFixture('Movie.mkv.strm');
    fs.writeFileSync(path.join(fixture.directory, 'Movie.mkv'), 'fixture');

    try {
        const result = resolveFor(fixture, {playMethod: 'Transcode'});

        assert.equal(result.type, 'native');
        assert.equal(result.source, fixture.nativeSource);
        assert.equal(result.reason, 'transcode_skip');
    } finally {
        fixture.cleanup();
    }
});

test('DirectStream can use a deterministic existing mount while preserving fallback semantics', () => {
    const fixture = createFixture('Stream.mkv.strm', 'https://media.example.test/stream');
    const expected = path.join(fixture.directory, 'Stream.mkv');
    fs.writeFileSync(expected, 'fixture');

    try {
        const result = resolveFor(fixture, {playMethod: 'DirectStream'});

        assert.equal(result.type, 'local');
        assert.equal(result.source, expected);
        assert.equal(result.reason, 'mount_hit');
    } finally {
        fixture.cleanup();
    }
});

test('absolute POSIX media source is a deterministic CD2 candidate', async () => {
    const fixture = createFixture('Episode.strm', '/srv/media/Show/E01.mkv');
    try {
        const result = await strmResolver.resolveAsync({
            item: {Path: fixture.sidecarPath},
            mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
            url: fixture.nativeSource,
            playMethod: 'DirectPlay'
        }, {
            fs,
            requestId: 'posix-candidate',
            cd2Transport: {
                resolve: async request => {
                    assert.deepEqual(request.candidates, ['/srv/media/Show/E01.mkv']);
                    return {status: 'hit', type: 'url', source: 'http://127.0.0.1:19798/source'};
                }
            }
        });
        assert.equal(result.type, 'url');
    } finally {
        fixture.cleanup();
    }
});

test('a POSIX source candidate never enters the Mount existsSync flow after a CD2 miss', async () => {
    const fixture = createFixture('Episode.strm', '/srv/media/Show/E01.mkv');
    const probed = [];
    try {
        const result = await strmResolver.resolveAsync({
            item: {Path: fixture.sidecarPath},
            mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
            url: fixture.nativeSource,
            playMethod: 'DirectPlay'
        }, {
            fs: {
                existsSync: value => {
                    probed.push(value);
                    return value === fixture.sourcePath;
                }
            },
            requestId: 'posix-miss',
            cd2Transport: {
                resolve: async request => {
                    assert.deepEqual(request.candidates, [fixture.sourcePath]);
                    return {status: 'miss', reason: 'unavailable'};
                }
            }
        });

        assert.equal(result.type, 'native');
        assert.equal(result.source, fixture.nativeSource);
        assert.equal(result.cd2Reason, 'unavailable');
        assert.deepEqual(probed, []);
    } finally {
        fixture.cleanup();
    }
});

test('UNC local source paths still resolve through Mount when they exist', () => {
    const fixture = createFixture('Mounted.strm', '\\\\server\\share\\Mounted.mkv');
    const sourcePath = '\\\\server\\share\\Mounted.mkv';
    const result = strmResolver.resolve({
        item: {Path: fixture.sidecarPath},
        mediaSource: {Path: sourcePath, Container: 'strm'},
        url: fixture.nativeSource,
        playMethod: 'DirectPlay'
    }, {
        fs: {existsSync: value => value === sourcePath}
    });

    try {
        assert.equal(result.type, 'local');
        assert.equal(result.source, sourcePath);
        assert.equal(result.reason, 'mount_hit');
    } finally {
        fixture.cleanup();
    }
});

test('async STRM resolution prefers CD2 URL over an existing Mount candidate', async () => {
    const fixture = createFixture('Movie.mkv.strm');
    const local = path.join(fixture.directory, 'Movie.mkv');
    fs.writeFileSync(local, 'fixture');

    try {
        const result = await strmResolver.resolveAsync({
            item: {Path: fixture.sidecarPath},
            mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
            url: fixture.nativeSource,
            playMethod: 'DirectPlay'
        }, {
            fs,
            requestId: 'play-1',
            cd2Transport: {
                resolve: async request => {
                    assert.equal(request.candidates[0], local);
                    return {status: 'hit', type: 'url', source: 'http://127.0.0.1:19798/source'};
                }
            }
        });

        assert.equal(result.type, 'url');
        assert.equal(result.reason, 'cd2_hit');
        assert.equal(result.isStrm, true);
    } finally {
        fixture.cleanup();
    }
});

test('async CD2 miss falls through to Mount and then Native', async () => {
    const mountFixture = createFixture('Movie.mkv.strm');
    const local = path.join(mountFixture.directory, 'Movie.mkv');
    fs.writeFileSync(local, 'fixture');
    const transport = {resolve: async () => ({status: 'miss', reason: 'unavailable'})};

    try {
        const mounted = await strmResolver.resolveAsync({
            item: {Path: mountFixture.sidecarPath},
            mediaSource: {Path: mountFixture.sourcePath, Container: 'strm'},
            url: mountFixture.nativeSource,
            playMethod: 'DirectPlay'
        }, {fs, requestId: 'play-2', cd2Transport: transport});
        assert.equal(mounted.type, 'local');
        assert.equal(mounted.source, local);
    } finally {
        mountFixture.cleanup();
    }

    const nativeFixture = createFixture('Missing.mkv.strm');
    try {
        const native = await strmResolver.resolveAsync({
            item: {Path: nativeFixture.sidecarPath},
            mediaSource: {Path: nativeFixture.sourcePath, Container: 'strm'},
            url: nativeFixture.nativeSource,
            playMethod: 'DirectPlay'
        }, {fs, requestId: 'play-3', cd2Transport: transport});
        assert.equal(native.type, 'native');
        assert.equal(native.source, nativeFixture.nativeSource);
    } finally {
        nativeFixture.cleanup();
    }
});

test('Transcode never invokes async CD2 transport', async () => {
    const fixture = createFixture('Movie.mkv.strm');
    let invoked = false;
    try {
        const result = await strmResolver.resolveAsync({
            item: {Path: fixture.sidecarPath},
            mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
            url: fixture.nativeSource,
            playMethod: 'Transcode'
        }, {fs, requestId: 'play-4', cd2Transport: {resolve: async () => { invoked = true; }}});
        assert.equal(result.type, 'native');
        assert.equal(result.reason, 'transcode_skip');
        assert.equal(invoked, false);
    } finally {
        fixture.cleanup();
    }
});

test('aborted async CD2 request is cancelled and never reaches fallback', async () => {
    const fixture = createFixture('Movie.mkv.strm');
    const controller = new AbortController();
    let resolveTransport;
    let cancelled = false;
    const pending = strmResolver.resolveAsync({
        item: {Path: fixture.sidecarPath},
        mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
        url: fixture.nativeSource,
        playMethod: 'DirectPlay'
    }, {
        fs,
        requestId: 'play-5',
        signal: controller.signal,
        cd2Transport: {
            resolve: () => new Promise(resolve => { resolveTransport = resolve; }),
            cancel: () => { cancelled = true; resolveTransport({status: 'cancelled', reason: 'cancelled'}); }
        }
    });
    controller.abort();
    await assert.rejects(pending, error => error && error.name === 'AbortError');
    assert.equal(cancelled, true);
    fixture.cleanup();
});

test('rejected CD2 transport still falls through to an existing Mount candidate', async () => {
    const fixture = createFixture('Rejected.mkv.strm');
    const local = path.join(fixture.directory, 'Rejected.mkv');
    fs.writeFileSync(local, 'fixture');
    try {
        const result = await strmResolver.resolveAsync({
            item: {Path: fixture.sidecarPath},
            mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
            url: fixture.nativeSource,
            playMethod: 'DirectPlay'
        }, {fs, requestId: 'reject-mount', cd2Transport: {resolve: () => Promise.reject(new Error('synthetic transport failure'))}});
        assert.equal(result.type, 'local');
        assert.equal(result.source, local);
        assert.equal(result.cd2Reason, 'transport_error');
    } finally {
        fixture.cleanup();
    }
});

test('rejected CD2 transport falls through to Native when Mount is missing', async () => {
    const fixture = createFixture('Rejected.mkv.strm');
    try {
        const result = await strmResolver.resolveAsync({
            item: {Path: fixture.sidecarPath},
            mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
            url: fixture.nativeSource,
            playMethod: 'DirectPlay'
        }, {fs, requestId: 'reject-native', cd2Transport: {resolve: () => Promise.reject(new Error('synthetic transport failure'))}});
        assert.equal(result.type, 'native');
        assert.equal(result.source, fixture.nativeSource);
        assert.equal(result.cd2Reason, 'transport_error');
    } finally {
        fixture.cleanup();
    }
});

test('rejected transport after abort never reaches Mount fallback', async () => {
    const fixture = createFixture('Aborted.mkv.strm');
    const local = path.join(fixture.directory, 'Aborted.mkv');
    fs.writeFileSync(local, 'fixture');
    const controller = new AbortController();
    let rejectTransport;
    const pending = strmResolver.resolveAsync({
        item: {Path: fixture.sidecarPath},
        mediaSource: {Path: fixture.sourcePath, Container: 'strm'},
        url: fixture.nativeSource,
        playMethod: 'DirectPlay'
    }, {
        fs,
        requestId: 'reject-abort',
        signal: controller.signal,
        cd2Transport: {
            resolve: () => new Promise((resolve, reject) => { rejectTransport = reject; }),
            cancel: () => rejectTransport(new Error('cancelled transport'))
        }
    });
    controller.abort();
    await assert.rejects(pending, error => error && error.name === 'AbortError');
    fixture.cleanup();
});
