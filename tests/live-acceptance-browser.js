// Live acceptance flow. The observer records facts; this file applies bounded
// gates and interprets those facts without creating a second product event bus.
window.eteAcceptance = (function () {
    let api, manager, events, user, items, sessionId;
    const received = [];
    const reports = [];
    let authorizedPlayback = false;
    const GATES = { apiClientMs: 20000, playbackManagerMs: 20000, eventsMs: 5000, embedMs: 15000, pepperReadyMs: 30000, managerMs: 20000, resolverMs: 20000, pollMs: 100 };

    function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function itemSourceKind(source) {
        if (typeof source !== 'string' || !source) return 'missing';
        if (/^[A-Za-z]:[\\/]/.test(source) || /^\\\\/.test(source) || /^\/\/[^\/]/.test(source)) return 'local';
        if (/^\//.test(source)) return 'posix';
        if (/^https?:\/\//i.test(source)) {
            try { if (window.__eteExpectedCd2Origin && new URL(source).origin === new URL(window.__eteExpectedCd2Origin).origin) return 'cd2-url'; } catch (error) { }
            return 'url';
        }
        return 'other';
    }
    function localPrefixMatches(value, prefix) {
        if (typeof value !== 'string' || typeof prefix !== 'string' || !prefix) return false;
        const root = prefix.replace(/[\\/]+$/, '');
        return value === root || value.indexOf(root + '/') === 0;
    }
    async function until(fn, limit = 15000, interval = GATES.pollMs) {
        const deadline = Date.now() + limit;
        while (Date.now() < deadline) { const value = await fn(); if (value) return value; await wait(interval); }
        return null;
    }
    function readiness() { try { return window.__eteReadiness && window.__eteReadiness.snapshot(); } catch (error) { return null; } }
    function mark(stage) { try { if (window.__eteReadiness) window.__eteReadiness.mark(stage); } catch (error) { } }
    function stageSeen(stage) {
        const state = readiness();
        return !!(state && state.timeline && state.timeline.some(row => row.stage === stage && row.status === 'seen'));
    }
    function waitForStage(stage, limit) { return until(() => stageSeen(stage) ? readiness() : null, limit); }
    function gateFailure(reason, classification, stage, extra) {
        return Object.assign({ ok: false, reason, failureClassification: classification, stage, readiness: readiness() }, extra || {});
    }
    function beginPlaybackRun() {
        const runId = 'play-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        try { if (window.__eteReadiness && typeof window.__eteReadiness.beginRun === 'function') window.__eteReadiness.beginRun(runId); } catch (error) { }
        return runId;
    }
    function assessPlaybackReadiness(managerResolved, progressed, server, resolverObserved) {
        const state = readiness() || {};
        const reportRows = reports.filter(row => row && row.accepted === true);
        const progressReportAccepted = reportRows.some(row => row.method === 'reportPlaybackStart' || row.method === 'reportPlaybackProgress');
        const corePlayingObserved = state.corePlayingSeen === true || stageSeen('core-playing');
        const corePlayingInferred = managerResolved === true && progressed === true && !corePlayingObserved;
        if (!window.eteReadinessEvidence || typeof window.eteReadinessEvidence.classify !== 'function') {
            return { classification: 'D', reason: 'readiness-classifier-unavailable', playbackSucceeded: false,
                authoritativeReadinessConfirmed: false, observerOnlyMiss: false, alternateEvidence: false,
                pepperReadiness: { status: 'unavailable', evidence: [], rawPepperReadyObserved: false, normalizedObservation: 'missing' }, evidence: [] };
        }
        return window.eteReadinessEvidence.classify({
            runnerFailed: false,
            observerAvailable: state.version === 1,
            rawPepperReadyObserved: state.pepperReadyRawEventSeen === true || state.nativeBootstrapReadySeen === true,
            directReadyObserved: state.diagnosticsReadyObserved === true,
            stickyReadyObserved: state.stickyReadinessObserved === true,
            managerPlayResolved: managerResolved === true,
            corePlayingObserved: corePlayingObserved,
            corePlayingInferred: corePlayingInferred,
            videoProgress: progressed === true,
            videoProgressSource: 'PlaybackManager player PositionTicks advanced',
            sessionNowPlaying: !!server,
            progressReportAccepted: progressReportAccepted
        });
    }
    function globalValue(name) { try { return window[name]; } catch (error) { return null; } }
    function hasApiClient(value) {
        return !!(value && typeof value.getCurrentUser === 'function' && typeof value.getSessions === 'function' && typeof value.getItems === 'function');
    }
    function hasPlaybackManager(value) {
        return !!(value && typeof value.play === 'function' && typeof value.getPlayerState === 'function');
    }
    function moduleStatus(source, result) { return { source, result }; }
    function notAttemptedStatus() { return moduleStatus('not-attempted', 'not-attempted'); }
    function initialModuleAcquisition() {
        return { currentApiClient: notAttemptedStatus(), playbackManager: notAttemptedStatus(), events: notAttemptedStatus() };
    }
    async function acquireApiClient() {
        const deadline = Date.now() + GATES.apiClientMs;
        let status = moduleStatus('window.ConnectionManager', 'missing');
        while (Date.now() < deadline) {
            const connectionManager = globalValue('ConnectionManager');
            if (connectionManager && typeof connectionManager.currentApiClient === 'function') {
                try {
                    const candidate = connectionManager.currentApiClient();
                    if (hasApiClient(candidate)) return { ok: true, value: candidate, connectionManager, status: moduleStatus('window.ConnectionManager.currentApiClient', 'available') };
                    status = moduleStatus('window.ConnectionManager.currentApiClient', 'not-ready');
                } catch (error) {
                    status = moduleStatus('window.ConnectionManager.currentApiClient', 'error');
                }
            } else if (connectionManager) {
                status = moduleStatus('window.ConnectionManager', 'invalid');
            }
            const direct = globalValue('ApiClient');
            if (hasApiClient(direct)) return { ok: true, value: direct, connectionManager: globalValue('ConnectionManager'), status: moduleStatus('window.ApiClient', 'available') };
            if (direct) status = moduleStatus('window.ApiClient', 'invalid');
            await wait(Math.min(GATES.pollMs, Math.max(1, deadline - Date.now())));
        }
        return { ok: false, status: moduleStatus(status.source, 'timeout') };
    }
    async function acquirePlaybackManager() {
        const direct = globalValue('playbackManager');
        if (hasPlaybackManager(direct)) return { ok: true, value: direct, status: moduleStatus('window.playbackManager', 'available') };
        const named = globalValue('PlaybackManager');
        if (hasPlaybackManager(named)) return { ok: true, value: named, status: moduleStatus('window.PlaybackManager', 'available') };
        const loader = typeof window.require === 'function' ? window.require : (typeof require === 'function' ? require : null);
        if (!loader) return { ok: false, status: moduleStatus('amd-require:playbackManager', 'unavailable') };
        return await new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => finish({ ok: false, status: moduleStatus('amd-require:playbackManager', 'timeout') }), GATES.playbackManagerMs);
            function finish(result) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(result);
            }
            function accept(value) {
                const candidate = value && value.default ? value.default : value;
                if (hasPlaybackManager(candidate)) finish({ ok: true, value: candidate, status: moduleStatus('amd-require:playbackManager', 'available') });
                else finish({ ok: false, status: moduleStatus('amd-require:playbackManager', 'invalid') });
            }
            try {
                const request = loader(['playbackManager'], accept);
                if (request && typeof request.then === 'function') request.then(accept, () => finish({ ok: false, status: moduleStatus('amd-require:playbackManager', 'error') }));
            } catch (error) {
                finish({ ok: false, status: moduleStatus('amd-require:playbackManager', 'error') });
            }
        });
    }
    async function acquireEvents() {
        const deadline = Date.now() + GATES.eventsMs;
        while (Date.now() < deadline) {
            const events = globalValue('Events');
            if (events && typeof events.on === 'function') return { ok: true, value: events, status: moduleStatus('window.Events', 'available') };
            await wait(Math.min(GATES.pollMs, Math.max(1, deadline - Date.now())));
        }
        return { ok: false, status: moduleStatus('window.Events', 'timeout') };
    }
    function playerState() {
        const player = manager && manager._currentPlayer;
        if (!player) return null;
        const state = manager.getPlayerState();
        return { player: player.id, item: state.NowPlayingItem && state.NowPlayingItem.Id, ticks: state.PlayState.PositionTicks,
            paused: state.PlayState.IsPaused, playSession: state.PlayState.PlaySessionId, source: state.PlayState.MediaSourceId,
            playMethod: state.PlayState.PlayMethod, sourceKind: itemSourceKind(player.currentSrc && player.currentSrc()) };
    }
    async function ownSession() {
        const all = await api.getSessions({ DeviceId: api.deviceId() });
        return all.filter(s => s.DeviceId === api.deviceId() && s.UserId === api.getCurrentUserId() && s.Client === api.appName() && s.ApplicationVersion === api.appVersion())
            .sort((a, b) => new Date(b.LastActivityDate) - new Date(a.LastActivityDate))[0];
    }
    function sanitizedSession(state) { return state ? { present: true, item: state.NowPlayingItem && state.NowPlayingItem.Id, ticks: state.PlayState && state.PlayState.PositionTicks, paused: state.PlayState && state.PlayState.IsPaused, remote: state.SupportsRemoteControl } : { present: false }; }
    async function control(name, options) {
        const before = received.length;
        try { await api.sendPlayStateCommand(sessionId, name, options || {}); } catch (error) { return { ok: false, httpStatus: error && error.status || null }; }
        const delivered = await until(() => received.slice(before).some(command => command === name), 10000);
        return { ok: !!delivered, serverAccepted: true, websocketDelivered: !!delivered };
    }

    return {
        async inspect() {
            mark('inspect-enter');
            const moduleAcquisition = initialModuleAcquisition();
            const apiLoaded = await acquireApiClient();
            moduleAcquisition.currentApiClient = apiLoaded.status;
            if (!apiLoaded.ok) return gateFailure('api-client-unavailable', 'api-client-unavailable', 'api-client-acquisition', { moduleAcquisition });
            api = apiLoaded.value;
            mark('api-client-ready');
            const managerLoaded = await acquirePlaybackManager();
            moduleAcquisition.playbackManager = managerLoaded.status;
            if (!managerLoaded.ok) return gateFailure('playback-manager-unavailable', 'playback-manager-unavailable', 'playback-manager-acquisition', { moduleAcquisition });
            manager = managerLoaded.value;
            const eventsLoaded = await acquireEvents();
            moduleAcquisition.events = eventsLoaded.status;
            if (!eventsLoaded.ok) return gateFailure('events-unavailable', 'events-unavailable', 'events-acquisition', { moduleAcquisition });
            events = eventsLoaded.value;
            user = await api.getCurrentUser();
            if (!user) return { ok: false, reason: 'not-logged-in', failureClassification: 'api-client-readiness-timeout', moduleAcquisition };
            const existing = playerState();
            if (existing && existing.item) return { ok: false, reason: 'existing-playback-preserved', moduleAcquisition };
            events.on(api, 'message', (event, message) => { if (message.MessageType === 'Playstate') received.push(message.Data.Command); });
            const originalAjax = api.ajax;
            api.ajax = function (request) {
                const endpoint = new URL(request.url).pathname;
                const match = /\/Sessions\/Playing(\/Progress|\/Stopped)?$/.exec(endpoint);
                let row;
                if (match && request.type === 'POST' && request.data) {
                    const info = JSON.parse(request.data);
                    const method = match[1] === '/Stopped' ? 'reportPlaybackStopped' : match[1] === '/Progress' ? 'reportPlaybackProgress' : 'reportPlaybackStart';
                    row = { method, item: info.ItemId, source: info.MediaSourceId, playSession: info.PlaySessionId, ticks: info.PositionTicks, paused: info.IsPaused, accepted: null };
                    reports.push(row);
                }
                return originalAjax.apply(this, arguments).then(value => { if (row) row.accepted = true; return value; }, error => { if (row) row.accepted = false; throw error; });
            };
            api.ensureWebSocket();
            const connectionManager = apiLoaded.connectionManager || globalValue('ConnectionManager');
            if (!connectionManager || typeof connectionManager.capabilities !== 'function') return gateFailure('connection-manager-unavailable', 'api-client-unavailable', 'connection-manager-acquisition', { moduleAcquisition });
            const capabilities = await connectionManager.capabilities();
            const sessions = await api.getSessions({ DeviceId: api.deviceId() });
            const session = await ownSession();
            if (!session) return { ok: false, reason: 'own-session-not-visible', nonAdmin: !user.Policy.IsAdministrator };
            sessionId = session.Id;
            return { ok: true, nonAdmin: !user.Policy.IsAdministrator, websocketOpen: api.isWebSocketOpen(), session: sanitizedSession(session),
                capabilities: { mediaControl: capabilities.SupportsMediaControl, remote: capabilities.SupportsRemoteControl, commands: capabilities.SupportedCommands && capabilities.SupportedCommands.length },
                clientName: api.appName(), ownSessions: sessions.filter(s => s.DeviceId === api.deviceId() && s.UserId === api.getCurrentUserId()).map(s => ({ client: s.Client, sameClient: s.Client === api.appName(), sameVersion: s.ApplicationVersion === api.appVersion(), remote: s.SupportsRemoteControl, commands: s.SupportedCommands && s.SupportedCommands.length, lastActivity: s.LastActivityDate })),
                permission: { controlOwn: user.Policy.EnableRemoteControlOfOtherUsers, sharedDevices: user.Policy.EnableSharedDeviceControl }, moduleAcquisition };
        },
        async select() {
            const result = await api.getItems(api.getCurrentUserId(), { Recursive: true, IncludeItemTypes: 'Movie,Episode', Limit: 16, Fields: 'Path,MediaSources', SortBy: 'DateCreated', SortOrder: 'Descending', Filters: 'IsUnplayed' });
            items = result.Items.filter(item => typeof item.Path === 'string' && item.Path.toLowerCase().endsWith('.strm') && item.RunTimeTicks > 1200000000).slice(0, 2);
            if (items.length < 2) return { ok: false, reason: 'not-enough-strm-samples', scanned: result.Items.length };
            return { ok: true, scanned: result.Items.length, samples: items.map(item => { const source = (item.MediaSources || [])[0] || {}; return { id: item.Id, name: item.Name, series: item.SeriesName, type: item.Type, strm: true, itemPathKind: itemSourceKind(item.Path), itemPathPrefixMatch: localPrefixMatches(item.Path, window.__eteExpectedCd2LocalPrefix), sourceCount: item.MediaSources && item.MediaSources.length, sourcePathKind: itemSourceKind(source.Path), sourcePathPrefixMatch: localPrefixMatches(source.Path, window.__eteExpectedCd2LocalPrefix), container: String(source.Container || '').toLowerCase() || 'missing' }; }) };
        },
        async directSmoke() {
            const mediaSource = (items[0].MediaSources || [])[0] || {};
            if (typeof mediaSource.Path !== 'string' || !mediaSource.Path) return { ok: false, reason: 'missing-source-path' };
            const resolved = await window.ipc.invoke('enhanced-cd2-resolve', { requestId: 'live-direct-smoke', candidates: [mediaSource.Path] });
            if (!resolved || resolved.status !== 'hit') return { ok: false, reason: resolved && resolved.reason || 'resolve-miss' };
            const bridge = document.createElement('embed'); bridge.type = 'application/x-mpvjs'; bridge.style.width = '64px'; bridge.style.height = '64px';
            const ready = new Promise(resolve => { const timer = setTimeout(() => resolve(false), 8000); function receive(event) { if (event.data && event.data.type === 'ready') { clearTimeout(timer); bridge.removeEventListener('message', receive); resolve(true); } } bridge.addEventListener('message', receive); });
            document.body.appendChild(bridge);
            if (!await ready) { bridge.remove(); return { ok: false, reason: 'bridge-not-ready' }; }
            const state = { pathAccepted: false, fileFormat: null, coreIdleFalse: false, firstTime: null, maxTime: 0, timeAdvanced: false };
            function receive(event) { const message = event.data || {}; if (message.type !== 'property_change' || !message.data) return; const name = message.data.name, value = message.data.value; if (name === 'path' && value === resolved.source) state.pathAccepted = true; else if (state.pathAccepted && name === 'file-format' && typeof value === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(value)) state.fileFormat = value; else if (state.pathAccepted && name === 'core-idle' && value === false) state.coreIdleFalse = true; else if (state.pathAccepted && name === 'time-pos' && typeof value === 'number') { if (state.firstTime === null) state.firstTime = value; state.maxTime = Math.max(state.maxTime, value); state.timeAdvanced = state.maxTime - state.firstTime > 0.1; } }
            bridge.addEventListener('message', receive); ['path', 'file-format', 'core-idle', 'time-pos'].forEach(name => bridge.postMessage({ type: 'observe_property', data: name }));
            const userAgent = resolved.requestOptions && resolved.requestOptions.userAgent;
            bridge.postMessage({ type: 'command', data: resolved.sourceKind === 'direct-url' && typeof userAgent === 'string' ? ['loadfile', resolved.source, 'replace', '-1', 'user-agent=' + userAgent] : ['loadfile', resolved.source] });
            for (let i = 0; i < 300 && !state.timeAdvanced; i++) { await wait(100); if (state.pathAccepted && i % 10 === 0) ['file-format', 'core-idle', 'time-pos'].forEach(name => bridge.postMessage({ type: 'get_property_async', data: name })); }
            bridge.postMessage({ type: 'command', data: ['stop'] }); bridge.removeEventListener('message', receive); bridge.remove();
            return { ok: (resolved.sourceKind === 'direct-url' || resolved.sourceKind === 'cd2-url') && state.pathAccepted && !!state.fileFormat && state.coreIdleFalse && state.timeAdvanced, reason: state.timeAdvanced ? 'none' : 'playback-not-advancing', sourceKind: resolved.sourceKind || 'unknown', userAgentPresent: typeof userAgent === 'string' && userAgent.length > 0, expiresInPresent: resolved.expiresAt !== undefined, pathAccepted: state.pathAccepted, fileFormatPresent: !!state.fileFormat, coreIdleFalse: state.coreIdleFalse, timeAdvanced: state.timeAdvanced };
        },
        async play() {
            const first = items[0]; authorizedPlayback = true; beginPlaybackRun(); mark('play-called');
            let started;
            try { started = Promise.resolve(manager.play({ items, fullscreen: true, startPositionTicks: 0 })); } catch (error) {
                const assessment = assessPlaybackReadiness(false, false, null, false);
                return gateFailure('manager-play-rejected', 'runtime-readiness-failure', 'manager-play-resolved', { errorType: error.name || 'Error', readinessAssessment: assessment });
            }
            const settled = started.then(value => { mark('manager-play-resolved'); return { state: 'resolved', value }; }, error => { return { state: 'rejected', errorType: error && error.name || 'Error' }; });
            if (!await waitForStage('embed-created', GATES.embedMs)) {
                const assessment = assessPlaybackReadiness(false, false, null, false);
                return gateFailure('embed-not-created', 'runtime-readiness-failure', 'embed-created', { readinessAssessment: assessment });
            }
            const managerResult = await Promise.race([settled, wait(GATES.managerMs).then(() => ({ state: 'timeout' }))]);
            if (managerResult.state === 'timeout') {
                const assessment = assessPlaybackReadiness(false, false, null, false);
                return gateFailure('manager-play-not-completed', 'runtime-readiness-failure', 'manager-play-resolved', { readinessAssessment: assessment });
            }
            if (managerResult.state === 'rejected') {
                const assessment = assessPlaybackReadiness(false, false, null, false);
                return gateFailure('manager-play-rejected', 'runtime-readiness-failure', 'manager-play-resolved', { errorType: managerResult.errorType, readinessAssessment: assessment });
            }
            const resolver = waitForStage('resolver-result', GATES.resolverMs);
            const progressed = await until(() => { const state = playerState(); return state && state.item === first.Id && state.ticks > 30000000 ? state : null; }, 30000);
            if (progressed) mark('video-progress');
            const server = await until(async () => { const state = await ownSession(); return state && state.NowPlayingItem && state.NowPlayingItem.Id === first.Id && state.PlayState.PositionTicks > 0 ? state : null; }, 15000);
            const resolverState = await resolver;
            const finalReadiness = readiness();
            const assessment = assessPlaybackReadiness(true, !!progressed, server, !!resolverState);
            const reported = reports.filter(row => row.item === first.Id);
            if (!assessment.playbackSucceeded) {
                return { ok: false, reason: 'playback-not-proven', failureClassification: 'runtime-readiness-failure', stage: 'core-playing',
                    readinessAssessment: assessment, local: progressed, server: sanitizedSession(server), reported: reported,
                    resolverObserved: !!resolverState, managerPlayResolved: true, corePlayingObserved: !!(finalReadiness && finalReadiness.corePlayingSeen),
                    videoFrameEquivalent: !!progressed, sessionNowPlaying: !!server, progressReportAccepted: reported.some(row => row.accepted === true),
                    loadfileObservation: finalReadiness && finalReadiness.loadfileObservation === 'available' ? 'available' : 'unavailable' };
            }
            return { ok: true, reason: assessment.classification === 'B' ? 'observer-miss-authoritative-alternate-evidence' : 'none', readinessAssessment: assessment,
                local: progressed, server: sanitizedSession(server), reported: reported, resolverObserved: !!resolverState,
                managerPlayResolved: true, corePlayingObserved: !!(finalReadiness && finalReadiness.corePlayingSeen),
                videoFrameEquivalent: true, sessionNowPlaying: !!server, progressReportAccepted: reported.some(row => row.accepted === true),
                loadfileObservation: finalReadiness && finalReadiness.loadfileObservation === 'available' ? 'available' : 'unavailable' };
        },
        async pause() { const command = await control('Pause'); if (!command.ok) return command; const paused = await until(() => playerState() && playerState().paused); const server = await until(async () => { const state = await ownSession(); return state && state.PlayState.IsPaused ? state : null; }); return { ok: !!paused && !!server, command, local: playerState(), server: sanitizedSession(server) }; },
        async visual() { await wait(20000); return { ok: !!(playerState() && playerState().item), local: playerState() }; },
        async seek() { const command = await control('Seek', { SeekPositionTicks: 600000000 }); if (!command.ok) return command; const sought = await until(() => { const state = playerState(); return state && Math.abs(state.ticks - 600000000) < 40000000; }); const server = await until(async () => { const state = await ownSession(); return state && Math.abs(state.PlayState.PositionTicks - 600000000) < 50000000 ? state : null; }); return { ok: !!sought && !!server, command, local: playerState(), server: sanitizedSession(server) }; },
        async resume() { const command = await control('Unpause'); if (!command.ok) return command; const resumed = await until(() => { const state = playerState(); return state && !state.paused && state.ticks > 620000000; }); return { ok: !!resumed, command, local: playerState() }; },
        async next() { const command = await control('NextTrack'); if (!command.ok) return command; const next = await until(() => { const state = playerState(); return state && state.item === items[1].Id && state.ticks > 10000000 ? state : null; }, 45000); const server = await until(async () => { const state = await ownSession(); return state && state.NowPlayingItem && state.NowPlayingItem.Id === items[1].Id ? state : null; }); return { ok: !!next && !!server, command, local: next, server: sanitizedSession(server) }; },
        async stop() { const command = await control('Stop'); if (!command.ok) return command; const stopped = await until(() => !(playerState() && playerState().item)); const server = await until(async () => { const state = await ownSession(); return state && !state.NowPlayingItem ? state : null; }); const acceptedStops = reports.filter(row => row.method === 'reportPlaybackStopped' && row.accepted); const startedItems = new Set(reports.filter(row => row.method === 'reportPlaybackStart' && row.accepted).map(row => row.item)); return { ok: !!stopped && !!server && startedItems.size > 0 && [...startedItems].every(item => acceptedStops.some(row => row.item === item)), command, nowPlayingCleared: !!server && !server.NowPlayingItem, stopReportAccepted: acceptedStops.length > 0, server: sanitizedSession(server), reports }; },
        async cleanup() { if (authorizedPlayback && manager && manager._currentPlayer) await manager.stop().catch(() => { }); }
    };
}());
