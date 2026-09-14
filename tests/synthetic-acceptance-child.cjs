'use strict';

const fs = require('fs');
const path = require('path');

const output = process.argv[2];
const scenario = process.argv[3] || 'timeout';
if (!output) throw new Error('Synthetic output is required');

process.stdout.write('synthetic-stdout');
process.stderr.write('synthetic-stderr');
if (scenario !== 'timeout') {
    const acceptanceResult = scenario === 'success' || scenario === 'identity-mismatch' ? 'success' : 'synthetic-failure';
    fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({
        completed: true,
        acceptanceResult,
        error: scenario === 'failure' ? 'synthetic-failure' : null
    }));
}

if (scenario === 'identity-mismatch') setTimeout(function () { process.exit(0); }, 2000);
setTimeout(function () {}, 60000);
