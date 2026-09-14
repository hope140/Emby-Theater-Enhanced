'use strict';

const fs = require('fs');

const TARGET_MARKER = 'modules/externalplayer/plugin';
const REGISTRATION_PATTERN = /responses\.electron\s*&&\s*list\.push\(\s*(["'])modules\/externalplayer\/plugin\1\s*\)/g;

function findRegistrations(text) {
    return Array.from(text.matchAll(REGISTRATION_PATTERN));
}

function patchFile(file) {
    const original = fs.readFileSync(file, 'utf8');
    const matches = findRegistrations(original);
    if (matches.length > 1) {
        throw new Error('Multiple Electron External Player registrations found.');
    }
    if (matches.length === 0) {
        if (original.includes(TARGET_MARKER)) {
            throw new Error('Unrecognized Electron External Player registration variant found.');
        }
        return {status: 'passed', action: 'already-clean', matchesBefore: 0, matchesAfter: 0};
    }

    const patched = original.replace(REGISTRATION_PATTERN, 'false');
    const remaining = findRegistrations(patched);
    if (remaining.length !== 0 || patched.includes(TARGET_MARKER)) {
        throw new Error('Electron External Player registration remains after patch.');
    }
    fs.writeFileSync(file, patched, 'utf8');
    return {status: 'passed', action: 'patched', matchesBefore: matches.length, matchesAfter: remaining.length};
}

if (require.main === module) {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: patch-external-player-registration.cjs <app.js>');
    process.stdout.write(JSON.stringify(patchFile(file)) + '\n');
}

module.exports = {patchFile};
