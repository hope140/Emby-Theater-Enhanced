'use strict';

const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const output = process.argv[2];
const scenario = process.argv[3] || 'timeout';
if (!output) throw new Error('Synthetic output is required');

process.stdout.write('synthetic-stdout');
process.stderr.write('synthetic-stderr');
if (scenario !== 'timeout') {
    const acceptanceResult = scenario === 'success' || scenario === 'identity-mismatch' || scenario === 'pid-reuse-descendant' || scenario === 'cim-unavailable' ? 'success' : 'synthetic-failure';
    fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({
        completed: true,
        acceptanceResult,
        error: scenario === 'failure' ? 'synthetic-failure' : null
    }));
}

if (scenario === 'identity-mismatch') setTimeout(function () { process.exit(0); }, 5000);
if (scenario === 'cim-unavailable') setTimeout(function () { process.exit(0); }, 1500);
if (scenario === 'pid-reuse-descendant') setTimeout(function () {
    const descendant = spawn(process.execPath, ['-e', 'setTimeout(function () {}, 15000);'], {stdio: 'ignore', windowsHide: true});
    fs.writeFileSync(path.join(output, 'synthetic-descendant-pid.txt'), String(descendant.pid));
}, 1100);
if (scenario === 'pid-reuse-descendant') setTimeout(function () { process.exit(0); }, 15000);
setTimeout(function () {}, 60000);
