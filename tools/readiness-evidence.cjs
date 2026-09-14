'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.eteReadinessEvidence = factory();
}(typeof window === 'object' ? window : this, function () {
    const statuses = ['observed-ready', 'inferred-ready-from-authoritative-state', 'not-ready', 'observer-missing', 'unavailable'];

    function observed(value) { return value === true; }

    function evidence(kind, source, value) {
        return {kind: kind, source: source, observed: value === undefined ? true : value === true};
    }

    function classify(input) {
        const value = input || {};
        const runnerFailed = observed(value.runnerFailed);
        const rawPepperReady = observed(value.rawPepperReadyObserved);
        const directReady = observed(value.directReadyObserved);
        const stickyReady = observed(value.stickyReadyObserved);
        const managerResolved = observed(value.managerPlayResolved);
        const corePlayingObserved = observed(value.corePlayingObserved);
        const corePlayingInferred = observed(value.corePlayingInferred);
        const videoProgress = observed(value.videoProgress);
        const sessionNowPlaying = observed(value.sessionNowPlaying);
        const progressReportAccepted = observed(value.progressReportAccepted);
        const corePlaying = corePlayingObserved || corePlayingInferred;
        const playbackSucceeded = managerResolved && corePlaying && videoProgress && sessionNowPlaying && progressReportAccepted;
        const rows = [];

        if (rawPepperReady) rows.push(evidence('pepper-ready-raw-event', 'embed message type ready'));
        if (directReady) rows.push(evidence('pepper-ready', 'acceptance-observer-wrapper'));
        if (stickyReady) rows.push(evidence('pepper-ready', 'prepared-preload-sticky-state'));
        if (managerResolved) rows.push(evidence('manager-play-resolved', 'PlaybackManager.play Promise'));
        if (corePlayingObserved) rows.push(evidence('core-playing', 'window core-playing event'));
        if (corePlayingInferred) rows.push(evidence('core-playing', 'manager-resolved plus video progress inference'));
        if (videoProgress) rows.push(evidence('video-frame-equivalent', value.videoProgressSource || 'player PositionTicks advanced'));
        if (sessionNowPlaying) rows.push(evidence('session-now-playing', 'own Emby Session'));
        if (progressReportAccepted) rows.push(evidence('progress-report', 'accepted playback start/progress report'));

        let classification;
        let status;
        let reason;
        if (runnerFailed) {
            classification = 'D';
            status = 'unavailable';
            reason = 'runner-or-harness-failure';
        } else if (playbackSucceeded && directReady) {
            classification = 'A';
            status = 'observed-ready';
            reason = 'pepper-ready-observed-and-playback-succeeded';
        } else if (playbackSucceeded) {
            classification = 'B';
            status = 'inferred-ready-from-authoritative-state';
            reason = stickyReady ? 'sticky-authoritative-state-recovered' : 'authoritative-alternate-playback-evidence';
        } else if (!directReady && !stickyReady) {
            classification = 'C';
            status = value.observerAvailable === false ? 'observer-missing' : 'not-ready';
            reason = 'no-authoritative-ready-evidence-and-playback-not-proven';
        } else {
            classification = 'C';
            status = 'inferred-ready-from-authoritative-state';
            reason = 'authoritative-ready-observed-but-playback-not-proven';
        }

        if (statuses.indexOf(status) < 0) status = 'unavailable';
        return {
            classification: classification,
            reason: reason,
            playbackSucceeded: playbackSucceeded,
            directReadyObserved: directReady,
            stickyReadyObserved: stickyReady,
            authoritativeReadinessConfirmed: directReady || stickyReady || playbackSucceeded,
            observerOnlyMiss: classification === 'B' && !stickyReady,
            alternateEvidence: classification === 'B',
            pepperReadiness: {
                status: status,
                evidence: rows.filter(function (row) {
                    return row.kind === 'pepper-ready' || row.kind === 'pepper-ready-raw-event';
                }),
                rawPepperReadyObserved: rawPepperReady,
                normalizedObservation: directReady ? 'direct-product-diagnostics' : stickyReady ? 'sticky-authoritative-state' : playbackSucceeded ? 'authoritative-alternate-playback-evidence' : 'missing'
            },
            evidence: rows
        };
    }

    function isCurrentReadyState(state, run) {
        const value = state || {};
        const current = run || {};
        if (value.ready !== true) return false;
        if (current.runId && value.runId !== current.runId) return false;
        if (Number.isFinite(Number(current.startedAt)) && Number.isFinite(Number(value.readyAt)) && Number(value.readyAt) < Number(current.startedAt)) return false;
        if (value.readyBridgeMatches === false) return false;
        return true;
    }

    return {statuses: statuses, classify: classify, isCurrentReadyState: isCurrentReadyState};
}));
