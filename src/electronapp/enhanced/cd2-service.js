'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_TOTAL_BUDGET_MS = 750;
const CONNECT_BUDGET_MS = 200;
const FIND_BUDGET_MS = 350;
const DOWNLOAD_BUDGET_MS = 300;
const EXPECTED_PROTO_SHA256 = 'dbd103f5530863d7ef3726ef7c39e4a686e960296a750389bbf454cc252accb6';
const PROTO_PATH = path.join(__dirname, 'proto', 'clouddrive-v1.proto');
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function result(status, reason, source) {
    const value = {status: status, reason: reason};
    if (status === 'hit') {
        value.type = 'url';
        value.source = source;
    }
    return value;
}

function isEnabled(value) {
    return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function parseOrigin(value) {
    let parsed;
    try {
        parsed = new URL(String(value || '').trim());
    } catch (error) {
        return null;
    }

    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password ||
        parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
        return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'http:' && hostname !== '127.0.0.1' && hostname !== 'localhost') {
        return null;
    }

    return {
        url: parsed.protocol + '//' + parsed.host,
        target: parsed.host,
        protocol: parsed.protocol,
        hostname: hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    };
}

function splitLocalPath(value) {
    let source = String(value || '').trim().replace(/\//g, '\\');
    let root;
    let rest;

    if (/^[A-Za-z]:$/.test(source)) source += '\\';
    if (/^[A-Za-z]:\\/.test(source)) {
        root = source.slice(0, 3);
        rest = source.slice(3);
    } else {
        const match = /^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/.exec(source);
        if (!match) return null;
        root = '\\\\' + match[1] + '\\' + match[2] + '\\';
        rest = source.slice(match[0].length);
    }

    const parts = rest.split(/\\+/).filter(Boolean);
    if (parts.some(function (part) { return part === '.' || part === '..'; })) return null;
    return {root: root, parts: parts};
}

function normalizeLocalPath(value) {
    const parsed = splitLocalPath(value);
    if (!parsed) return null;
    return parsed.root + parsed.parts.join('\\');
}

function normalizeCloudPath(value) {
    const source = String(value || '').trim().replace(/\\/g, '/');
    const parts = source.split(/\/+/).filter(Boolean);
    if (parts.some(function (part) { return part === '.' || part === '..'; })) return null;
    return '/' + parts.join('/');
}

function mapLocalPath(localPath, localPrefix, cloudPrefix) {
    const local = normalizeLocalPath(localPath);
    const prefix = normalizeLocalPath(localPrefix);
    const cloud = normalizeCloudPath(cloudPrefix);
    let suffix;

    if (!local || !prefix || !cloud) return null;
    if (local.toLowerCase() !== prefix.toLowerCase() &&
        !local.toLowerCase().startsWith(prefix.replace(/\\$/, '').toLowerCase() + '\\')) {
        return null;
    }

    suffix = local.slice(prefix.replace(/\\$/, '').length).replace(/^\\+/, '');
    return normalizeCloudPath(cloud + (suffix ? '/' + suffix.replace(/\\/g, '/') : ''));
}

function readConfig(environment) {
    const env = environment || {};
    const config = {
        enabled: isEnabled(env.ETE_CD2_ENABLED),
        origin: parseOrigin(env.ETE_CD2_ORIGIN),
        token: String(env.ETE_CD2_TOKEN || '').replace(/^Bearer\s+/i, '').trim(),
        localPrefix: normalizeLocalPath(env.ETE_CD2_LOCAL_PREFIX),
        cloudPrefix: normalizeCloudPath(env.ETE_CD2_CLOUD_PREFIX),
        totalBudgetMs: DEFAULT_TOTAL_BUDGET_MS
    };

    if (!config.enabled) config.error = 'disabled';
    else if (!config.origin) config.error = 'invalid_origin';
    else if (!config.token) config.error = 'missing_token';
    else if (!config.localPrefix || !config.cloudPrefix) config.error = 'missing_mapping';
    return config;
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createGrpcTransport(config, options) {
    const protoPath = options.protoPath || PROTO_PATH;
    const expectedHash = options.expectedProtoSha256 || EXPECTED_PROTO_SHA256;
    if (sha256(protoPath) !== expectedHash) throw new Error('proto_integrity');

    const grpc = options.grpc || require('@grpc/grpc-js');
    const protoLoader = options.protoLoader || require('@grpc/proto-loader');
    const definition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    });
    const api = grpc.loadPackageDefinition(definition).clouddrive;
    const credentials = config.origin.protocol === 'https:'
        ? grpc.credentials.createSsl()
        : grpc.credentials.createInsecure();
    const metadata = new grpc.Metadata();
    metadata.set('authorization', 'Bearer ' + config.token);
    return {
        client: new api.CloudDriveFileSrv(config.origin.target, credentials),
        metadata: metadata,
        status: grpc.status
    };
}

