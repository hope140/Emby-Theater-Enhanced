(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./mount-resolver.js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./mount-resolver'));
    } else {
        root.strmResolver = factory(root.mountResolver);
    }
}(this, function (mountResolver) {
    'use strict';

    function isObject(value) {
        return value !== null && typeof value === 'object';
    }

    function normalizeContext(options) {
        var item = options && isObject(options.item) ? options.item : null;
        var mediaSource = options && isObject(options.mediaSource) ? options.mediaSource : null;
        var streamInfo = options && options.streamInfo ? options.streamInfo : options;

        return {
            item: item,
            mediaSource: mediaSource,
            streamInfo: streamInfo,
            sidecarPath: options && options.sidecarPath !== undefined
                ? options.sidecarPath
                : item && item.Path,
            sourcePath: options && options.sourcePath !== undefined
                ? options.sourcePath
                : mediaSource && mediaSource.Path,
            nativeSource: options && options.nativeSource !== undefined
                ? options.nativeSource
                : options && options.url,
            playMethod: options && options.playMethod !== undefined
                ? options.playMethod
                : streamInfo && streamInfo.playMethod
        };
    }

    function isStrm(options) {
        try {
            var context = options && options.item !== undefined
                ? normalizeContext(options)
                : options || {};
            var itemPath = context.sidecarPath;
            var container = context.mediaSource && context.mediaSource.Container;

            return (
                typeof itemPath === 'string' && itemPath.toLowerCase().endsWith('.strm')
            ) || String(container || '').toLowerCase() === 'strm';
        } catch (err) {
            return false;
        }
    }

    function nativeResult(nativeSource, reason, detected) {
        return {
            type: 'native',
            source: nativeSource,
            reason: reason,
            isStrm: detected === true,
            localExists: false,
            fallback: true
        };
    }

    function resolve(options, dependencies) {
        var context = normalizeContext(options || {});
        var detected = isStrm(context);
        var playMethod;
        var result;

        if (!context.item || !context.mediaSource ||
            typeof context.sidecarPath !== 'string' || !context.sidecarPath ||
            typeof context.sourcePath !== 'string' || !context.sourcePath ||
            typeof context.nativeSource !== 'string' || !context.nativeSource) {
            return nativeResult(context.nativeSource, 'invalid_context', detected);
        }

        if (!detected) {
            return nativeResult(context.nativeSource, 'not_strm', false);
        }

        playMethod = typeof context.playMethod === 'string' ? context.playMethod.toLowerCase() : '';
        if (playMethod === 'transcode') {
            return nativeResult(context.nativeSource, 'transcode_skip', true);
        }

        if (playMethod !== 'directplay' && playMethod !== 'directstream') {
            return nativeResult(context.nativeSource, 'unsupported_play_method', true);
        }

        try {
            result = mountResolver.resolve(context, dependencies);
            result.isStrm = true;
            return result;
        } catch (err) {
            return nativeResult(context.nativeSource, 'native_fallback', true);
        }
    }

    return {
        isStrm: isStrm,
        resolve: resolve,
        resolveStrm: resolve
    };
}));
