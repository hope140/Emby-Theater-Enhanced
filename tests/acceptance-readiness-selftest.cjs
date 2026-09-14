'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'acceptance-readiness.js'), 'utf8');

function makeEmbed() {
    const listeners = Object.create(null);
    return {
        type: 'application/x-mpvjs',
        addEventListener(name, listener) { (listeners[name] || (listeners[name] = [])).push(listener); },
        removeEventListener(name, listener) { if (listeners[name]) listeners[name] = listeners[name].filter(item => item !== listener); },
        emit(name, data) { for (const listener of (listeners[name] || []).slice()) listener({ data }); },
        postMessage() { }
    };
}

function makeContext(embed, diagnostics) {
    const window = { __eteEpoch: Date.now(), enhancedDiagnostics: diagnostics };
    const document = { current: null, querySelector() { return this.current; } };
    const context = { window, document, console: { log() { } }, Date, Math, Array, Object, String, Number, setTimeout, setInterval, clearTimeout, clearInterval };
    vm.createContext(context);
    return { context, window, document };
}

async function main() {
    const embed = makeEmbed();
    const firstContext = makeContext(embed, function () { });
    vm.runInContext(source, firstContext.context);
    const first = firstContext.window.__eteReadiness;
    vm.runInContext(source, firstContext.context);
    assert.strictEqual(firstContext.window.__eteReadiness, first, 'duplicate install must reuse the observer');
    assert.strictEqual(first.snapshot().diagnosticsHookInstalled, true, 'diagnostics wrapper should be installed');

    firstContext.document.current = embed;
    await new Promise(resolve => setTimeout(resolve, 100));
    embed.emit('message', { type: 'ready' });
    embed.postMessage({ type: 'command', data: ['loadfile', 'redacted'] });
    firstContext.window.enhancedDiagnostics(embed, 'ready');
    firstContext.window.enhancedDiagnostics(embed, 'playing');
    first.mark('play-called');
    first.mark('manager-play-resolved');
    const observed = first.snapshot();
    assert.strictEqual(observed.nativeBootstrapReadySeen, true);
    assert.strictEqual(observed.pepperAuthoritativeReady, true);
    assert.strictEqual(observed.diagnosticsPlayingSeen, true);
    assert.strictEqual(observed.loadfileSeen, true);
    assert.strictEqual(observed.loadfileObservation, 'available');
    assert(observed.messageSummary.some(row => row.type === 'ready'));
    assert(observed.messageSummary.some(row => row.command === 'loadfile'));
    assert(observed.timeline.some(row => row.stage === 'play-called'));
    assert.strictEqual(JSON.parse(JSON.stringify(observed)).pepperAuthoritativeReady, true);
    first.cleanup();

    const missingEmbed = makeEmbed();
    const missingContext = makeContext(missingEmbed, function () { });
    vm.runInContext(source, missingContext.context);
    missingContext.document.current = missingEmbed;
    await new Promise(resolve => setTimeout(resolve, 100));
    missingEmbed.emit('message', { type: 'ready' });
    const missing = missingContext.window.__eteReadiness.snapshot();
    assert.strictEqual(missing.nativeBootstrapReadySeen, true);
    assert.strictEqual(missing.pepperAuthoritativeReady, false, 'native bootstrap ready must not imply Pepper ready');
    assert.strictEqual(missing.diagnosticsPlayingSeen, false, 'unobserved playing must remain missing');
    assert.strictEqual(missing.loadfileObservation, 'unavailable');
    missingContext.window.__eteReadiness.cleanup();
    console.log('acceptance readiness self-test: PASS');
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
