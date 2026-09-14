'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../tools/readiness-evidence.cjs');

function playbackEvidence(overrides) {
    return Object.assign({
        observerAvailable: true,
        rawPepperReadyObserved: true,
        directReadyObserved: true,
        stickyReadyObserved: false,
        managerPlayResolved: true,
        corePlayingObserved: true,
        corePlayingInferred: false,
        videoProgress: true,
        sessionNowPlaying: true,
        progressReportAccepted: true
    }, overrides || {});
}

test('ready observed after observer attach is class A', () => {
    const result = evidence.classify(playbackEvidence());
    assert.equal(result.classification, 'A');
    assert.equal(result.pepperReadiness.status, 'observed-ready');
    assert.equal(result.authoritativeReadinessConfirmed, true);
    assert.equal(result.observerOnlyMiss, false);
});

test('playback evidence with no ready marker is explicit class B observer miss', () => {
    const result = evidence.classify(playbackEvidence({
        rawPepperReadyObserved: false,
        directReadyObserved: false
    }));
    assert.equal(result.classification, 'B');
    assert.equal(result.pepperReadiness.status, 'inferred-ready-from-authoritative-state');
    assert.equal(result.pepperReadiness.normalizedObservation, 'authoritative-alternate-playback-evidence');
    assert.equal(result.authoritativeReadinessConfirmed, true);
    assert.equal(result.observerOnlyMiss, true);
    assert(result.evidence.some(row => row.kind === 'video-frame-equivalent'));
    assert(result.evidence.some(row => row.kind === 'session-now-playing'));
});

test('no ready evidence and no playable state is class C', () => {
    const result = evidence.classify(playbackEvidence({
        rawPepperReadyObserved: false,
        directReadyObserved: false,
        managerPlayResolved: false,
        corePlayingObserved: false,
        videoProgress: false,
        sessionNowPlaying: false,
        progressReportAccepted: false
    }));
    assert.equal(result.classification, 'C');
    assert.equal(result.pepperReadiness.status, 'not-ready');
    assert.equal(result.authoritativeReadinessConfirmed, false);
});

test('runner or harness failure is class D and never a player readiness result', () => {
    const result = evidence.classify(playbackEvidence({runnerFailed: true}));
    assert.equal(result.classification, 'D');
    assert.equal(result.pepperReadiness.status, 'unavailable');
    assert.equal(result.playbackSucceeded, true, 'player facts remain separate from runner classification');
});

test('sticky state from the previous run cannot satisfy the current run', () => {
    const stale = {ready: true, runId: 'run-old', readyAt: 200, readyBridgeMatches: true};
    assert.equal(evidence.isCurrentReadyState(stale, {runId: 'run-new', startedAt: 100}), false);
    assert.equal(evidence.isCurrentReadyState(stale, {runId: 'run-old', startedAt: 100}), true);
    assert.equal(evidence.isCurrentReadyState({ready: true, runId: 'run-new', readyAt: 50, readyBridgeMatches: true}, {runId: 'run-new', startedAt: 100}), false);
});
