'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
const LOG_FILE_NAME = 'ete-client.jsonl';
const LOG_ROTATION_COUNT = 3;
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const DISPLAY_LOG_DIRECTORY = '%APPDATA%\\EmbyTheaterEnhanced\\logs';
const MAX_STRING_LENGTH = 4096;
const MAX_ARRAY_LENGTH = 64;
const MAX_OBJECT_KEYS = 96;
const pending = new WeakMap();

const SENSITIVE_KEY_PATTERN = /(?:token|api[_-]?key|authorization|bearer|password|cookie|secret|credential|access[_-]?key)/i;
const IDENTIFIER_KEYS = Object.freeze({
    deviceid: 'deviceIdHash',
    devicename: 'deviceNameHash',
    sessionid: 'sessionIdHash',
    playsessionid: 'playSessionIdHash'
});
const LOCATION_KEYS = Object.freeze({
    candidate: true,
    candidates: true,
    path: true,
    filepath: true,
    localpath: true,
    cloudpath: true,
    mappedpath: true,
    source: true,
    sourcepath: true,
    sidecarpath: true,
    nativesource: true,
    url: true,
    directurl: true,
    downloadurl: true,
    mediaurl: true,
    origin: true,
    configdir: true,
    subfontsdir: true,
    mpvhome: true
});
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|]+/g;
const POSIX_PATH_PATTERN = /(^|[\s=(,:])\/(?!\/)(?:[^\s"'<>|]+\/)*[^\s"'<>|]+/g;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /((?:authorization|x-emby-token|api[_-]?key|access[_-]?token|token|password|cookie|secret)\s*[:=]\s*)[^\s,;&]+/gi;

function hashText(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 16);
}

function normalizePathForHash(value) {
    let normalized = String(value == null ? '' : value).trim().replace(/\u0000/g, '').replace(/\\/g, '/');
    normalized = normalized.replace(/\/{2,}/g, '/');
    if (/^(?:[a-z]:|\/)/i.test(normalized)) normalized = normalized.toLowerCase();
    return normalized;
}

function hashPath(value) {
    return hashText(normalizePathForHash(value));
}

function hashHost(value) {
    return hashText(String(value == null ? '' : value).trim().toLowerCase());
}

function hashIdentifier(value) {
    return hashText(String(value == null ? '' : value).trim());
}

function getLogPaths(logRoot) {
    const root = path.resolve(String(logRoot || path.join(process.env.APPDATA || process.cwd(), 'EmbyTheaterEnhanced')));
    const directory = path.join(root, 'logs');
    const file = path.join(directory, LOG_FILE_NAME);
    const rotations = [];
    for (let index = 1; index <= LOG_ROTATION_COUNT; index++) rotations.push(file + '.' + index);
    return {root, directory, file, rotations};
}

function summarizeUrl(value) {
    let parsed;
    try {
        parsed = new URL(String(value));
    } catch (_) {
        return null;
    }
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
    return {protocol: parsed.protocol.slice(0, -1), hostHash: hashHost(parsed.hostname)};
}

function truncate(value) {
    const text = String(value);
    return text.length <= MAX_STRING_LENGTH ? text : text.slice(0, MAX_STRING_LENGTH) + '...[truncated]';
}

function formatUrlForText(value) {
    const original = String(value);
    const trailing = original.match(/[),.;!?]+$/);
    const candidate = trailing ? original.slice(0, -trailing[0].length) : original;
    const summary = summarizeUrl(candidate);
    const suffix = trailing ? trailing[0] : '';
    return summary
        ? '[url protocol=' + summary.protocol + ' hostHash=' + summary.hostHash + ']' + suffix
        : '[url-redacted]' + suffix;
}

function sanitizeText(value) {
    let output = String(value == null ? '' : value);
    output = output.replace(URL_PATTERN, formatUrlForText);
    output = output.replace(WINDOWS_PATH_PATTERN, function (match) {
        return '[pathHash=' + hashPath(match) + ']';
    });
    output = output.replace(POSIX_PATH_PATTERN, function (match, prefix) {
        const rawPath = match.slice(prefix.length);
        return prefix + '[pathHash=' + hashPath(rawPath) + ']';
    });
    output = output.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
    output = output.replace(SECRET_ASSIGNMENT_PATTERN, '$1[REDACTED]');
    return truncate(output);
}

function normalizedKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function safeKey(value) {
    const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 96);
    return text || 'field';
}

