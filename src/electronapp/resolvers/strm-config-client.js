(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.strmResolverConfigClient = factory();
    }
}(this, function () {
    'use strict';

    var CHANNEL = 'enhanced-strm-config-get';
    var cachedConfig = null;
    var hasCachedConfig = false;
    var pending;

    function validConfig(value) {
        return value && typeof value === 'object' &&
            Number(value.version) === 1 &&
            value.cd2 && typeof value.cd2 === 'object' &&
            Array.isArray(value.rules);
    }

    function getConfig(options) {
        var settings = options || {};
        var ipc = settings.ipc || (typeof window !== 'undefined' ? window.ipc : null);
        var timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : 250;
        var timer;
        var request;

        if (hasCachedConfig) return Promise.resolve(cachedConfig);
        if (pending) return pending;
        if (!ipc || typeof ipc.invoke !== 'function') return Promise.resolve(null);

        request = Promise.resolve().then(function () { return ipc.invoke(CHANNEL); });
        pending = new Promise(function (resolve) {
            var settled = false;
            function finish(value) {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (validConfig(value)) {
                    cachedConfig = value;
                    hasCachedConfig = true;
                }
                resolve(validConfig(value) ? value : null);
            }
            timer = setTimeout(function () { finish(null); }, timeoutMs);
            request.then(finish, function () { finish(null); });
        }).then(function (value) {
            pending = null;
            return value;
        });
        return pending;
    }

    function clearCache() {
        cachedConfig = null;
        hasCachedConfig = false;
        pending = null;
    }

    return {
        CHANNEL: CHANNEL,
        clearCache: clearCache,
        get: getConfig,
        validConfig: validConfig
    };
}));
