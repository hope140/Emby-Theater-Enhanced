'use strict';

const assert = require('assert');
const {createFinishOnce} = require('../tools/acceptance-terminal-guard.cjs');

async function main() {
    const calls = [];
    let classification = null;
    const finishOnce = createFinishOnce(async value => {
        calls.push(value);
        await new Promise(resolve => setImmediate(resolve));
        classification = value;
    });
    const first = finishOnce('success');
    const second = finishOnce('timeout');
    const results = await Promise.all([first, second]);
    assert.deepStrictEqual(results, [true, false]);
    assert.deepStrictEqual(calls, ['success']);
    assert.strictEqual(classification, 'success');
    assert.strictEqual(finishOnce.state(), 'COMPLETED');
    console.log('acceptance terminal race self-test: PASS');
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
