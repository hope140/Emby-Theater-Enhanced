(function () {
    'use strict';
    if (window.__eteReadiness && window.__eteReadiness.version === 1) return window.__eteReadiness;
    var t0 = typeof window.__eteEpoch === 'number' ? window.__eteEpoch : Date.now();
    var installedAt = Date.now();
    var marks = Object.create(null);
    var timeline = [];
    var messages = [];
    var embed = null;
    var knownEmbeds = [];
    var embedLifecycle = [];
    var embedObserver = null;
    var embedCreatedObservationMs = null;
    var embedAttachedMs = null;
    var embedRecreated = false;
    var multipleEmbedsObserved = false;
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
    function embedNodes() {
        try {
            if (document.querySelectorAll) return Array.prototype.slice.call(document.querySelectorAll('embed[type="application/x-mpvjs"]'));
        } catch (error) { lastError = 'embed-query-failed'; }
        try {
            var found = findEmbed();
            return found ? [found] : [];
        } catch (error) { return []; }
    }
    function isEmbedNode(node) {
        if (!node || node.nodeType !== 1) return false;
        try {
            if (typeof node.matches === 'function') return node.matches('embed[type="application/x-mpvjs"]');
            return String(node.tagName || '').toLowerCase() === 'embed' && node.type === 'application/x-mpvjs';
        } catch (error) { return false; }
    }
    function nodeIsConnected(node) {
        try {
            if (node && node.isConnected === true) return true;
            return !!(document.documentElement && document.documentElement.contains && document.documentElement.contains(node));
        } catch (error) { return false; }
    }
    function currentEmbedCount() { return embedNodes().length; }
    function lifecycleRecord(node) {
        for (var i = 0; i < knownEmbeds.length; i++) {
            if (knownEmbeds[i].node === node) return knownEmbeds[i];
        }
        var record = { node: node, connected: null, disconnected: false, index: knownEmbeds.length + 1 };
        knownEmbeds.push(record);
        return record;
    }
    function rememberEmbedLifecycle(node, source, forceState) {
        if (!isEmbedNode(node)) return;
        var record = lifecycleRecord(node);
        var connected = forceState === 'disconnected' ? false : nodeIsConnected(node);
        var count = currentEmbedCount();
        var first = record.connected === null;
        if (first) {
            for (var previous = 0; previous < knownEmbeds.length; previous++) {
                if (knownEmbeds[previous] !== record && knownEmbeds[previous].disconnected) embedRecreated = true;
            }
            embedCreatedObservationMs = embedCreatedObservationMs === null ? elapsed() : embedCreatedObservationMs;
            mark('embed-created', embedCreatedObservationMs);
            embedLifecycle.push({ event: 'created-observed', embedIndex: record.index, connected: connected, currentCount: count, elapsedMs: embedCreatedObservationMs, source: source });
        }
        if (connected && record.connected !== true) {
            if (record.disconnected) embedRecreated = true;
            record.connected = true;
            embedAttachedMs = embedAttachedMs === null ? elapsed() : embedAttachedMs;
            mark('embed-attached', embedAttachedMs);
            embedLifecycle.push({ event: 'connected', embedIndex: record.index, connected: true, currentCount: count, elapsedMs: embedAttachedMs, source: source });
        } else if (!connected && record.connected === true) {
            record.connected = false;
            record.disconnected = true;
            embedLifecycle.push({ event: 'disconnected', embedIndex: record.index, connected: false, currentCount: count, elapsedMs: elapsed(), source: source });
        }
        if (count > 1 || knownEmbeds.length > 1) multipleEmbedsObserved = true;
        if (embedLifecycle.length > 64) embedLifecycle.shift();
    }
    function collectEmbedNodes(node, output) {
        if (!node) return;
        if (isEmbedNode(node)) output.push(node);
        try {
            if (node.querySelectorAll) {
                var nested = node.querySelectorAll('embed[type="application/x-mpvjs"]');
                for (var i = 0; i < nested.length; i++) output.push(nested[i]);
            }
        } catch (error) { lastError = 'embed-query-failed'; }
    }
    function processMutationRecords(records) {
        var added = [], removed = [];
        for (var i = 0; i < records.length; i++) {
            var row = records[i] || {};
            collectEmbedNodes(row.addedNodes && row.addedNodes[0], added);
            collectEmbedNodes(row.removedNodes && row.removedNodes[0], removed);
            if (row.addedNodes) for (var a = 1; a < row.addedNodes.length; a++) collectEmbedNodes(row.addedNodes[a], added);
            if (row.removedNodes) for (var r = 1; r < row.removedNodes.length; r++) collectEmbedNodes(row.removedNodes[r], removed);
        }
        for (var j = 0; j < added.length; j++) rememberEmbedLifecycle(added[j], 'mutation-observer');
        for (var k = 0; k < removed.length; k++) rememberEmbedLifecycle(removed[k], 'mutation-observer', 'disconnected');
        scanEmbedState();
    }
    function scanEmbedState() {
        var current = embedNodes();
        for (var i = 0; i < current.length; i++) rememberEmbedLifecycle(current[i], 'poll');
        for (var j = 0; j < knownEmbeds.length; j++) {
            if (knownEmbeds[j].connected && current.indexOf(knownEmbeds[j].node) < 0) rememberEmbedLifecycle(knownEmbeds[j].node, 'poll', 'disconnected');
        }
    }
    function installEmbedObserver() {
        if (typeof MutationObserver !== 'function') { lastError = 'embed-observer-unavailable'; return; }
        try {
            embedObserver = new MutationObserver(processMutationRecords);
            embedObserver.observe(document.documentElement || document, { childList: true, subtree: true });
        } catch (error) { embedObserver = null; lastError = 'embed-observer-failed'; }
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
        scanEmbedState();
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
        installEmbedObserver();
        installResolverHook();
        poll();
        pollTimer = setInterval(poll, 50);
    }
    function snapshot() {
        scanEmbedState();
        return {
            version: 1, installedAt: installedAt, installElapsedMs: installedAt - t0, elapsedMs: elapsed(),
            timeline: timeline.map(function (row) { return { stage: row.stage, elapsedMs: row.elapsedMs, status: row.status }; }),
            messageSummary: messages.slice(), nativeBootstrapReadySeen: nativeBootstrapReadySeen,
            diagnosticsHookInstalled: !!diagnosticsWrapper, diagnosticsReadySeen: diagnosticsReadySeen,
            diagnosticsPlayingSeen: diagnosticsPlayingSeen, pepperAuthoritativeReady: diagnosticsReadySeen,
            resolverResultSeen: !!marks['resolver-result'], loadfileSeen: !!marks.loadfile,
            loadfileObservation: marks.loadfile ? 'available' : 'unavailable', lastError: lastError,
            embedCount: knownEmbeds.length, connectedEmbedCount: currentEmbedCount(),
            embedConnected: !!embed && nodeIsConnected(embed), embedRecreated: embedRecreated,
            multipleEmbedsObserved: multipleEmbedsObserved, embedCreatedObservationMs: embedCreatedObservationMs,
            embedAttachedMs: embedAttachedMs, embedLifecycle: embedLifecycle.map(function (row) {
                return { event: row.event, embedIndex: row.embedIndex, connected: row.connected,
                    currentCount: row.currentCount, elapsedMs: row.elapsedMs, source: row.source };
            })
        };
    }
    function cleanup() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (embedObserver) { try { embedObserver.disconnect(); } catch (error) { } embedObserver = null; }
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
