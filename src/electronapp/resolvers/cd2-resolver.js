(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.cd2Resolver = factory();
    }
}(this, function () {
    'use strict';

    var RESOLVE_CHANNEL = 'enhanced-cd2-resolve';
    var CANCEL_CHANNEL = 'enhanced-cd2-cancel';

    function abortError() {
        var error = new Error('Playback source resolution was superseded');
        error.name = 'AbortError';
        return error;
    }

    function getTransport(dependencies) {
        if (dependencies && dependencies.cd2Transport) return dependencies.cd2Transport;
        if (typeof window !== 'undefined' && window.ipc && typeof window.ipc.invoke === 'function') {
            return {
                resolve: function (request) { return window.ipc.invoke(RESOLVE_CHANNEL, request); },
                cancel: function (requestId) { window.ipc.send(CANCEL_CHANNEL, {requestId: requestId}); }
            };
        }
        return null;
    }

    function miss(reason) {
        return {type: 'miss', reason: reason || 'cd2_unavailable', fallback: true};
    }

    function isHttpUrl(value) {
        var parsed;

        if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
        try {
            parsed = new URL(value);
        } catch (error) {
            return false;
        }
        return /^https?:$/.test(parsed.protocol) && !!parsed.hostname && !parsed.username &&
            !parsed.password && !parsed.hash;
    }

    function makeHit(response) {
        var direct = response.sourceKind === 'direct-url';
        var value = {
            type: 'url',
            source: response.source,
            reason: response.reason || (direct ? 'direct_url_hit' : 'cd2_hit'),
            sourceKind: direct ? 'direct-url' : (response.sourceKind || 'cd2-url'),
            fallback: false
        };

        if (direct && response.requestOptions && typeof response.requestOptions === 'object') {
            value.requestOptions = {};
            if (typeof response.requestOptions.userAgent === 'string') {
                value.requestOptions.userAgent = response.requestOptions.userAgent;
            }
            if (!Object.keys(value.requestOptions).length) delete value.requestOptions;
        }
        if (response.acquiredAt !== undefined) value.acquiredAt = response.acquiredAt;
        if (response.expiresAt !== undefined) value.expiresAt = response.expiresAt;
        if (typeof response.directReason === 'string') value.directReason = response.directReason;
        return value;
    }

    async function resolve(context, dependencies) {
        var transport = getTransport(dependencies);
        var requestId = dependencies && dependencies.requestId;
        var candidates = dependencies && dependencies.candidates;
        var signal = dependencies && dependencies.signal;
        var abortListener;
        var response;

        if (!transport || typeof transport.resolve !== 'function') return miss('cd2_unavailable');
        if (typeof requestId !== 'string' || !Array.isArray(candidates) || !candidates.length) return miss('invalid_request');
        if (signal && signal.aborted) throw abortError();

        abortListener = function () {
            if (typeof transport.cancel === 'function') transport.cancel(requestId);
        };
        if (signal) signal.addEventListener('abort', abortListener, {once: true});

        try {
            var request = {
                requestId: requestId,
                candidates: candidates.slice(0, 4)
            };
            if (dependencies && dependencies.ruleId) request.ruleId = dependencies.ruleId;
            if (dependencies && dependencies.mode) request.mode = dependencies.mode;
            if (dependencies && Number.isSafeInteger(dependencies.deadlineAt)) {
                request.deadlineAt = dependencies.deadlineAt;
            }
            response = await transport.resolve(request);
            if (signal && signal.aborted) throw abortError();
            if (response && response.status === 'cancelled') throw abortError();
            if (response && response.status === 'hit' && response.type === 'url' &&
                isHttpUrl(response.source)) {
                return makeHit(response);
            }
            return miss(response && response.reason);
        } catch (error) {
            if ((signal && signal.aborted) || (error && error.name === 'AbortError')) throw abortError();
            return miss('transport_error');
        } finally {
            if (signal) signal.removeEventListener('abort', abortListener);
        }
    }

    return {
        resolve: resolve
    };
}));