function safeLabel(value, fallback) {
    const text = String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return text || fallback;
}

function sanitizeLocation(value, key, seen) {
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_LENGTH).map(function (entry) {
            return sanitizeLocation(entry, key, seen);
        });
    }
    if (typeof value !== 'string') return sanitizeValue(value, 'locationValue', seen);
    const summary = summarizeUrl(value);
    if (summary) return summary;
    return {pathHash: hashPath(value)};
}

function sanitizeValue(value, key, seen) {
    const normalized = normalizedKey(key);
    if (value === undefined) return null;
    if (value === null) return null;
    if (SENSITIVE_KEY_PATTERN.test(normalized)) return '[REDACTED]';
    if (IDENTIFIER_KEYS[normalized]) return {[IDENTIFIER_KEYS[normalized]]: hashIdentifier(value)};
    if (normalized === 'mappedpath') return {mappedPathHash: hashPath(value)};
    if (LOCATION_KEYS[normalized]) return sanitizeLocation(value, normalized, seen);
    if (typeof value === 'string') return sanitizeText(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return '[unavailable]';
    if (value instanceof Error) {
        return sanitizeValue({name: value.name, message: value.message, stack: value.stack}, 'error', seen);
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        const output = value.slice(0, MAX_ARRAY_LENGTH).map(function (entry) {
            return sanitizeValue(entry, key, seen);
        });
        seen.delete(value);
        if (value.length > MAX_ARRAY_LENGTH) output.push('[truncated]');
        return output;
    }
    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        const output = {};
        let keys;
        try {
            keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
        } catch (_) {
            seen.delete(value);
            return '[unavailable]';
        }
        keys.forEach(function (field) {
            let entry;
            try {
                entry = value[field];
            } catch (_) {
                entry = '[unavailable]';
            }
            const fieldKey = normalizedKey(field);
            const identifierKey = IDENTIFIER_KEYS[fieldKey];
            if (SENSITIVE_KEY_PATTERN.test(fieldKey)) {
                output[safeKey(field)] = '[REDACTED]';
            } else if (identifierKey) {
                output[identifierKey] = hashIdentifier(entry);
            } else if (fieldKey === 'mappedpath') {
                output.mappedPathHash = hashPath(entry);
            } else {
                output[safeKey(field)] = LOCATION_KEYS[fieldKey]
                    ? sanitizeLocation(entry, fieldKey, seen)
                    : sanitizeValue(entry, fieldKey, seen);
            }
        });
        if (Object.keys(value).length > MAX_OBJECT_KEYS) output._truncated = true;
        seen.delete(value);
        return output;
    }
    return sanitizeText(value);
}

function sanitizeSnapshot(snapshot) {
    const output = {
        stage: ['ready', 'playing'].includes(snapshot && snapshot.stage) ? snapshot.stage : 'unknown',
        properties: {}
    };
    properties.forEach(function (name) {
        let entry;
        try { entry = snapshot && snapshot.properties && snapshot.properties[name]; } catch (_) { entry = null; }
        if (!entry || typeof entry !== 'object') return;
        const rawStatus = entry.status;
        const status = ['ok', 'unavailable', 'timeout', 'no-player', 'error'].includes(rawStatus) ? rawStatus : 'error';
        output.properties[name] = {status: status};
        if (name === 'demuxer-max-bytes') {
            if (['mpv-text', 'legacy-int32-untrusted'].includes(entry.transport)) output.properties[name].transport = entry.transport;
            if (Number.isInteger(entry.legacyValue) && entry.legacyValue >= -2147483648 && entry.legacyValue <= 2147483647) {
                output.properties[name].legacyValue = entry.legacyValue;
            }
        }
        if (status !== 'ok') return;
        if (['glsl-shaders', 'config-dir', 'sub-fonts-dir'].includes(name)) {
            output.properties[name].configured = typeof entry.configured === 'boolean'
                ? entry.configured
                : (Array.isArray(entry.value) ? entry.value.length > 0 : !!entry.value);
            if (name === 'glsl-shaders') {
                output.properties[name].count = Number.isInteger(entry.count) && entry.count >= 0
                    ? entry.count
                    : (Array.isArray(entry.value) ? entry.value.length : (entry.value ? 1 : 0));
            }
        } else {
            const value = sanitizeValue(entry.value, name, new WeakSet());
            let serialized;
            try { serialized = JSON.stringify(value); } catch (_) { serialized = ''; }
            if (serialized && serialized.length < MAX_STRING_LENGTH) output.properties[name].value = value;
        }
    });
    return output;
}

