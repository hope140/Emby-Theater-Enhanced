(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./mount-resolver.js', './cd2-resolver.js', './path-rules.js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./mount-resolver'), require('./cd2-resolver'), require('./path-rules'));
    } else {
        root.strmResolver = factory(root.mountResolver, root.cd2Resolver, root.strmPathRules);
    }
}(this, function (mountResolver, cd2Resolver, pathRules) {
    'use strict';

    var DEFAULT_TOTAL_BUDGET_MS = 750;
    var DEFAULT_ORDER = ['direct-url', 'cd2-http', 'mount', 'native'];
    var MOUNT_FIRST_ORDER = ['mount', 'direct-url', 'cd2-http', 'native'];

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

    function prepare(options) {
        var context = normalizeContext(options || {});
        var detected = isStrm(context);
        var playMethod;

        if (!context.item || !context.mediaSource ||
            typeof context.sidecarPath !== 'string' || !context.sidecarPath ||
            typeof context.sourcePath !== 'string' || !context.sourcePath ||
            typeof context.nativeSource !== 'string' || !context.nativeSource) {
            return {context: context, result: nativeResult(context.nativeSource, 'invalid_context', detected)};
        }

        if (!detected) {
            return {context: context, result: nativeResult(context.nativeSource, 'not_strm', false)};
        }

        playMethod = typeof context.playMethod === 'string' ? context.playMethod.toLowerCase() : '';
        if (playMethod === 'transcode') {
            return {context: context, result: nativeResult(context.nativeSource, 'transcode_skip', true)};
        }

        if (playMethod !== 'directplay' && playMethod !== 'directstream') {
            return {context: context, result: nativeResult(context.nativeSource, 'unsupported_play_method', true)};
        }

        return {context: context, result: null};
    }

    function hasPersistentConfig(config) {
        return isObject(config) && Number(config.version) === 1 && Array.isArray(config.rules);
    }

    function selectRule(context, config) {
        var values = [context && context.sourcePath, context && context.sidecarPath];
        var best = null;
        var bestLength = -1;
        var bestValueIndex = values.length;

        if (!hasPersistentConfig(config)) return null;
        config.rules.forEach(function (rule, ruleIndex) {
            var prefix;
            var valueIndex;
            if (!rule || rule.enabled === false || rule.originState === 'DISABLED') return;
            prefix = pathRules.normalizeMappingPrefix(rule.sourcePrefix);
            if (!prefix) return;
            for (valueIndex = 0; valueIndex < values.length; valueIndex++) {
                if (!pathRules.prefixMatches(values[valueIndex], prefix)) continue;
                if (!best || prefix.length > bestLength ||
                    (prefix.length === bestLength && valueIndex < bestValueIndex) ||
                    (prefix.length === bestLength && valueIndex === bestValueIndex && ruleIndex < best.index)) {
                    best = {rule: rule, index: ruleIndex};
                    bestLength = prefix.length;
                    bestValueIndex = valueIndex;
                }
                break;
            }
        });
        return best && best.rule;
    }

    function orderForRule(rule) {
        if (!rule || rule.strategy === 'cloud-first') return DEFAULT_ORDER.slice();
        if (rule.strategy === 'mount-first') return MOUNT_FIRST_ORDER.slice();
        if (rule.strategy === 'custom' && Array.isArray(rule.order) && rule.order.length === 4) {
            return rule.order.slice();
        }
        return DEFAULT_ORDER.slice();
    }

    function persistentNativeResult(context, reason, rule, cd2Reason) {
        var result = nativeResult(context.nativeSource, reason, true);
        if (rule && rule.id) result.ruleId = rule.id;
        if (cd2Reason) result.cd2Reason = cd2Reason;
        return result;
    }

    function resolve(options, dependencies) {
        var prepared = prepare(options);
        var context = prepared.context;
        var config = dependencies && dependencies.config;
        var rule;
        var result;

        if (prepared.result) return prepared.result;

        if (hasPersistentConfig(config)) {
            if (config.enabled === false) return persistentNativeResult(context, 'resolver_disabled');
            rule = selectRule(context, config);
            if (!rule) return persistentNativeResult(context, 'no_matching_rule');
            try {
                result = mountResolver.resolve(context, Object.assign({}, dependencies || {}, {rule: rule}));
                result.isStrm = true;
                result.ruleId = rule.id;
                return result;
            } catch (err) {
                return persistentNativeResult(context, 'native_fallback', rule);
            }
        }

        try {
            result = mountResolver.resolve(context, dependencies);
            result.isStrm = true;
            return result;
        } catch (err) {
            return nativeResult(context.nativeSource, 'native_fallback', true);
        }
    }

    async function resolveAsync(options, dependencies) {
        var prepared = prepare(options);
        var context = prepared.context;
        var config = dependencies && dependencies.config;
        var rule;
        var order;
        var deadlineAt;
        var now;
        var candidates;
        var cd2Reason;
        var result;

        if (prepared.result) return prepared.result;

        if (hasPersistentConfig(config)) {
            if (config.enabled === false) return persistentNativeResult(context, 'resolver_disabled');
            rule = selectRule(context, config);
            if (!rule) return persistentNativeResult(context, 'no_matching_rule');
            order = orderForRule(rule);
            now = dependencies && typeof dependencies.now === 'function' ? dependencies.now : Date.now;
            deadlineAt = now() + DEFAULT_TOTAL_BUDGET_MS;

            try {
                for (var stageIndex = 0; stageIndex < order.length; stageIndex++) {
                    var stage = order[stageIndex];
                    if (stage === 'native') return persistentNativeResult(context, 'native_fallback', rule, cd2Reason);
                    if (stage === 'mount') {
                        result = mountResolver.resolve(context, Object.assign({}, dependencies || {}, {rule: rule}));
                        if (result && result.type === 'local') {
                            result.isStrm = true;
                            result.ruleId = rule.id;
                            return result;
                        }
                        continue;
                    }
                    if (stage === 'direct-url' || stage === 'cd2-http') {
                        if (!candidates) candidates = mountResolver.getCandidates(context, dependencies);
                        if (!candidates.length) continue;
                        result = await cd2Resolver.resolve(context, {
                            cd2Transport: dependencies && dependencies.cd2Transport,
                            requestId: dependencies && dependencies.requestId,
                            signal: dependencies && dependencies.signal,
                            candidates: candidates,
                            ruleId: rule.id,
                            mode: stage === 'direct-url' ? 'direct' : 'same-origin',
                            deadlineAt: deadlineAt
                        });
                        if (result && result.type === 'url') {
                            result.isStrm = true;
                            result.localExists = false;
                            result.ruleId = rule.id;
                            return result;
                        }
                        cd2Reason = result && result.reason;
                    }
                }
                return persistentNativeResult(context, 'native_fallback', rule, cd2Reason);
            } catch (error) {
                if (error && error.name === 'AbortError') throw error;
                return persistentNativeResult(context, 'native_fallback', rule, cd2Reason);
            }
        }

        try {
            candidates = mountResolver.getCandidates(context, dependencies);
            if (candidates.length) {
                result = await cd2Resolver.resolve(context, {
                    cd2Transport: dependencies && dependencies.cd2Transport,
                    requestId: dependencies && dependencies.requestId,
                    signal: dependencies && dependencies.signal,
                    candidates: candidates
                });
                if (result && result.type === 'url') {
                    result.isStrm = true;
                    result.localExists = false;
                    return result;
                }
                cd2Reason = result && result.reason;
            }

            result = mountResolver.resolve(context, dependencies);
            result.isStrm = true;
            if (cd2Reason) result.cd2Reason = cd2Reason;
            return result;
        } catch (error) {
            if (error && error.name === 'AbortError') throw error;
            return nativeResult(context.nativeSource, 'native_fallback', true);
        }
    }

    return {
        isStrm: isStrm,
        selectRule: selectRule,
        orderForRule: orderForRule,
        resolve: resolve,
        resolveAsync: resolveAsync,
        resolveStrm: resolve
    };
}));
