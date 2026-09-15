(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.strmPathRules = factory();
    }
}(this, function () {
    'use strict';

    function text(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function isPosixPath(value) {
        return typeof value === 'string' && /^\/(?!\/)/.test(value);
    }

    function looksLikeWindowsPath(value) {
        return typeof value === 'string' && (
            /^[A-Za-z]:[\\/]/.test(value) ||
            /^[A-Za-z]:$/.test(value) ||
            /^\\\\/.test(value) ||
            /^\/\/[^\/]/.test(value)
        );
    }

    function hasUnsafeSegment(parts) {
        return parts.some(function (part) {
            return part === '.' || part === '..';
        });
    }

    function normalizePosix(value) {
        var source = text(value).replace(/\\/g, '/');
        var parts;

        if (!source || !isPosixPath(source) || /[\u0000-\u001f\u007f]/.test(source)) return null;
        parts = source.split(/\/+/).filter(Boolean);
        if (hasUnsafeSegment(parts)) return null;
        return parts.length ? '/' + parts.join('/') : '/';
    }

    function normalizeWindows(value) {
        var source = text(value).replace(/\//g, '\\');
        var root;
        var rest;
        var match;
        var parts;

        if (!source || /[\u0000-\u001f\u007f]/.test(source)) return null;
        if (/^[A-Za-z]:$/.test(source)) source += '\\';

        if (/^[A-Za-z]:\\/.test(source)) {
            root = source.slice(0, 3);
            rest = source.slice(3);
        } else {
            match = /^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/.exec(source);
            if (!match) return null;
            root = '\\\\' + match[1] + '\\' + match[2] + '\\';
            rest = source.slice(match[0].length);
        }

        parts = rest.split(/\\+/).filter(Boolean);
        if (hasUnsafeSegment(parts)) return null;
        return root + parts.join('\\');
    }

    function normalizePath(value) {
        if (isPosixPath(value)) return normalizePosix(value);
        if (looksLikeWindowsPath(value)) return normalizeWindows(value);
        return null;
    }

    function normalizeMappingPrefix(value) {
        return normalizePath(value);
    }

    function normalizeCloudPrefix(value) {
        return normalizePosix(value);
    }

    function kind(value) {
        if (isPosixPath(value)) return 'posix';
        if (looksLikeWindowsPath(value)) return 'windows';
        return null;
    }

    function withoutTrailingSeparator(value) {
        if (value === '/' || /^[A-Za-z]:\\$/.test(value)) return value;
        if (/^\\\\[^\\]+\\[^\\]+\\$/.test(value)) return value;
        return value.replace(/[\\/]$/, '');
    }

    function prefixMatches(candidate, prefix) {
        var normalizedCandidate = normalizePath(candidate);
        var normalizedPrefix = normalizePath(prefix);
        var candidateKind;
        var prefixKind;
        var candidateComparable;
        var prefixComparable;

        if (!normalizedCandidate || !normalizedPrefix) return false;
        candidateKind = kind(normalizedCandidate);
        prefixKind = kind(normalizedPrefix);
        if (!candidateKind || candidateKind !== prefixKind) return false;

        if (candidateKind === 'posix') {
            if (normalizedPrefix === '/') return normalizedCandidate.charAt(0) === '/';
            return normalizedCandidate === normalizedPrefix ||
                normalizedCandidate.indexOf(normalizedPrefix + '/') === 0;
        }

        candidateComparable = normalizedCandidate.toLowerCase();
        prefixComparable = withoutTrailingSeparator(normalizedPrefix).toLowerCase();
        if (candidateComparable === prefixComparable) return true;
        if (/^[a-z]:\\$/.test(prefixComparable) || /^\\\\[^\\]+\\[^\\]+\\$/.test(normalizedPrefix.toLowerCase())) {
            return candidateComparable.indexOf(prefixComparable) === 0;
        }
        return candidateComparable.indexOf(prefixComparable + '\\') === 0;
    }

    function suffixAfterPrefix(candidate, prefix) {
        var normalizedCandidate = normalizePath(candidate);
        var normalizedPrefix = normalizePath(prefix);
        var prefixRoot;
        var suffix;

        if (!normalizedCandidate || !normalizedPrefix || !prefixMatches(normalizedCandidate, normalizedPrefix)) return null;
        if (kind(normalizedPrefix) === 'posix') {
            prefixRoot = normalizedPrefix === '/' ? '' : normalizedPrefix;
            suffix = normalizedCandidate.slice(prefixRoot.length);
            return suffix.replace(/^\/+/, '');
        }

        prefixRoot = withoutTrailingSeparator(normalizedPrefix);
        suffix = normalizedCandidate.slice(prefixRoot.length);
        return suffix.replace(/^[\\/]+/, '');
    }

    function appendSuffix(prefix, suffix) {
        var normalizedPrefix = normalizePath(prefix);
        var normalizedSuffix = typeof suffix === 'string' ? suffix.replace(/^[\\/]+/, '') : '';
        var separator;

        if (!normalizedPrefix) return null;
        if (!normalizedSuffix) return normalizedPrefix;
        separator = kind(normalizedPrefix) === 'posix' ? '/' : '\\';
        normalizedSuffix = normalizedSuffix.replace(/[\\/]/g, separator);
        if (normalizedPrefix === '/' || /[\\/]$/.test(normalizedPrefix)) return normalizedPrefix + normalizedSuffix;
        return normalizedPrefix + separator + normalizedSuffix;
    }

    function replacePrefix(candidate, sourcePrefix, targetPrefix) {
        var suffix = suffixAfterPrefix(candidate, sourcePrefix);
        if (suffix === null) return null;
        return appendSuffix(targetPrefix, suffix);
    }

    function longestPrefixMatch(value, entries) {
        var best = null;
        var normalizedValue = normalizePath(value);

        if (!normalizedValue || !Array.isArray(entries)) return null;
        entries.forEach(function (entry, index) {
            var prefix = entry && (entry.prefix || entry.sourcePrefix);
            var normalizedPrefix = normalizePath(prefix);
            if (!normalizedPrefix || !prefixMatches(normalizedValue, normalizedPrefix)) return;
            if (!best || normalizedPrefix.length > best.prefix.length ||
                (normalizedPrefix.length === best.prefix.length && index < best.index)) {
                best = {entry: entry, prefix: normalizedPrefix, index: index};
            }
        });
        return best && best.entry;
    }

    return {
        appendSuffix: appendSuffix,
        isPosixPath: isPosixPath,
        isWindowsPath: looksLikeWindowsPath,
        kind: kind,
        longestPrefixMatch: longestPrefixMatch,
        normalizeCloudPrefix: normalizeCloudPrefix,
        normalizeMappingPrefix: normalizeMappingPrefix,
        normalizePath: normalizePath,
        normalizePosix: normalizePosix,
        normalizeWindows: normalizeWindows,
        prefixMatches: prefixMatches,
        replacePrefix: replacePrefix,
        suffixAfterPrefix: suffixAfterPrefix
    };
}));