function sanitize(snapshot) {
    return sanitizeSnapshot(snapshot);
}

function sanitizeRecord(record) {
    let input = record;
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {details: {message: input}};
    let timestamp = input.timestamp;
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) timestamp = new Date().toISOString();
    const output = {
        schemaVersion: 1,
        timestamp: timestamp,
        level: ['info', 'warn', 'error'].includes(input.level) ? input.level : 'info',
        category: safeLabel(input.category || 'app', 'app'),
        event: safeLabel(input.event || input.stage || 'event', 'event'),
        details: null
    };
    let rawDetails;
    if (Object.prototype.hasOwnProperty.call(input, 'details')) {
        rawDetails = input.details;
    } else {
        rawDetails = {};
        Object.keys(input).forEach(function (key) {
            if (!['schemaVersion', 'timestamp', 'level', 'category', 'event'].includes(key)) rawDetails[key] = input[key];
        });
    }
    const details = sanitizeValue(rawDetails, 'details', new WeakSet());
    output.details = details && typeof details === 'object' ? details : {value: details};
    return output;
}

function configEvidence(options) {
    try {
        const settings = options || {};
        const candidates = [];
        function add(source, dir) {
            if (!dir) return;
            const file = path.join(dir, 'mpv.conf');
            const entry = {source: source, exists: fs.existsSync(file)};
            if (entry.exists) entry.sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
            candidates.push(entry);
        }
        add('MPV_HOME', settings.mpvHome);
        add('portable_config', path.join(settings.executableDir || '.', 'portable_config'));
        add('WindowsKnownFolder', path.join(settings.knownFolder || '.', 'mpv'));
        add('executable_directory', settings.executableDir);
        add('executable_mpv_directory', path.join(settings.executableDir || '.', 'mpv'));
        return {
            evidence: 'candidate-files-not-load-trace',
            candidates: candidates,
            environmentMatchesKnownFolder: path.resolve(settings.appData || '.') === path.resolve(settings.knownFolder || '.')
        };
    } catch (_) {
        return {status: 'unavailable'};
    }
}

function readProperty(bridge, target, name, timeoutMs) {
    return new Promise(function (resolve) {
        let timer;
        const scoped = bridge && typeof bridge.addEventListener === 'function';
        const eventTarget = scoped ? bridge : target;
        const eventName = scoped ? 'message' : name;
        let finished = false;
        function finish(value) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { eventTarget.removeEventListener(eventName, onValue); } catch (_) { }
            resolve(value);
        }
        function onValue(event) {
            if (scoped && (!event.data || event.data.type !== 'property_change' || !event.data.data || event.data.data.name !== name)) return;
            const value = scoped ? event.data.data.value : event.detail;
            finish(value == null ? {status: 'unavailable'} : {status: 'ok', value: value});
        }
        if (!eventTarget || typeof eventTarget.addEventListener !== 'function') return finish({status: 'no-player'});
        try { eventTarget.addEventListener(eventName, onValue); } catch (_) { return finish({status: 'error'}); }
        timer = setTimeout(function () { finish({status: 'timeout'}); }, Number(timeoutMs) > 0 ? timeoutMs : 1500);
        try {
            if (!bridge || typeof bridge.postMessage !== 'function') return finish({status: 'no-player'});
            bridge.postMessage({type: 'get_property_async', data: name});
        } catch (_) { finish({status: 'error'}); }
    });
}

