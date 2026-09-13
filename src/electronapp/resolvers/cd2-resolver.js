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
            response = await transport.resolve({requestId: requestId, candidates: candidates.slice(0, 4)});
            if (signal && signal.aborted) throw abortError();
            if (response && response.status === 'cancelled') throw abortError();
            if (response && response.status === 'hit' && response.type === 'url' &&
                typeof response.source === 'string' && /^https?:\/\//i.test(response.source)) {
                return {type: 'url', source: response.source, reason: 'cd2_hit', fallback: false};
            }
            return miss(response && response.reason);
        } finally {
            if (signal) signal.removeEventListener('abort', abortListener);
        }
    }

    return {
        resolve: resolve
    };
}));
