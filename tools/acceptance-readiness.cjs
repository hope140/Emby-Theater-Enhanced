'use strict';

const stages = ['play-called', 'embed-created', 'pepper-ready', 'manager-play-resolved', 'resolver-result', 'loadfile'];
const failureClasses = ['api-client-unavailable', 'playback-manager-unavailable', 'events-unavailable', 'embed-create-timeout', 'pepper-ready-timeout', 'manager-play-completion-timeout', 'resolver-result-timeout'];

function safe(value, limit) {
    const text = String(value == null ? '' : value).replace(/[\r\n\t]/g, ' ').trim();
    return text.slice(0, limit || 80);
}

function createRecorder() {
    const rows = new Map();
    let resolverRows = [];
    function mark(stage, elapsedMs, status) {
        if (!stages.includes(stage) || rows.has(stage)) return;
        rows.set(stage, { stage, elapsedMs: Math.round(Number(elapsedMs) || 0), status: status || 'seen' });
    }
    function sanitizeState(state) {
        if (!state || typeof state !== 'object') return null;
        const timeline = Array.isArray(state.timeline) ? state.timeline.filter(row => row && stages.includes(row.stage) && Number.isFinite(Number(row.elapsedMs))).map(row => ({
            stage: row.stage,
            elapsedMs: Math.round(Number(row.elapsedMs)),
            status: row.status === 'seen' ? 'seen' : 'missing'
        })) : [];
        const seen = new Set();
        return {
            version: state.version === 1 ? 1 : null,
            installedAt: Number.isFinite(Number(state.installedAt)) ? Number(state.installedAt) : null,
            installElapsedMs: Number.isFinite(Number(state.installElapsedMs)) ? Math.round(Number(state.installElapsedMs)) : null,
            elapsedMs: Number.isFinite(Number(state.elapsedMs)) ? Math.round(Number(state.elapsedMs)) : null,
            timeline: timeline.filter(row => !seen.has(row.stage) && seen.add(row.stage)),
            messageSummary: Array.isArray(state.messageSummary) ? state.messageSummary.slice(0, 32).map(row => ({
                direction: row && row.direction === 'out' ? 'out' : 'in',
                type: safe(row && row.type, 32) || 'unknown',
                command: row && row.command ? safe(row.command, 32) : null
            })) : [],
            nativeBootstrapReadySeen: state.nativeBootstrapReadySeen === true,
            diagnosticsHookInstalled: state.diagnosticsHookInstalled === true,
            diagnosticsReadySeen: state.diagnosticsReadySeen === true,
            diagnosticsPlayingSeen: state.diagnosticsPlayingSeen === true,
            pepperAuthoritativeReady: state.pepperAuthoritativeReady === true,
            resolverResultSeen: state.resolverResultSeen === true,
            loadfileSeen: state.loadfileSeen === true,
            loadfileObservation: state.loadfileObservation === 'available' ? 'available' : 'unavailable',
            lastError: state.lastError ? safe(state.lastError, 80) : null
        };
    }
    function rendererElapsed(report, stage) {
        const state = report.readinessState;
        const row = state && Array.isArray(state.timeline) ? state.timeline.find(item => item.stage === stage && item.status === 'seen') : null;
        return row ? row.elapsedMs : null;
    }
    function elapsed(report, stage) {
        const row = rows.get(stage);
        return row ? row.elapsedMs : rendererElapsed(report, stage);
    }
    function build(report) {
        const failure = report.failure || null;
        const classification = failure && failureClasses.includes(failure.failureClassification) ? failure.failureClassification : null;
        const loadfileObservation = report.readinessState && report.readinessState.loadfileObservation === 'available' ? 'available' : 'unavailable';
        const timeline = stages.map(stage => {
            const value = elapsed(report, stage);
            return { stage, elapsedMs: value, status: value === null ? (stage === 'loadfile' ? loadfileObservation : 'missing') : 'seen' };
        });
        const playChain = {};
        for (const stage of stages) playChain[stage.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) + 'Ms'] = elapsed(report, stage);
        return {
            stages: timeline,
            playChain,
            result: classification || (timeline.filter(row => row.status !== 'unavailable').every(row => row.status === 'seen') ? 'success' : 'incomplete'),
            failureClassification: classification,
            failureStage: failure ? safe(failure.stage || failure.reason, 48) : null,
            failureReason: failure ? safe(failure.reason, 80) : null,
            errorType: failure && failure.errorType ? safe(failure.errorType, 32) : null,
            loadfileObservation,
            resolverRows
        };
    }
    return { mark, sanitizeState, setResolverRows: rowsToStore => { resolverRows = Array.isArray(rowsToStore) ? rowsToStore : []; }, build };
}

module.exports = { createRecorder, stages, failureClasses };
