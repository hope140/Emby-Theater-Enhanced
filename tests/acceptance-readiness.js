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
    var pepperReadyRawEventSeen = false;
    var pepperReadyRawEventMs = null;
    var diagnosticsReadySeen = false;
    var diagnosticsReadyObserved = false;
    var diagnosticsReadySource = null;
    var diagnosticsPlayingSeen = false;
    var stickyReadinessSupported = false;
    var stickyReadinessObserved = false;
    var stickyReadinessRunId = null;
    var stickyReadinessAt = null;
    var corePlayingSeen = false;
    var corePlayingMs = null;
    var firstVideoProgressMs = null;
    var videoProgressSeen = false;
    var firstVideoPosition = null;
    var lastVideoPosition = null;
    var corePlayingListener = null;
    var currentRunId = null;
    var currentRunStartedAt = t0;
    function elapsed() { return Date.now() - t0; }
    function finite(value) { return typeof value === 'number' && isFinite(value); }
    function mark(stage, elapsedMs, status) {
        var name = String(stage || '');
        if (!name || name.length > 64 || marks[name]) return;
        marks[name] = true;
        timeline.push({ stage: name, elapsedMs: Math.round(typeof elapsedMs === 'number' ? elapsedMs : elapsed()), status: status || 'seen' });
    }
    function recordCorePlaying(source) {
        if (corePlayingSeen) return;
        corePlayingSeen = true;
        corePlayingMs = elapsed();
        mark('core-playing', corePlayingMs);
    }
    function recordVideoPosition(value) {
        if (!finite(value)) return;
        if (firstVideoPosition === null) firstVideoPosition = value;
        lastVideoPosition = value;
        if (!videoProgressSeen && lastVideoPosition - firstVideoPosition > 0.1) {
            videoProgressSeen = true;
            firstVideoProgressMs = elapsed();
            mark('video-progress', firstVideoProgressMs);
        }
    }
    function stickyState() {
        var state;
        try { state = window.__etePepperReadiness; } catch (error) { return null; }
        if (!state || typeof state !== 'object') return null;
        if (typeof state.snapshot === 'function') {
            stickyReadinessSupported = true;
            try { return state.snapshot(embed); } catch (error) { lastError = 'sticky-readiness-query-failed'; return null; }
        }
        return null;
    }
    function isCurrentStickyReady(snapshot) {
        if (!snapshot || snapshot.ready !== true || !finite(Number(snapshot.readyAt))) return false;
        if (currentRunId && snapshot.runId !== currentRunId) return false;
        if (Number(snapshot.readyAt) < Number(currentRunStartedAt)) return false;
        if (snapshot.readyBridgeMatches === false) return false;
        return true;
    }
    function syncStickyReadiness() {
        var snapshot = stickyState();
        if (!snapshot || !isCurrentStickyReady(snapshot)) return;
        stickyReadinessObserved = true;
        stickyReadinessRunId = snapshot.runId || null;
        stickyReadinessAt = Number(snapshot.readyAt);
        if (!diagnosticsReadySeen) {
            diagnosticsReadySeen = true;
            diagnosticsReadySource = 'sticky-state';
            mark('pepper-ready', Math.max(0, stickyReadinessAt - t0));
        }
    }
    function recordDiagnostics(stage, source) {
        var name = String(stage || '');
        if (name === 'ready') {
            diagnosticsReadySeen = true;
            if (source === 'observer-wrapper') diagnosticsReadyObserved = true;
            diagnosticsReadySource = source || diagnosticsReadySource || 'unknown';
            mark('pepper-ready');
        }
        if (name === 'playing') {
            diagnosticsPlayingSeen = true;
            mark('playing');
        }
    }
    function beginRun(runId) {
        currentRunId = String(runId || ('run-' + Date.now()));
        currentRunStartedAt = Date.now();
        try {
            var state = window.__etePepperReadiness;
            if (state && typeof state.beginRun === 'function') {
                stickyReadinessSupported = true;
                state.beginRun(currentRunId, currentRunStartedAt);
            }
        } catch (error) { lastError = 'sticky-readiness-reset-failed'; }
        ['play-called', 'embed-created', 'embed-attached', 'native-bootstrap-ready', 'pepper-ready', 'manager-play-resolved', 'resolver-result', 'loadfile', 'core-playing', 'video-progress', 'playing'].forEach(function (stage) {
            delete marks[stage];
        });
        timeline = timeline.filter(function (row) {
            return ['play-called', 'embed-created', 'embed-attached', 'native-bootstrap-ready', 'pepper-ready', 'manager-play-resolved', 'resolver-result', 'loadfile', 'core-playing', 'video-progress', 'playing'].indexOf(row.stage) < 0;
        });
        nativeBootstrapReadySeen = false;
        pepperReadyRawEventSeen = false;
        pepperReadyRawEventMs = null;
        diagnosticsReadySeen = false;
        diagnosticsReadyObserved = false;
        diagnosticsReadySource = null;
        diagnosticsPlayingSeen = false;
        stickyReadinessObserved = false;
        stickyReadinessRunId = null;
        stickyReadinessAt = null;
        corePlayingSeen = false;
        corePlayingMs = null;
        firstVideoProgressMs = null;
        videoProgressSeen = false;
        firstVideoPosition = null;
        lastVideoPosition = null;
        return currentRunId;
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
        if (type === 'ready') {
            nativeBootstrapReadySeen = true;
            pepperReadyRawEventSeen = true;
            pepperReadyRawEventMs = elapsed();
            mark('native-bootstrap-ready');
        }
        if (type === 'property_change' && data && typeof data.name === 'string') {
            if (data.name === 'core-idle' && data.value === false) recordCorePlaying('embed-property');
            if (data.name === 'time-pos') recordVideoPosition(data.value);
        }
        if (command === 'loadfile') mark('loadfile');
        if (messages.length < 32) messages.push({ direction: direction, type: type.slice(0, 32), command: command && command.slice(0, 32) });
    }
    function onEmbedMessage(event) { try { rememberMessage('in', event && event.data); } catch (error) { lastError = 'embed-message-error'; } }
    function onCorePlaying() { recordCorePlaying('window-event'); }
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
        syncStickyReadiness();
    }
    function installDiagnosticsHook() {
        var current = window.enhancedDiagnostics;
        if (typeof current !== 'function') return;
        if (current.__eteReadinessHook) return;
        if (diagnosticsWrapper) return;
        try {
            originalDiagnostics = current;
            diagnosticsWrapper = function (bridge, stage) {
                recordDiagnostics(stage, 'observer-wrapper');
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
    function poll() { try { installDiagnosticsHook(); installResolverHook(); attachEmbed(); syncStickyReadiness(); } catch (error) { lastError = 'observer-poll-failed'; } }
    function install() {
        mark('observer-installed', installedAt - t0);
        installEmbedObserver();
        try {
            if (typeof window.addEventListener === 'function') {
                corePlayingListener = onCorePlaying;
                window.addEventListener('core-playing', corePlayingListener);
            }
        } catch (error) { lastError = 'core-playing-observer-failed'; }
        installResolverHook();
        poll();
        pollTimer = setInterval(poll, 50);
    }
    function snapshot() {
        scanEmbedState();
        syncStickyReadiness();
        var pepperReadinessStatus = diagnosticsReadyObserved ? 'observed-ready' : stickyReadinessObserved ? 'inferred-ready-from-authoritative-state' : stickyReadinessSupported ? 'not-ready' : 'observer-missing';
        var pepperReadinessEvidence = [];
        if (pepperReadyRawEventSeen) pepperReadinessEvidence.push({ kind: 'pepper-ready-raw-event', source: 'embed message type ready' });
        if (diagnosticsReadyObserved) pepperReadinessEvidence.push({ kind: 'pepper-ready', source: 'acceptance observer wrapper' });
        if (stickyReadinessObserved) pepperReadinessEvidence.push({ kind: 'pepper-ready', source: 'prepared preload sticky state' });
        return {
            version: 1, installedAt: installedAt, installElapsedMs: installedAt - t0, elapsedMs: elapsed(),
            timeline: timeline.map(function (row) { return { stage: row.stage, elapsedMs: row.elapsedMs, status: row.status }; }),
            messageSummary: messages.slice(), nativeBootstrapReadySeen: nativeBootstrapReadySeen,
            pepperReadyRawEventSeen: pepperReadyRawEventSeen, pepperReadyRawEventMs: pepperReadyRawEventMs,
            diagnosticsHookInstalled: !!diagnosticsWrapper, diagnosticsReadySeen: diagnosticsReadySeen,
            diagnosticsReadyObserved: diagnosticsReadyObserved, diagnosticsReadySource: diagnosticsReadySource,
            diagnosticsPlayingSeen: diagnosticsPlayingSeen, pepperAuthoritativeReady: diagnosticsReadySeen,
            stickyReadinessSupported: stickyReadinessSupported, stickyReadinessObserved: stickyReadinessObserved,
            stickyReadinessRunId: stickyReadinessRunId, stickyReadinessAt: stickyReadinessAt,
            pepperReadiness: { status: pepperReadinessStatus, evidence: pepperReadinessEvidence,
                rawEventObserved: pepperReadyRawEventSeen, normalizedObservation: diagnosticsReadyObserved ? 'direct-product-diagnostics' : stickyReadinessObserved ? 'sticky-authoritative-state' : 'missing' },
            corePlayingSeen: corePlayingSeen, corePlayingMs: corePlayingMs,
            videoProgressSeen: videoProgressSeen, firstVideoProgressMs: firstVideoProgressMs,
            firstVideoPosition: firstVideoPosition, lastVideoPosition: lastVideoPosition,
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
        if (corePlayingListener && typeof window.removeEventListener === 'function') { try { window.removeEventListener('core-playing', corePlayingListener); } catch (error) { } corePlayingListener = null; }
        if (console.log === consoleWrapper && originalConsoleLog) { try { console.log = originalConsoleLog; } catch (error) { } }
        if (window.enhancedDiagnostics === diagnosticsWrapper && originalDiagnostics) { try { window.enhancedDiagnostics = originalDiagnostics; } catch (error) { } }
        if (embed) {
            try { embed.removeEventListener('message', onEmbedMessage); } catch (error) { }
            if (embed.postMessage === postMessageWrapper && originalPostMessage) { try { embed.postMessage = originalPostMessage; } catch (error) { } }
        }
    }
    var api = { version: 1, mark: mark, beginRun: beginRun, snapshot: snapshot, cleanup: cleanup, observer: { install: install } };
    window.__eteReadiness = api;
    install();
    window.__eteInstallResult = 'installed';
    return api;
}());
void 0;
