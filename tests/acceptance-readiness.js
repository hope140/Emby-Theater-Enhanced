(function () {
    'use strict';
    if (window.__eteReadiness && window.__eteReadiness.version === 1) return window.__eteReadiness;
    var t0 = typeof window.__eteEpoch === 'number' ? window.__eteEpoch : Date.now();
    var installedAt = Date.now();
    var marks = Object.create(null);
    var timeline = [];
    var messages = [];
    var embed = null;
    var originalPostMessage = null;
    var postMessageWrapper = null;
    var originalDiagnostics = null;
    var diagnosticsWrapper = null;
    var originalConsoleLog = null;
    var consoleWrapper = null;
    var pollTimer = null;
    var lastError = null;
    var nativeBootstrapReadySeen = false;
    var diagnosticsReadySeen = false;
    var diagnosticsPlayingSeen = false;
    function elapsed() { return Date.now() - t0; }
    function mark(stage, elapsedMs, status) {
        var name = String(stage || '');
        if (!name || name.length > 64 || marks[name]) return;
        marks[name] = true;
        timeline.push({ stage: name, elapsedMs: Math.round(typeof elapsedMs === 'number' ? elapsedMs : elapsed()), status: status || 'seen' });
    }
    function rememberMessage(direction, message) {
        var type = message && typeof message.type === 'string' ? message.type : 'unknown';
        var data = message && message.data;
        var command = Array.isArray(data) && typeof data[0] === 'string' ? data[0].toLowerCase() : null;
        if (type === 'ready') { nativeBootstrapReadySeen = true; mark('native-bootstrap-ready'); }
        if (command === 'loadfile') mark('loadfile');
        if (messages.length < 32) messages.push({ direction: direction, type: type.slice(0, 32), command: command && command.slice(0, 32) });
    }
    function onEmbedMessage(event) { try { rememberMessage('in', event && event.data); } catch (error) { lastError = 'embed-message-error'; } }
    function findEmbed() {
        try { return document.querySelector('embed[type="application/x-mpvjs"]'); } catch (error) { return null; }
    }
    function attachEmbed() {
        var found = findEmbed();
        if (!found || found === embed) return;
        if (embed) {
            try { embed.removeEventListener('message', onEmbedMessage); } catch (error) { }
            if (embed.postMessage === postMessageWrapper) { try { embed.postMessage = originalPostMessage; } catch (error) { } }
        }
        embed = found;
        mark('embed-created');
        try { embed.addEventListener('message', onEmbedMessage); } catch (error) { lastError = 'embed-hook-failed'; }
        try {
            originalPostMessage = embed.postMessage;
            if (typeof originalPostMessage === 'function' && !originalPostMessage.__eteReadinessHook) {
                postMessageWrapper = function (message) {
                    try { rememberMessage('out', message); } catch (error) { lastError = 'embed-message-error'; }
                    return originalPostMessage.apply(this, arguments);
                };
                postMessageWrapper.__eteReadinessHook = true;
                embed.postMessage = postMessageWrapper;
            }
        } catch (error) { lastError = 'embed-command-hook-failed'; }
    }
    function installDiagnosticsHook() {
        var current = window.enhancedDiagnostics;
        if (typeof current !== 'function') return;
        if (current.__eteReadinessHook) return;
        if (diagnosticsWrapper) return;
        try {
            originalDiagnostics = current;
            diagnosticsWrapper = function (bridge, stage) {
                var name = String(stage || '');
                if (name === 'ready') { diagnosticsReadySeen = true; mark('pepper-ready'); }
                if (name === 'playing') { diagnosticsPlayingSeen = true; mark('playing'); }
                return originalDiagnostics.apply(this, arguments);
            };
            diagnosticsWrapper.__eteReadinessHook = true;
            window.enhancedDiagnostics = diagnosticsWrapper;
            mark('diagnostics-hook-installed');
        } catch (error) { lastError = 'diagnostics-hook-failed'; diagnosticsWrapper = null; }
    }
    function installResolverHook() {
        try {
            var current = console.log;
            if (typeof current !== 'function' || current === consoleWrapper) return;
            originalConsoleLog = current;
            consoleWrapper = function () {
                try { if (String(Array.prototype.join.call(arguments, ' ')).indexOf('STRM resolver: invoked') >= 0) mark('resolver-result'); } catch (error) { lastError = 'console-hook-failed'; }
                return originalConsoleLog.apply(console, arguments);
            };
            consoleWrapper.__eteReadinessHook = true;
            console.log = consoleWrapper;
        } catch (error) { lastError = 'console-hook-failed'; }
    }
    function poll() { try { installDiagnosticsHook(); installResolverHook(); attachEmbed(); } catch (error) { lastError = 'observer-poll-failed'; } }
    function install() {
        mark('observer-installed', installedAt - t0);
        installResolverHook();
        poll();
        pollTimer = setInterval(poll, 50);
    }
    function snapshot() {
        return {
            version: 1, installedAt: installedAt, installElapsedMs: installedAt - t0, elapsedMs: elapsed(),
            timeline: timeline.map(function (row) { return { stage: row.stage, elapsedMs: row.elapsedMs, status: row.status }; }),
            messageSummary: messages.slice(), nativeBootstrapReadySeen: nativeBootstrapReadySeen,
            diagnosticsHookInstalled: !!diagnosticsWrapper, diagnosticsReadySeen: diagnosticsReadySeen,
            diagnosticsPlayingSeen: diagnosticsPlayingSeen, pepperAuthoritativeReady: diagnosticsReadySeen,
            resolverResultSeen: !!marks['resolver-result'], loadfileSeen: !!marks.loadfile,
            loadfileObservation: marks.loadfile ? 'available' : 'unavailable', lastError: lastError
        };
    }
    function cleanup() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (console.log === consoleWrapper && originalConsoleLog) { try { console.log = originalConsoleLog; } catch (error) { } }
        if (window.enhancedDiagnostics === diagnosticsWrapper && originalDiagnostics) { try { window.enhancedDiagnostics = originalDiagnostics; } catch (error) { } }
        if (embed) {
            try { embed.removeEventListener('message', onEmbedMessage); } catch (error) { }
            if (embed.postMessage === postMessageWrapper && originalPostMessage) { try { embed.postMessage = originalPostMessage; } catch (error) { } }
        }
    }
    var api = { version: 1, mark: mark, snapshot: snapshot, cleanup: cleanup, observer: { install: install } };
    window.__eteReadiness = api;
    install();
    window.__eteInstallResult = 'installed';
    return api;
}());
void 0;
