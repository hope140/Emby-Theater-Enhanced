'use strict';

const properties = [
    'mpv-version', 'libmpv-version', 'mpv-build-date', 'current-vo', 'vo',
    'gpu-api', 'gpu-context', 'hwdec', 'hwdec-current',
    'scale', 'cscale', 'dscale', 'tscale', 'deband', 'interpolation', 'video-sync',
    'target-colorspace-hint', 'target-trc', 'target-prim', 'target-peak',
    'tone-mapping', 'gamut-mapping-mode', 'glsl-shaders',
    'video-params', 'video-out-params', 'config', 'config-dir',
    'sub-font', 'sub-fonts-dir', 'demuxer-max-bytes'
];
const cacheSnapshotKey = 'user-data/emby-theater-enhanced/diagnostics/cache-bytes';
const pending = new WeakMap();

function readProperty(bridge, target, name, timeoutMs) {
    return new Promise(function (resolve) {
        let timer;
        const scoped = bridge && typeof bridge.addEventListener === 'function';
        const eventTarget = scoped ? bridge : target;
        const eventName = scoped ? 'message' : name;
        function finish(value) {
            clearTimeout(timer);
            eventTarget.removeEventListener(eventName, onValue);
            resolve(value);
        }
        function onValue(event) {
            if (scoped && (!event.data || event.data.type !== 'property_change' || !event.data.data || event.data.data.name !== name)) return;
            const value = scoped ? event.data.data.value : event.detail;
            finish(value == null ? { status: 'unavailable' } : { status: 'ok', value: value });
        }
        eventTarget.addEventListener(eventName, onValue);
        timer = setTimeout(function () { finish({ status: 'timeout' }); }, timeoutMs);
        try {
            if (!bridge) return finish({ status: 'no-player' });
            bridge.postMessage({ type: 'get_property_async', data: name });
        } catch (_) { finish({ status: 'error' }); }
    });
}

async function collectSnapshot(bridge, target, stage, timeoutMs) {
    const values = await Promise.all(properties.map(function (name) {
        return readProperty(bridge, target, name, timeoutMs || 1500);
    }));
    const snapshot = { stage: stage, properties: {} };
    properties.forEach(function (name, index) { snapshot.properties[name] = values[index]; });
    // The legacy PPAPI bridge narrows native int64 nodes to int32. Ask mpv to
    // snapshot this property as text in private transient metadata instead.
    // This never changes the cache option, media, or playback state.
    const raw = snapshot.properties['demuxer-max-bytes'];
    try {
        if (bridge) {
            bridge.postMessage({ type: 'set_property', data: { name: cacheSnapshotKey, value: '' } });
            bridge.postMessage({ type: 'command', data: [
                'expand-properties', 'set', cacheSnapshotKey, '${=demuxer-max-bytes}'
            ] });
            const precise = await readProperty(bridge, target, cacheSnapshotKey, timeoutMs || 1500);
            if (precise.status === 'ok' && typeof precise.value === 'string' && /^\d+$/.test(precise.value) && Number.isSafeInteger(Number(precise.value))) {
                snapshot.properties['demuxer-max-bytes'] = { status: 'ok', value: Number(precise.value), transport: 'mpv-text', legacyValue: raw.value };
            } else {
                snapshot.properties['demuxer-max-bytes'] = { status: 'unavailable', transport: 'legacy-int32-untrusted' };
            }
        }
    } catch (_) {
        snapshot.properties['demuxer-max-bytes'] = { status: 'error' };
    }
    return sanitize(snapshot);
}

function collect(bridge, target, stage, timeoutMs) {
    if (!bridge) return collectSnapshot(bridge, target, stage, timeoutMs);
    // Serialize ready/playing snapshots per embed, so property replies cannot
    // complete the wrong snapshot and the metadata slot stays bounded.
    const previous = pending.get(bridge) || Promise.resolve();
    const current = previous.catch(function () {}).then(function () { return collectSnapshot(bridge, target, stage, timeoutMs); });
    pending.set(bridge, current);
    current.finally(function () { if (pending.get(bridge) === current) pending.delete(bridge); }).catch(function () {});
    return current;
}

function sanitize(snapshot) {
    const output = { stage: ['ready', 'playing'].includes(snapshot && snapshot.stage) ? snapshot.stage : 'unknown', properties: {} };
    properties.forEach(function (name) {
        const entry = snapshot && snapshot.properties && snapshot.properties[name];
        if (!entry) return;
        const status = ['ok', 'unavailable', 'timeout', 'no-player', 'error'].includes(entry.status) ? entry.status : 'error';
        output.properties[name] = { status: status };
        if (name === 'demuxer-max-bytes') {
            if (['mpv-text', 'legacy-int32-untrusted'].includes(entry.transport)) output.properties[name].transport = entry.transport;
            if (Number.isInteger(entry.legacyValue) && entry.legacyValue >= -2147483648 && entry.legacyValue <= 2147483647) output.properties[name].legacyValue = entry.legacyValue;
        }
        if (status !== 'ok') return;
        if (['glsl-shaders', 'config-dir', 'sub-fonts-dir'].includes(name)) {
            output.properties[name].configured = typeof entry.configured === 'boolean' ? entry.configured : (Array.isArray(entry.value) ? entry.value.length > 0 : !!entry.value);
            if (name === 'glsl-shaders') output.properties[name].count = Number.isInteger(entry.count) && entry.count >= 0 ? entry.count : (Array.isArray(entry.value) ? entry.value.length : (entry.value ? 1 : 0));
        } else {
            // Fixed property allowlist; never accept media URLs, headers or file paths.
            const value = JSON.stringify(entry.value);
            if (value && value.length < 4096 && !/(https?:|[A-Za-z]:[\\/]|\\\\|token|password|cookie)/i.test(value)) {
                output.properties[name].value = entry.value;
            }
        }
    });
    return output;
}

function configEvidence(options) {
    try {
        const fs = require('fs');
        const path = require('path');
        const candidates = [];
        function add(source, dir) {
            if (!dir) return;
            const file = path.join(dir, 'mpv.conf');
            const entry = { source: source, exists: fs.existsSync(file) };
            if (entry.exists) entry.sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
            candidates.push(entry);
        }
        add('MPV_HOME', options.mpvHome);
        add('portable_config', path.join(options.executableDir, 'portable_config'));
        add('WindowsKnownFolder', path.join(options.knownFolder, 'mpv'));
        add('executable_directory', options.executableDir);
        add('executable_mpv_directory', path.join(options.executableDir, 'mpv'));
        return { evidence: 'candidate-files-not-load-trace', candidates: candidates,
            environmentMatchesKnownFolder: path.resolve(options.appData || '.') === path.resolve(options.knownFolder) };
    } catch (_) { return { status: 'unavailable' }; }
}

function createLogger(userData) {
    return function (record) {
        try {
            const fs = require('fs');
            const path = require('path');
            fs.mkdirSync(userData, { recursive: true });
            const file = path.join(userData, 'enhanced-diagnostics.jsonl');
            if (fs.existsSync(file) && fs.statSync(file).size > 262144) {
                fs.copyFileSync(file, file + '.1');
                fs.writeFileSync(file, '');
            }
            const line = JSON.stringify(Object.assign({ timestamp: new Date().toISOString() }, record));
            fs.appendFileSync(file, line + '\n');
            console.log('[Enhanced] ' + line);
        } catch (_) { /* Log storage failure is not a playback failure. */ }
    };
}

module.exports = { properties, readProperty, collect, sanitize, configEvidence, createLogger };