async function collectSnapshot(bridge, target, stage, timeoutMs) {
    const values = await Promise.all(properties.map(function (name) {
        return readProperty(bridge, target, name, timeoutMs || 1500);
    }));
    const snapshot = {stage: stage, properties: {}};
    properties.forEach(function (name, index) { snapshot.properties[name] = values[index]; });
    const raw = snapshot.properties['demuxer-max-bytes'];
    try {
        if (bridge) {
            bridge.postMessage({type: 'set_property', data: {name: cacheSnapshotKey, value: ''}});
            bridge.postMessage({type: 'command', data: [
                'expand-properties', 'set', cacheSnapshotKey, '${=demuxer-max-bytes}'
            ]});
            const precise = await readProperty(bridge, target, cacheSnapshotKey, timeoutMs || 1500);
            if (precise.status === 'ok' && typeof precise.value === 'string' && /^\d+$/.test(precise.value) && Number.isSafeInteger(Number(precise.value))) {
                snapshot.properties['demuxer-max-bytes'] = {
                    status: 'ok',
                    value: Number(precise.value),
                    transport: 'mpv-text',
                    legacyValue: raw && raw.value
                };
            } else {
                snapshot.properties['demuxer-max-bytes'] = {status: 'unavailable', transport: 'legacy-int32-untrusted'};
            }
        }
    } catch (_) {
        snapshot.properties['demuxer-max-bytes'] = {status: 'error'};
    }
    return sanitizeSnapshot(snapshot);
}

function collect(bridge, target, stage, timeoutMs) {
    if (!bridge) return collectSnapshot(bridge, target, stage, timeoutMs);
    const previous = pending.get(bridge) || Promise.resolve();
    const current = previous.catch(function () {}).then(function () { return collectSnapshot(bridge, target, stage, timeoutMs); });
    pending.set(bridge, current);
    current.finally(function () { if (pending.get(bridge) === current) pending.delete(bridge); }).catch(function () {});
    return current;
}

function asyncFsCall(fileSystem, method, args) {
    const promises = fileSystem && fileSystem.promises;
    if (!promises || typeof promises[method] !== 'function') return Promise.reject(new Error('async_fs_unavailable'));
    return promises[method].apply(promises, args);
}

async function unlinkIfPresent(fileSystem, file) {
    try {
        await asyncFsCall(fileSystem, 'unlink', [file]);
    } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
    }
}

async function rotateLogFiles(fileSystem, paths) {
    await unlinkIfPresent(fileSystem, paths.rotations[paths.rotations.length - 1]);
    for (let index = paths.rotations.length - 1; index >= 0; index--) {
        const from = index === 0 ? paths.file : paths.rotations[index - 1];
        const to = paths.rotations[index];
        try {
            await asyncFsCall(fileSystem, 'rename', [from, to]);
        } catch (error) {
            if (!error || error.code !== 'ENOENT') throw error;
        }
    }
}

function createLogger(logRoot, options) {
    const settings = options || {};
    const fileSystem = settings.fs || fs;
    const paths = getLogPaths(logRoot);
    let queue = Promise.resolve();

    async function appendLine(line) {
        await asyncFsCall(fileSystem, 'mkdir', [paths.directory, {recursive: true}]);
        let currentSize = 0;
        try {
            currentSize = (await asyncFsCall(fileSystem, 'stat', [paths.file])).size || 0;
        } catch (_) { }
        if (currentSize >= LOG_MAX_BYTES) {
            try { await rotateLogFiles(fileSystem, paths); } catch (_) { /* Rotation is fail-open. */ }
        }
        await asyncFsCall(fileSystem, 'appendFile', [paths.file, line + '\n', 'utf8']);
        return true;
    }

    function log(record) {
        let line;
        try { line = JSON.stringify(sanitizeRecord(record)); } catch (_) { return Promise.resolve(false); }
        const operation = queue.catch(function () {}).then(function () { return appendLine(line); });
        queue = operation.catch(function () { return false; });
        return operation.catch(function () { return false; });
    }

    log.flush = function () { return queue.catch(function () {}); };
    log.getPaths = function () { return Object.assign({}, paths, {rotations: paths.rotations.slice()}); };
    log.status = async function () {
        await log.flush();
        let currentBytes = 0;
        try { currentBytes = (await asyncFsCall(fileSystem, 'stat', [paths.file])).size || 0; } catch (_) { }
        return {
            enabled: true,
            logDirectory: DISPLAY_LOG_DIRECTORY,
            fileName: LOG_FILE_NAME,
            rotationFiles: LOG_ROTATION_COUNT,
            maxBytes: LOG_MAX_BYTES,
            currentBytes: currentBytes
        };
    };
    log.clear = function () {
        const operation = queue.catch(function () {}).then(async function () {
            for (const file of [paths.file].concat(paths.rotations)) await unlinkIfPresent(fileSystem, file);
            return true;
        });
        queue = operation.catch(function () { return false; });
        return operation.catch(function () { return false; });
    };
    log.readRecords = async function () {
        await log.flush();
        return readLogRecordsFromPaths(paths, fileSystem);
    };
    log.exportReport = async function (appInfo, exportTime) {
        const read = await log.readRecords();
        return buildDiagnosticReport(read, appInfo, exportTime);
    };
    return log;
}

