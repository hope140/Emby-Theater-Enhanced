'use strict';

function createFinishOnce(finalize) {
    if (typeof finalize !== 'function') throw new TypeError('finalize must be a function');
    let state = 'OPEN';
    const finishOnce = async function () {
        if (state !== 'OPEN') return false;
        state = 'FINALIZING';
        try {
            await finalize.apply(this, arguments);
            return true;
        } finally {
            state = 'COMPLETED';
        }
    };
    finishOnce.state = () => state;
    return finishOnce;
}

function createTerminalWriter(options) {
    if (!options || !options.report || typeof options.save !== 'function' || typeof options.exit !== 'function') {
        throw new TypeError('report, save and exit are required');
    }
    const report = options.report;
    return createFinishOnce(async function (error, details) {
        const terminal = details || {};
        if (terminal.profile) {
            report.loggedIn = !!terminal.profile.loggedIn;
            report.reason = typeof terminal.profile.reason === 'string' ? terminal.profile.reason : 'inspection-error';
        }
        if (terminal.failure) report.failure = terminal.failure;
        if (terminal.operationError) report.operationError = terminal.operationError;
        if (typeof options.beforeWrite === 'function') {
            try { await options.beforeWrite(error, terminal); } catch (_) { }
        }
        report.error = error || null;
        report.acceptanceResult = typeof terminal.classification === 'string' && terminal.classification
            ? terminal.classification
            : (error ? String(error) : 'success');
        report.completed = true;
        options.save();
        options.exit(error ? 1 : 0);
    });
}

module.exports = {createFinishOnce, createTerminalWriter};
