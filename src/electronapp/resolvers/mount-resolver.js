(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], function () {
            return factory();
        });
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('fs'));
    } else {
        root.mountResolver = factory();
    }
}(this, function (defaultFileSystem) {
    'use strict';

    var mediaExtensions = {
        mkv: true,
        mp4: true,
        m4v: true,
        avi: true,
        mov: true,
        ts: true,
        m2ts: true,
        mts: true,
        webm: true,
        mpg: true,
        mpeg: true,
        vob: true,
        wmv: true,
        flv: true,
        y4m: true,
        mp3: true,
        flac: true,
        m4a: true,
        aac: true,
        ogg: true,
        opus: true,
        wav: true,
        wma: true,
        ape: true,
        alac: true
    };

    function isWindowsLocalPath(value) {
        return typeof value === 'string' && (
            /^[A-Za-z]:[\\/]/.test(value) ||
            /^\\\\/.test(value) ||
            /^\/\/[^\/]/.test(value)
        );
    }

    function basename(value) {
        var lastSlash;

        if (typeof value !== 'string') {
            return '';
        }

        lastSlash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
        return value.substring(lastSlash + 1);
    }

    function hasMediaExtension(value) {
        var name = basename(value);
        var extensionStart = name.lastIndexOf('.');
        var extension;

        if (!name || name === '.' || name === '..' || extensionStart <= 0) {
            return false;
        }

        extension = name.substring(extensionStart + 1).toLowerCase();
        return !!mediaExtensions[extension];
    }

    function deriveSidecarStem(sidecarPath) {
        var stem;

        if (typeof sidecarPath !== 'string' || !/\.strm$/i.test(sidecarPath)) {
            return null;
        }

        stem = sidecarPath.substring(0, sidecarPath.length - 5);
        return hasMediaExtension(stem) ? stem : null;
    }

    function dirname(value) {
        var lastSlash;

        if (typeof value !== 'string') {
            return null;
        }

        lastSlash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
        if (lastSlash < 0) {
            return '';
        }

        return value.substring(0, lastSlash);
    }

    function joinSibling(sidecarPath, fileName) {
        var directory = dirname(sidecarPath);
        var separator;

        if (directory === null) {
            return null;
        }

        if (!directory) {
            return fileName;
        }

        if (directory.charAt(directory.length - 1) === '/' || directory.charAt(directory.length - 1) === '\\') {
            return directory + fileName;
        }

        separator = directory.indexOf('\\') >= 0 ? '\\' : '/';
        return directory + separator + fileName;
    }

    function decodeUrlPath(pathname) {
        try {
            return {
                value: decodeURIComponent(pathname),
                failed: false
            };
        } catch (err) {
            return {
                value: null,
                failed: true
            };
        }
    }

    function getUrlFileName(url) {
        var decoded = decodeUrlPath(url.pathname || '');
        var fileName;

        if (decoded.failed) {
            return {failed: true, value: null};
        }

        fileName = basename(decoded.value);
        return {
            failed: false,
            value: hasMediaExtension(fileName) ? fileName : null
        };
    }

    function getQueryFileName(url) {
        var keys = ['name', 'filename', 'file_name'];
        var searchParams = url.searchParams;
        var value;
        var i;

        if (!searchParams) {
            return {failed: false, value: null};
        }

        for (i = 0; i < keys.length; i++) {
            value = searchParams.get(keys[i]);
            if (value !== null && value !== '') {
                value = basename(value);
                return {
                    failed: false,
                    value: hasMediaExtension(value) ? value : null
                };
            }
        }

        return {failed: false, value: null};
    }

    function parseSourceUrl(sourcePath, dependencies) {
        var UrlConstructor = dependencies && dependencies.URL;

        if (!UrlConstructor && typeof URL === 'function') {
            UrlConstructor = URL;
        }

        if (!UrlConstructor || !/^https?:\/\//i.test(sourcePath)) {
            return {failed: true, value: null};
        }

        try {
            return {
                failed: false,
                value: new UrlConstructor(sourcePath)
            };
        } catch (err) {
            return {failed: true, value: null};
        }
    }

    function getFileSystem(dependencies) {
        if (dependencies && dependencies.fs) {
            return dependencies.fs;
        }

        if (defaultFileSystem) {
            return defaultFileSystem;
        }

        if (typeof window !== 'undefined' && window.fs) {
            return window.fs;
        }

        return null;
    }

    function exists(fileSystem, candidate) {
        try {
            return !!fileSystem && typeof fileSystem.existsSync === 'function' && fileSystem.existsSync(candidate) === true;
        } catch (err) {
            return false;
        }
    }

    function makeResult(type, source, reason, localExists) {
        return {
            type: type,
            source: source,
            reason: reason,
            localExists: localExists === true,
            fallback: type === 'native'
        };
    }

    function visitCandidates(context, dependencies, visitor) {
        var sidecarPath = context && context.sidecarPath;
        var sourcePath = context && context.sourcePath;
        var candidates = [];
        var sidecarStem;
        var parsedUrl;
        var urlFileName;
        var queryFileName;
        var result;

        function addCandidate(value) {
            if (typeof value === 'string' && value && candidates.indexOf(value) < 0) {
                candidates.push(value);
                return visitor ? visitor(value) : null;
            }

            return null;
        }

        sidecarStem = deriveSidecarStem(sidecarPath);
        result = addCandidate(sidecarStem);
        if (result) {
            return {candidates: candidates, result: result, failed: false};
        }

        if (isWindowsLocalPath(sourcePath)) {
            if (hasMediaExtension(sourcePath)) {
                result = addCandidate(sourcePath);
                if (result) {
                    return {candidates: candidates, result: result, failed: false};
                }
            }
        } else if (typeof sourcePath === 'string' && sourcePath) {
            parsedUrl = parseSourceUrl(sourcePath, dependencies);
            if (parsedUrl.failed) {
                return {candidates: candidates, result: null, failed: true};
            }

            urlFileName = getUrlFileName(parsedUrl.value);
            if (urlFileName.failed) {
                return {candidates: candidates, result: null, failed: true};
            }
            if (urlFileName.value) {
                result = addCandidate(joinSibling(sidecarPath, urlFileName.value));
                if (result) {
                    return {candidates: candidates, result: result, failed: false};
                }
            }

            queryFileName = getQueryFileName(parsedUrl.value);
            if (queryFileName.failed) {
                return {candidates: candidates, result: null, failed: true};
            }
            if (queryFileName.value) {
                result = addCandidate(joinSibling(sidecarPath, queryFileName.value));
                if (result) {
                    return {candidates: candidates, result: result, failed: false};
                }
            }
        }

        return {candidates: candidates, result: null, failed: false};
    }

    function getCandidates(context, dependencies) {
        return visitCandidates(context, dependencies).candidates;
    }

    function resolve(context, dependencies) {
        var nativeSource = context && context.nativeSource;
        var fileSystem = getFileSystem(dependencies);
        var visited = visitCandidates(context, dependencies, function (candidate) {
            return exists(fileSystem, candidate)
                ? makeResult('local', candidate, 'mount_hit', true)
                : null;
        });

        if (visited.result) return visited.result;
        if (visited.failed) return makeResult('native', nativeSource, 'parse_failed', false);
        return makeResult('native', nativeSource, 'mount_missing', false);
    }

    return {
        deriveSidecarStem: deriveSidecarStem,
        getCandidates: getCandidates,
        isWindowsLocalPath: isWindowsLocalPath,
        resolve: resolve
    };
}));
