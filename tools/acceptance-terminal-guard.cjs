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

module.exports = {createFinishOnce};