function classifyError(error, status) {
    if (!error) return 'rpc_error';
    if (error.localReason) return error.localReason;
    if (status && error.code === status.NOT_FOUND) return 'not_found';
    if (status && error.code === status.DEADLINE_EXCEEDED) return 'timeout';
    if (status && error.code === status.CANCELLED) return 'cancelled';
    if (status && error.code === status.UNAVAILABLE) return 'unavailable';
    return 'rpc_error';
}

function isRegularFile(file) {
    if (!file || typeof file.fullPathName !== 'string' || !file.fullPathName) return false;
    if (file.isDirectory === true || file.fileType === 'Directory' || file.fileType === 0) return false;
    if (file.fileType !== 'File' && file.fileType !== 1) return false;
    if (typeof file.size === 'number') return Number.isFinite(file.size) && file.size >= 0;
    return typeof file.size === 'string' && /^\d+$/.test(file.size);
}

function safeDecodePath(pathname) {
    try {
        return decodeURIComponent(pathname);
    } catch (error) {
        return null;
    }
}

function resolveDownloadUrl(value, origin) {
    let replaced;
    let parsed;
    let decodedPath;

    if (typeof value !== 'string' || !value.trim()) return null;
    replaced = value.trim()
        .replace(/\{SCHEME\}/g, origin.protocol.slice(0, -1))
        .replace(/\{HOST\}/g, origin.target)
        .replace(/\{PREVIEW\}/g, 'false');
    if (/[{}]/.test(replaced)) return null;

    try {
        parsed = new URL(replaced, origin.url + '/');
    } catch (error) {
        return null;
    }

    decodedPath = safeDecodePath(parsed.pathname);
    if (!decodedPath || decodedPath.split('/').some(function (part) { return part === '..'; })) return null;
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return null;
    if (parsed.protocol !== origin.protocol || parsed.hostname.toLowerCase() !== origin.hostname ||
        (parsed.port || (parsed.protocol === 'https:' ? '443' : '80')) !== origin.port) {
        return null;
    }
    return parsed.toString();
}