async function readLogRecordsFromPaths(paths, fileSystem) {
    const records = [];
    let malformedLines = 0;
    const files = paths.rotations.slice().reverse().concat([paths.file]);
    for (const file of files) {
        let text;
        try {
            text = await asyncFsCall(fileSystem, 'readFile', [file, 'utf8']);
        } catch (error) {
            if (error && error.code === 'ENOENT') continue;
            throw error;
        }
        String(text).split(/\r?\n/).forEach(function (line) {
            if (!line.trim()) return;
            try {
                const parsed = JSON.parse(line);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_record');
                records.push(sanitizeRecord(parsed));
            } catch (_) {
                malformedLines++;
            }
        });
    }
    return {records: records, malformedLines: malformedLines};
}

async function readLogRecords(logRoot, options) {
    const settings = options || {};
    return readLogRecordsFromPaths(getLogPaths(logRoot), settings.fs || fs);
}

function recordDetails(record) {
    return record && record.details && typeof record.details === 'object' ? record.details : {};
}

function sameRequest(record, requestId) {
    if (!requestId) return true;
    const details = recordDetails(record);
    return String(details.requestId || details.playRequestId || '') === String(requestId);
}

function latestRecord(records, predicate) {
    for (let index = records.length - 1; index >= 0; index--) {
        if (predicate(records[index])) return records[index];
    }
    return null;
}

function routeForRecord(record) {
    const details = recordDetails(record);
    if (details.route === 'direct-url') return 'DIRECT URL';
    if (details.route === 'cd2-http') return 'CD2 HTTP';
    if (details.route === 'mount') return 'MOUNT';
    if (details.route === 'native') return 'NATIVE FALLBACK';
    return 'UNKNOWN';
}

function resultText(record) {
    if (!record) return 'UNKNOWN';
    const details = recordDetails(record);
    const reason = details.reason ? sanitizeText(details.reason) : '';
    if (record.event === 'resolve-hit') return 'HIT';
    if (record.event === 'resolve-miss') return reason ? 'MISS: ' + reason : 'MISS';
    if (record.event === 'resolve-error') return reason ? 'ERROR: ' + reason : 'ERROR';
    if (record.event === 'resolve-cancelled') return 'CANCELLED';
    return 'UNKNOWN';
}

