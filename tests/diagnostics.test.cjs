'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const diagnostics = require('../src/electronapp/enhanced/diagnostics');

class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name) { this.listeners.delete(name); }
    reply(name, detail) { if (this.listeners.has(name)) this.listeners.get(name)({ detail }); }
}
test('real embed replies are scoped to the bridge and ignore unrelated properties', async () => {
    const listeners = new Set();
    const bridge = {
        addEventListener(name,callback) { assert.equal(name,'message'); listeners.add(callback); },
        removeEventListener(name,callback) { listeners.delete(callback); },
        postMessage() { setTimeout(()=> {
            for(const listener of listeners) listener({data:{type:'property_change',data:{name:'other',value:'bad'}}});
            for(const listener of listeners) listener({data:{type:'property_change',data:{name:'vo',value:'gpu-next'}}});
        },1); }
    };
    const result = await diagnostics.readProperty(bridge,null,'vo',30);
    assert.equal(result.value,'gpu-next');
    assert.equal(listeners.size,0);
});
test('overlapping ready and playing collections serialize on the same bridge', async () => {
    const target = new Target();
    const bridge = { postMessage(m) { if(m.type!=='get_property_async') return; setTimeout(()=>target.reply(m.data,m.data.includes('cache-bytes')?'3221225472':null),2); } };
    const results = await Promise.all([diagnostics.collect(bridge,target,'ready',50),diagnostics.collect(bridge,target,'playing',50)]);
    assert.deepEqual(results.map(r=>r.stage),['ready','playing']);
    assert.ok(results.every(r=>r.properties['demuxer-max-bytes'].value===3221225472));
    assert.equal(target.listeners.size,0);
});
test('missing properties time out and leave no listeners', async () => {
    const target = new Target();
    const result = await diagnostics.collect({ postMessage() {} }, target, 'playing', 15);
    assert.equal(Object.keys(result.properties).length, diagnostics.properties.length);
    assert.equal(result.properties.vo.status, 'timeout');
    assert.equal(target.listeners.size, 0);
});
test('cache diagnostics preserve native values across the signed and unsigned 32-bit boundaries', async () => {
    for (const bytes of [943718400, 2147483648, 3221225472, 4294967296, 8589934592]) {
        const target = new Target();
        const bridge = { postMessage(message) {
            if (message.type === 'set_property') {
                assert.deepEqual(message.data,{name:'user-data/emby-theater-enhanced/diagnostics/cache-bytes',value:''});
                return;
            }
            if (message.type === 'command') {
                assert.deepEqual(message.data, ['expand-properties','set','user-data/emby-theater-enhanced/diagnostics/cache-bytes','${=demuxer-max-bytes}']);
            } else {
                const name = message.data;
                target.reply(name, name === 'demuxer-max-bytes' ? bytes | 0 : name.includes('cache-bytes') ? String(bytes) : null);
            }
        } };
        const snapshot = await diagnostics.collect(bridge, target, 'playing', 20);
        assert.equal(snapshot.properties['demuxer-max-bytes'].value, bytes);
        assert.equal(snapshot.properties['demuxer-max-bytes'].legacyValue, bytes | 0);
        assert.deepEqual(diagnostics.sanitize(snapshot), snapshot);
        assert.equal(target.listeners.size, 0);
    }
});
test('unsupported precise cache transport is not reported as a valid zero or negative size', async () => {
    const target = new Target();
    const bridge = { postMessage(m) { if(m.type === 'get_property_async') target.reply(m.data, m.data === 'demuxer-max-bytes' ? 0 : null); } };
    const result = await diagnostics.collect(bridge, target, 'ready', 15);
    assert.equal(result.properties['demuxer-max-bytes'].status, 'unavailable');
    assert.equal(result.properties['demuxer-max-bytes'].value, undefined);
});
test('synchronous and asynchronous replies, nulls and throwing bridge remain bounded', async () => {
    const target = new Target();
    const bridge = { postMessage({data}) { target.reply(data, data === 'vo' ? 'gpu-next' : null); } };
    assert.deepEqual(await diagnostics.readProperty(bridge, target, 'vo', 20), {status:'ok', value:'gpu-next'});
    assert.equal((await diagnostics.readProperty(bridge, target, 'missing', 20)).status, 'unavailable');
    assert.equal((await diagnostics.readProperty({postMessage() {throw Error('x');}}, target, 'vo', 20)).status, 'error');
    assert.equal((await diagnostics.readProperty(null, target, 'vo', 20)).status, 'no-player');
    assert.equal(target.listeners.size, 0);
});
test('diagnostic output omits paths, credentials and unlisted fields; sanitizer is idempotent', () => {
    const result = diagnostics.sanitize({stage:'playing', token:'secret', properties:{
        'glsl-shaders':{status:'ok',value:['C:\\private\\one.glsl']},
        'config-dir':{status:'ok',value:'C:\\private'},
        'sub-font':{status:'ok',value:'https://private/?token=secret'},
        'path':{status:'ok',value:'private-movie'},
        'video-params':{status:'ok',value:{w:1920,h:1080}}
    }});
    assert.doesNotMatch(JSON.stringify(result), /private|secret|token/);
    assert.equal(result.properties['glsl-shaders'].count, 1);
    assert.deepEqual(diagnostics.sanitize(result), result);
});
test('legacy external player cannot select media, expose settings, or spawn with persisted settings', async () => {
    let Constructor;
    vm.runInNewContext(fs.readFileSync('src/electronapp/www/modules/externalplayer/plugin.js','utf8'), {
        define(deps, factory) { Constructor = factory(null,null,{get() {throw Error('old settings accessed');}},null,{exec() {throw Error('spawn');}}); }, Promise, Error
    });
    const player = new Constructor();
    assert.equal(player.canPlayMediaType('Video'), false);
    assert.equal(player.canPlayItem({}), false);
    assert.equal(player.getRoutes().length, 0);
    await assert.rejects(player.play({}), /disabled/);
});