function createService(options) {
    const settings = options || {};
    const config = settings.config || readConfig(settings.environment || process.env);
    const now = settings.now || Date.now;
    const setTimer = settings.setTimeout || setTimeout;
    const clearTimer = settings.clearTimeout || clearTimeout;
    const transportFactory = settings.transportFactory || createGrpcTransport;
    const active = new Map();
    let transport;
    let transportError;

    function getTransport() {
        if (transportError) throw transportError;
        if (!transport) transport = transportFactory(config, settings);
        return transport;
    }

    function cancel(requestId) {
        const entry = active.get(requestId);
        if (!entry) return false;
        entry.cancelled = true;
        if (entry.call && typeof entry.call.cancel === 'function') entry.call.cancel();
        return true;
    }

    function unary(entry, method, request, deadline) {
        return new Promise(function (resolve) {
            let settled = false;
            let call;
            const remaining = Math.max(0, deadline - now());
            if (remaining <= 0) {
                resolve({error: {localReason: 'timeout'}});
                return;
            }
            const finish = function (value) {
                if (settled) return;
                settled = true;
                clearTimer(timer);
                resolve(value);
            };
            const timer = setTimer(function () {
                if (call && typeof call.cancel === 'function') call.cancel();
                finish({error: {localReason: 'timeout'}});
            }, remaining);

            try {
                const currentTransport = getTransport();
                call = currentTransport.client[method](
                    request,
                    currentTransport.metadata,
                    {deadline: new Date(deadline)},
                    function (error, response) { finish({error: error, response: response}); }
                );
                entry.call = call;
                if (entry.cancelled && call && typeof call.cancel === 'function') call.cancel();
            } catch (error) {
                finish({error: error});
            }
        });
    }

    function waitForReady(entry, deadline) {
        return new Promise(function (resolve) {
            if (entry.cancelled) return resolve({error: {localReason: 'cancelled'}});
            if (deadline <= now()) return resolve({error: {localReason: 'timeout'}});
            try {
                getTransport().client.waitForReady(new Date(deadline), function (error) {
                    if (entry.cancelled) resolve({error: {localReason: 'cancelled'}});
                    else resolve(error ? {error: {localReason: 'unavailable'}} : {});
                });
            } catch (error) {
                resolve({error: {localReason: 'client_unavailable'}});
            }
        });
    }

    async function resolve(request) {
        const requestId = request && request.requestId;
        const candidates = request && request.candidates;
        let cloudPath;
        let entry;
        let start;
        let overallDeadline;
        let reply;
        let reason;

        if (config.error) return result('miss', config.error);
        if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return result('miss', 'invalid_request');
        if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 4) return result('miss', 'invalid_candidates');

        for (const candidate of candidates) {
            if (typeof candidate !== 'string' || candidate.length > 32768) return result('miss', 'invalid_candidates');
            cloudPath = mapLocalPath(candidate, config.localPrefix, config.cloudPrefix);
            if (cloudPath) break;
        }
        if (!cloudPath) return result('miss', 'mapping_miss');

        cancel(requestId);
        entry = {cancelled: false, call: null};
        active.set(requestId, entry);
        start = now();
        overallDeadline = start + config.totalBudgetMs;

        try {
            reply = await waitForReady(entry, Math.min(overallDeadline, start + CONNECT_BUDGET_MS));
            if (entry.cancelled) return result('cancelled', 'cancelled');
            if (reply.error) return result('miss', reply.error.localReason);

            reply = await unary(entry, 'FindFileByPath', {parentPath: '', path: cloudPath}, Math.min(overallDeadline, start + FIND_BUDGET_MS));
            if (entry.cancelled) return result('cancelled', 'cancelled');
            reason = classifyError(reply.error, getTransport().status);
            if (reply.error) return result('miss', reason);
            if (!isRegularFile(reply.response)) return result('miss', 'invalid_file');

            reply = await unary(entry, 'GetDownloadUrlPath', {
                path: cloudPath,
                preview: false,
                lazy_read: false,
                get_direct_url: false
            }, Math.min(overallDeadline, now() + DOWNLOAD_BUDGET_MS));
            if (entry.cancelled) return result('cancelled', 'cancelled');
            reason = classifyError(reply.error, getTransport().status);
            if (reply.error) return result('miss', reason);
            if (!reply.response || reply.response.directUrl || reply.response.externalUrl) return result('miss', 'unsupported_response');

            const source = resolveDownloadUrl(reply.response.downloadUrlPath, config.origin);
            return source ? result('hit', 'cd2_hit', source) : result('miss', 'invalid_download_url');
        } catch (error) {
            return result('miss', error && error.message === 'proto_integrity' ? 'proto_integrity' : 'client_unavailable');
        } finally {
            if (active.get(requestId) === entry) active.delete(requestId);
        }
    }

    function close() {
        for (const requestId of active.keys()) cancel(requestId);
        active.clear();
        if (transport && transport.client && typeof transport.client.close === 'function') transport.client.close();
    }

    if (!config.error) {
        try {
            getTransport();
        } catch (error) {
            transportError = error;
        }
    }

    return {
        resolve: resolve,
        cancel: cancel,
        close: close,
        configState: function () { return config.error || 'ready'; }
    };
}

module.exports = {
    EXPECTED_PROTO_SHA256: EXPECTED_PROTO_SHA256,
    createService: createService,
    mapLocalPath: mapLocalPath,
    normalizeCloudPath: normalizeCloudPath,
    normalizeLocalPath: normalizeLocalPath,
    parseOrigin: parseOrigin,
    readConfig: readConfig,
    resolveDownloadUrl: resolveDownloadUrl
};