function buildDiagnosticReport(input, appInfo, exportTime) {
    const read = Array.isArray(input) ? {records: input, malformedLines: 0} : (input || {records: [], malformedLines: 0});
    const records = Array.isArray(read.records) ? read.records.map(sanitizeRecord) : [];
    const info = appInfo || {};
    const routeRecord = latestRecord(records, function (record) {
        return record.category === 'resolver' && record.event === 'route-selected';
    });
    const routeDetails = recordDetails(routeRecord);
    const requestId = routeDetails.requestId || routeDetails.playRequestId || null;
    const cd2Record = latestRecord(records, function (record) {
        return record.category === 'cd2' && ['resolve-hit', 'resolve-miss', 'resolve-error', 'resolve-cancelled'].includes(record.event) && sameRequest(record, requestId);
    });
    const mountRecord = latestRecord(records, function (record) {
        return record.category === 'mount' && ['resolve-hit', 'resolve-miss', 'resolve-error', 'resolve-cancelled'].includes(record.event) && sameRequest(record, requestId);
    });
    const playbackRecord = latestRecord(records, function (record) {
        return record.category === 'playback' && ['core-playing', 'pause', 'resume', 'stop', 'playback-error'].includes(record.event) && sameRequest(record, requestId);
    });
    const coreRecord = latestRecord(records, function (record) {
        return record.category === 'playback' && record.event === 'core-playing' && sameRequest(record, requestId);
    });
    const playbackError = latestRecord(records, function (record) {
        return record.category === 'playback' && record.event === 'playback-error' && sameRequest(record, requestId);
    });
    const route = routeForRecord(routeRecord);
    const cd2Text = cd2Record ? resultText(cd2Record) : (routeRecord ? 'NOT REACHED' : 'UNKNOWN');
    const mountText = mountRecord ? resultText(mountRecord) : (routeRecord ? 'NOT REACHED' : 'UNKNOWN');
    const corePlaying = coreRecord ? 'YES' : (playbackError ? 'NO' : 'UNKNOWN');
    let playbackText = 'UNKNOWN';
    if (playbackRecord) {
        if (playbackRecord.event === 'core-playing') playbackText = 'CORE PLAYING';
        else if (playbackRecord.event === 'playback-error') playbackText = 'ERROR: ' + (recordDetails(playbackRecord).message ? sanitizeText(recordDetails(playbackRecord).message) : 'unknown');
        else if (playbackRecord.event === 'stop') playbackText = 'STOPPED';
    }
    const nativeFallback = route === 'NATIVE FALLBACK' ? 'YES' : (route === 'UNKNOWN' ? 'UNKNOWN' : 'NO');
    const exportStamp = exportTime instanceof Date ? exportTime : new Date(exportTime || Date.now());
    const exportIso = Number.isFinite(exportStamp.getTime()) ? exportStamp.toISOString() : new Date().toISOString();
    const lines = [
        '==================================================',
        'Emby Theater Enhanced Diagnostic Report',
        '==================================================',
        '',
        'App Version: ' + sanitizeText(info.appVersion || 'UNKNOWN'),
        'Build Commit: ' + sanitizeText(info.buildCommit || 'UNKNOWN'),
        'Platform: ' + sanitizeText(info.platform || 'UNKNOWN'),
        'Arch: ' + sanitizeText(info.arch || 'UNKNOWN'),
        'Electron: ' + sanitizeText(info.electron || 'UNKNOWN'),
        'Chromium: ' + sanitizeText(info.chromium || 'UNKNOWN'),
        'Node: ' + sanitizeText(info.node || 'UNKNOWN'),
        'Export Time: ' + exportIso,
        'DeviceId Hash: ' + sanitizeText(info.deviceIdHash || 'UNKNOWN'),
        '',
        '==================================================',
        'Resolver Summary',
        '==================================================',
        '',
        'Last STRM Route: ' + route,
        'Last Resolver Reason: ' + sanitizeText(routeDetails.reason || 'UNKNOWN'),
        'Last CD2 Result: ' + cd2Text,
        'Last Mount Result: ' + mountText,
        'Native Fallback: ' + nativeFallback,
        'Last Playback Result: ' + playbackText,
        'Playback Core Playing: ' + corePlaying,
        '',
        '==================================================',
        'Client Log',
        '==================================================',
        'Malformed JSONL lines omitted: ' + String(Number(read.malformedLines) || 0)
    ];
    if (!records.length) lines.push('(no log entries)');
    else records.forEach(function (record) { lines.push(JSON.stringify(record)); });
    lines.push('');
    return lines.join('\r\n');
}

function makeExportFileName(date) {
    const value = date instanceof Date ? date : new Date(date || Date.now());
    function pad(number) { return String(number).padStart(2, '0'); }
    return 'EmbyTheaterEnhanced-Diagnostics-' + value.getFullYear() + pad(value.getMonth() + 1) + pad(value.getDate()) + '-' +
        pad(value.getHours()) + pad(value.getMinutes()) + pad(value.getSeconds()) + '.txt';
}

module.exports = {
    DISPLAY_LOG_DIRECTORY,
    LOG_FILE_NAME,
    LOG_MAX_BYTES,
    LOG_ROTATION_COUNT,
    properties,
    readProperty,
    collect,
    sanitize,
    sanitizeValue,
    sanitizeRecord,
    configEvidence,
    createLogger,
    getLogPaths,
    readLogRecords,
    buildDiagnosticReport,
    makeExportFileName,
    hashPath,
    hashHost,
    hashIdentifier
};
