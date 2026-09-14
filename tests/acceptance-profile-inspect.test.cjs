const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../tools/acceptance-profile-inspect.js'), 'utf8');
const inspectAcceptanceProfile = Function(`return (${source})`)();

function loader(connectionManager) {
    return (_modules, onLoad) => onLoad(connectionManager);
}

function promiseLoader(connectionManager) {
    return () => Promise.resolve(connectionManager);
}

function assertSafeResult(actual, expected) {
    assert.deepEqual(actual, expected);
    assert.deepEqual(Object.keys(actual).sort(), ['loggedIn', 'reason']);
}

test('profile inspect requires a client and a successful current user lookup', async () => {
    assertSafeResult(await inspectAcceptanceProfile(loader({
        currentApiClient: () => ({getCurrentUser: () => Promise.resolve({Id: 'fixture-user'})})
    })), {loggedIn: true, reason: 'logged-in'});

    assertSafeResult(await inspectAcceptanceProfile(promiseLoader({
        currentApiClient: () => ({getCurrentUser: () => Promise.resolve({Id: 'fixture-user'})})
    })), {loggedIn: true, reason: 'logged-in'});

    assertSafeResult(await inspectAcceptanceProfile(null, {
        connectionManager: {currentApiClient: () => ({getCurrentUser: () => Promise.resolve({Id: 'fixture-user'})})}
    }), {loggedIn: true, reason: 'logged-in'});

    let delayedConnectionManager;
    const delayed = inspectAcceptanceProfile(null, {
        pollTimeoutMs: 100,
        pollIntervalMs: 1,
        getConnectionManager: () => delayedConnectionManager
    });
    delayedConnectionManager = {currentApiClient: () => ({getCurrentUser: () => Promise.resolve({Id: 'fixture-user'})})};
    assertSafeResult(await delayed, {loggedIn: true, reason: 'logged-in'});

    assertSafeResult(await inspectAcceptanceProfile(loader({
        currentApiClient: () => ({getCurrentUser: () => Promise.resolve(null)})
    })), {loggedIn: false, reason: 'not-logged-in'});

    assertSafeResult(await inspectAcceptanceProfile(loader({
        currentApiClient: () => null
    }), {pollTimeoutMs: 0, pollIntervalMs: 0}), {loggedIn: false, reason: 'not-logged-in'});
});

test('profile inspect collapses rejected, malformed and timed-out lookups to safe enums', async () => {
    const secretError = new Error('https://server.example.test user@example.test token=secret');
    const rejected = await inspectAcceptanceProfile(loader({
        currentApiClient: () => ({getCurrentUser: () => Promise.reject(secretError)})
    }));
    assertSafeResult(rejected, {loggedIn: false, reason: 'not-logged-in'});
    assert.equal(JSON.stringify(rejected).includes('server.example.test'), false);
    assert.equal(JSON.stringify(rejected).includes('secret'), false);

    assertSafeResult(await inspectAcceptanceProfile(loader({
        currentApiClient: () => ({getCurrentUser: () => Promise.resolve('unexpected-user')})
    })), {loggedIn: false, reason: 'not-logged-in'});

    assertSafeResult(await inspectAcceptanceProfile(loader({
        currentApiClient: () => ({getCurrentUser: () => new Promise(() => {})})
    }), {userTimeoutMs: 5}), {loggedIn: false, reason: 'inspection-error'});

    assertSafeResult(await inspectAcceptanceProfile(loader({
        currentApiClient: () => ({getCurrentUser: () => { throw secretError; }})
    })), {loggedIn: false, reason: 'inspection-error'});
});

test('profile inspect treats loader and client failures as safe inspection errors', async () => {
    const loadFailure = await inspectAcceptanceProfile((_modules, _onLoad, onError) => onError(new Error('raw failure')));
    assertSafeResult(loadFailure, {loggedIn: false, reason: 'inspection-error'});

    const clientFailure = await inspectAcceptanceProfile(loader({
        currentApiClient: () => { throw new Error('raw failure'); }
    }));
    assertSafeResult(clientFailure, {loggedIn: false, reason: 'inspection-error'});

    assertSafeResult(await inspectAcceptanceProfile(null), {loggedIn: false, reason: 'inspection-error'});
});
