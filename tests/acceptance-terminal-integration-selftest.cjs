'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createTerminalWriter} = require('../tools/acceptance-terminal-guard.cjs');

function makeHarness() {
    const report = {completed: false};
    const writes = [];
    const exits = [];
    const end = createTerminalWriter({
        report,
        save: () => writes.push(JSON.parse(JSON.stringify(report))),
        exit: code => exits.push(code)
    });
    return {report, writes, exits, end};
}

async function inspectProfile(end) {
    const result = await new Promise(resolve => setImmediate(() => resolve({loggedIn: false, reason: 'inspection-error'})));
    const reason = typeof result.reason === 'string' ? result.reason : 'inspection-error';
    return end(null, {profile: {loggedIn: !!result.loggedIn, reason}, classification: reason});
}

async function main() {
    const acceptanceSource = fs.readFileSync(path.join(__dirname, '../tools/acceptance-electron.cjs'), 'utf8');
    const inspectBody = acceptanceSource.match(/async function inspectProfile\(\)\{([\s\S]*?)\n\}/);
    assert(inspectBody, 'acceptance-electron inspectProfile must remain present');
    assert.match(acceptanceSource, /const end=createTerminalWriter\(/);
    assert.match(inspectBody[1], /await end\(null,\{profile:/);
    assert.doesNotMatch(inspectBody[1], /report\.(completed|acceptanceResult|failure)\s*=/);

    const profileRace = makeHarness();
    const inspect = inspectProfile(profileRace.end);
    const timeout = new Promise(resolve => setImmediate(() => resolve(profileRace.end('acceptance-timeout', {
        profile: {loggedIn: false, reason: 'inspection-error'},
        classification: 'acceptance-timeout'
    }))));
    assert.deepStrictEqual(await Promise.all([inspect, timeout]), [true, false]);
    assert.strictEqual(profileRace.report.acceptanceResult, 'inspection-error');
    assert.strictEqual(profileRace.report.error, null);
    assert.strictEqual(profileRace.report.completed, true);
    assert.strictEqual(profileRace.writes.length, 1);
    assert.deepStrictEqual(profileRace.exits, [0]);

    const losingWriter = makeHarness();
    assert.strictEqual(await losingWriter.end(null, {classification: 'success'}), true);
    assert.strictEqual(await losingWriter.end('select-failed', {
        failure: {method: 'select', failureClassification: 'select-failed'},
        classification: 'select-failed'
    }), false);
    assert.strictEqual(losingWriter.report.acceptanceResult, 'success');
    assert.strictEqual(losingWriter.report.error, null);
    assert.strictEqual(losingWriter.report.failure, undefined);
    assert.strictEqual(losingWriter.report.completed, true);
    assert.strictEqual(losingWriter.writes.length, 1);
    assert.deepStrictEqual(losingWriter.exits, [0]);

    console.log('acceptance terminal integration self-test: PASS');
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
