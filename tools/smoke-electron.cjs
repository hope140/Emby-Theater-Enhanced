'use strict';
// Run with the frozen Electron, not the development Node. No server login is used.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const runtime = process.env.ETE_TEST_RUNTIME;
const evidence = process.env.ETE_TEST_EVIDENCE;
const testCd2Origin = process.env.ETE_CD2_ORIGIN || '';
if (!runtime || !evidence) throw Error('ETE_TEST_RUNTIME and ETE_TEST_EVIDENCE are required');
app.setName('emby-theater-enhanced-smoke');
let fixtureUrl;
const mediaRequests = [];
const resolverEvents = [];
let fakeCd2Stats;
if (process.env.ETE_TEST_PIPELINE) {
    const media = fs.readFileSync(process.env.ETE_TEST_MEDIA);
    const server = require('http').createServer((request,response) => {
        const parsedRequest = new URL(request.url, 'http://127.0.0.1');
        const directRequestId = parsedRequest.searchParams.get('cd2');
        const expectedDirectUa = directRequestId ? 'ETE-Direct-' + directRequestId : null;
        const observedUa = request.headers['user-agent'] || '';
        const directUaMatch = expectedDirectUa ? observedUa === expectedDirectUa : null;
        const directUaLeaked = !expectedDirectUa && observedUa.indexOf('ETE-Direct-') === 0;
        mediaRequests.push({
            method:request.method,
            range:request.headers.range || null,
            sourceKind:expectedDirectUa ? 'direct-url' : 'same-origin',
            directUaMatch:directUaMatch,
            directUaLeaked:directUaLeaked
        });
        if (parsedRequest.pathname !== '/fixture.y4m') { response.writeHead(404); return response.end(); }
        if ((expectedDirectUa && !directUaMatch) || directUaLeaked) { response.writeHead(403); return response.end(); }
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
        const start = match ? Number(match[1]) : 0;
        const end = match && match[2] ? Math.min(Number(match[2]),media.length-1) : media.length-1;
        if (start > end || start >= media.length) { response.writeHead(416); return response.end(); }
        const headers = {'Content-Type':'application/octet-stream','Accept-Ranges':'bytes','Content-Length':end-start+1};
        if(match) headers['Content-Range'] = 'bytes '+start+'-'+end+'/'+media.length;
        response.writeHead(match?206:200,headers);
        response.end(media.subarray(start,end+1));
    });
    server.listen(0,'127.0.0.1',()=> {
        fixtureUrl='http://127.0.0.1:'+server.address().port+'/fixture.y4m';
        fs.writeFileSync(path.join(evidence,'fixture.strm'),fixtureUrl+'\n');
    });
}
let completed = false;
let testWindow;
function finish(result) {
    if (completed) return;
    completed = true;
    result.cd2EnvironmentCleared = ['ETE_CD2_ENABLED','ETE_CD2_ORIGIN','ETE_CD2_TOKEN','ETE_CD2_LOCAL_PREFIX','ETE_CD2_CLOUD_PREFIX','ETE_CD2_DIRECT_URL']
        .every(name => process.env[name] === undefined);
    if (!result.cd2EnvironmentCleared) result.ok = false;
    result.mediaRequestSummary = {
        count: mediaRequests.length,
        rangeCount: mediaRequests.filter(request => request.range).length,
        directCount: mediaRequests.filter(request => request.sourceKind === 'direct-url').length
    };
    if (process.env.ETE_TEST_CD2_MODE === 'direct') {
        result.directHeaderIsolation = {
            directRequestsObserved: mediaRequests.some(request => request.sourceKind === 'direct-url'),
            allDirectUserAgentsMatched: mediaRequests.filter(request => request.sourceKind === 'direct-url').every(request => request.directUaMatch === true),
            noDirectUserAgentLeak: mediaRequests.filter(request => request.sourceKind === 'same-origin').every(request => request.directUaLeaked === false)
        };
        if (!Object.values(result.directHeaderIsolation).every(Boolean)) result.ok = false;
    }
    result.resolverEvents = resolverEvents;
    if (fakeCd2Stats) {
        result.cd2Fake = {
            resolveCount: fakeCd2Stats.resolveCount,
            cancelCount: fakeCd2Stats.cancelCount,
            completedCount: fakeCd2Stats.completedCount,
            activeCount: fakeCd2Stats.active.size
        };
    }
    fs.writeFileSync(path.join(evidence, 'electron-smoke.json'), JSON.stringify(result, null, 2));
    app.exit(result.ok ? 0 : 1);
}
setTimeout(async () => {
    const trace = testWindow ? await testWindow.webContents.executeJavaScript('window.__pipelineTrace || []').catch(()=>[]) : [];
    let sourceState = null;
    if (testWindow) {
        const expectedOrigin = testCd2Origin;
        const expectedOriginLiteral = JSON.stringify(expectedOrigin);
        sourceState = await testWindow.webContents.executeJavaScript(`new Promise(function(resolve) {
            require(['pluginManager'], function(pm) {
                var player = pm.ofType('mediaplayer').find(function(p) { return p.id === 'libmpvmediaplayer'; });
                var source = player && player.currentSrc && player.currentSrc();
                var kind = typeof source === 'string' && /^https?:/i.test(source) ? 'http' : typeof source === 'string' ? 'local' : 'absent';
                try { if (${expectedOriginLiteral} && new URL(source).origin === new URL(${expectedOriginLiteral}).origin) kind = 'cd2'; } catch (_) {}
                resolve({kind:kind, present:typeof source === 'string' && source.length > 0});
            });
        })`).catch(()=>null);
    }
    finish({ok:false, error:'UI smoke timeout', trace, sourceState, mediaRequests});
}, process.env.ETE_TEST_CD2_EXPECT === 'real' ? 45000 : 25000);
app.on('browser-window-created', (_, win) => {
    testWindow = win;
    win.webContents.on('console-message', (_, level, message) => {
        if (typeof message === 'string' && message.indexOf('STRM resolver:') === 0) resolverEvents.push(message);
    });
    if (!process.env.ETE_TEST_VISIBLE) win.on('show', () => win.hide());
    win.webContents.on('did-fail-load', (_, code, description) => finish({ok:false, code, description}));
    win.webContents.on('did-finish-load', () => {
        setTimeout(async () => {
            try {
                const state = await win.webContents.executeJavaScript(`new Promise(function(resolve) {
                    require(['pluginManager'], function(pm) {
                        resolve({ title: document.title, ready: !!(window.Emby && window.Emby.App),
                            textLength: document.body.innerText.length,
                            players: pm.ofType('mediaplayer').map(function(p) {return {id:p.id, name:p.name};}) });
                    });
                })`);
                const screenshot = await win.webContents.capturePage();
                state.screenshotAvailable = !screenshot.isEmpty();
                if (!screenshot.isEmpty()) fs.writeFileSync(path.join(evidence, 'startup.png'), screenshot.toPNG());
                if (process.env.ETE_TEST_PIPELINE) {
                    const source = fs.readFileSync(path.join(__dirname,'../tests/pipeline-browser.js'),'utf8');
                    state.pipeline = await win.webContents.executeJavaScript(source + '\nrunPipelineFixture(' + JSON.stringify(fixtureUrl) + ', ' + JSON.stringify(process.env.ETE_TEST_MOUNT_SIDECAR || null) + ', ' + JSON.stringify(process.env.ETE_TEST_CD2_EXPECT || process.env.ETE_TEST_CD2_MODE || null) + ', ' + JSON.stringify(testCd2Origin || null) + ', ' + JSON.stringify(process.env.ETE_TEST_STOP_BEFORE_PLAYER === '1') + ')');
                    if (process.env.ETE_TEST_STOP_BEFORE_PLAYER === '1') {
                        if (!state.pipeline.stopBeforePlayer || !Object.values(state.pipeline.stopBeforePlayer).every(Boolean)) {
                            return finish({ok:false,error:'Stop-before-player assertion failed',state});
                        }
                        return finish({ok:true,versions:process.versions,state});
                    }
                    if (!Object.values(state.pipeline.next).every(Boolean) || !state.pipeline.results.every(result => result.playerId==='libmpvmediaplayer' && Object.entries(result).filter(([k])=>!['kind','playerId'].includes(k)).every(([,v])=>v===true)) ||
                        (state.pipeline.generation && !Object.values(state.pipeline.generation).every(Boolean)) ||
                        ((process.env.ETE_TEST_CD2_MODE === 'hit' || process.env.ETE_TEST_CD2_MODE === 'direct') && fakeCd2Stats.cancelCount < 2)) {
                        return finish({ok:false,error:'Playback pipeline assertion failed',state});
                    }
                } else if (process.env.ETE_TEST_MEDIA) {
                    const fixture = JSON.stringify(process.env.ETE_TEST_MEDIA);
                    const playback = await win.webContents.executeJavaScript(`new Promise(function(resolve, reject) {
                        require(['pluginManager'], async function(pm) {
                            try {
                                const registered = pm.ofType('mediaplayer').find(p => p.id === 'libmpvmediaplayer');
                                // A separate instance avoids invoking server-session listeners without a server.
                                const p = new registered.constructor();
                                const item = {Id:'local-test-fixture', Name:'Synthetic local fixture', MediaType:'Video', Type:'Movie'};
                                const source = {Id:'fixture-source', Path:${fixture}, Container:'y4m', MediaStreams:[], RunTimeTicks:50000000};
                                await p.play({item:item, mediaSource:source, url:${fixture}, mediaType:'Video', fullscreen:false, playMethod:'DirectPlay'});
                                await new Promise(r=>setTimeout(r,900));
                                const advanced = p.currentTime() > 0;
                                const bridge = document.querySelector('embed[type="application/x-mpvjs"]');
                                function read(name) {
                                    return new Promise((resolve,reject) => {
                                        const timer = setTimeout(()=> { bridge.removeEventListener('message', receive); reject(Error('Property timeout: '+name)); }, 1500);
                                        function receive(event) {
                                            if(event.data.type !== 'property_change' || event.data.data.name !== name) return;
                                            clearTimeout(timer); bridge.removeEventListener('message', receive); resolve(event.data.data.value);
                                        }
                                        bridge.addEventListener('message', receive);
                                        bridge.postMessage({type:'get_property_async',data:name});
                                    });
                                }
                                const config = {scale:await read('scale'), font:await read('sub-font')};
                                const cache = [];
                                for (const mib of [900,2048,3072,4096,8192]) {
                                    bridge.postMessage({type:'set_property',data:{name:'demuxer-max-bytes',value:mib+'MiB'}});
                                    const raw = await read('demuxer-max-bytes');
                                    bridge.postMessage({type:'command',data:['expand-properties','set','user-data/ete-test-cache','$'+'{=demuxer-max-bytes}']});
                                    const precise = await read('user-data/ete-test-cache');
                                    cache.push({mib:mib,raw:raw,precise:precise});
                                }
                                bridge.postMessage({type:'set_property',data:{name:'demuxer-max-bytes',value:'3072MiB'}});
                                window.__eteProbe = {config:config,cache:cache};
                                window.__eteFixtureFrameReady = true;
                                p.pause();
                                await new Promise(r=>setTimeout(r,200));
                                const paused = p.paused();
                                p.currentTime(2000);
                                await new Promise(r=>setTimeout(r,250));
                                const sought = p.currentTime() >= 1800;
                                p.unpause();
                                await new Promise(r=>setTimeout(r,300));
                                const resumed = !p.paused();
                                let stopped = false;
                                require(['events'], function(events) { events.on(p, 'stopped', function() { stopped = true; }); });
                                await new Promise(r=>setTimeout(r,100));
                                await p.stop();
                                resolve({advanced:advanced, paused:paused, sought:sought, resumed:resumed, stopped:stopped});
                            } catch(e) { reject(String(e)); }
                        });
                    })`);
                    state.playback = playback;
                    state.probe = await win.webContents.executeJavaScript('window.__eteProbe');
                    if (state.probe.config.scale !== 'bilinear' || state.probe.config.font !== 'ETE-CONFIG-PROBE' ||
                        !state.probe.cache.every(row => typeof row.precise === 'string' && Number(row.precise) === row.mib*1048576 && row.raw === ((row.mib*1048576)|0))) {
                        return finish({ok:false, error:'Configuration or cache probe mismatch', state});
                    }
                    if (!Object.values(playback).every(Boolean)) return finish({ok:false, versions:process.versions, state});
                }
                finish({ok:state.ready && state.players.some(p=>p.id==='libmpvmediaplayer') && !state.players.some(p=>p.id==='externalplayer'), versions:process.versions, state});
            } catch(error) { finish({ok:false, error:String(error)}); }
        }, 6500);
    });
});

if (process.env.ETE_TEST_CD2_MODE) {
    fakeCd2Stats = {resolveCount: 0, cancelCount: 0, completedCount: 0, active: new Map()};
    const serviceModule = require(path.join(runtime, 'electronapp/enhanced/cd2-service.js'));
    serviceModule.createService = function () {
        return {
            resolve(request) {
                fakeCd2Stats.resolveCount++;
                return new Promise(resolve => {
                    const timer = setTimeout(() => {
                        fakeCd2Stats.active.delete(request.requestId);
                        fakeCd2Stats.completedCount++;
                        if (process.env.ETE_TEST_CD2_MODE === 'hit') {
                            resolve({status:'hit',type:'url',source:fixtureUrl+'?cd2='+encodeURIComponent(request.requestId)});
                        } else if (process.env.ETE_TEST_CD2_MODE === 'direct') {
                            resolve({
                                status:'hit',type:'url',sourceKind:'direct-url',reason:'direct_hit',
                                source:fixtureUrl+'?cd2='+encodeURIComponent(request.requestId),
                                requestOptions:{userAgent:'ETE-Direct-'+request.requestId}
                            });
                        } else {
                            resolve({status:'miss',reason:'unavailable'});
                        }
                    }, 400);
                    fakeCd2Stats.active.set(request.requestId, {timer, resolve});
                });
            },
            cancel(requestId) {
                const entry = fakeCd2Stats.active.get(requestId);
                if (!entry) return false;
                fakeCd2Stats.cancelCount++;
                clearTimeout(entry.timer);
                fakeCd2Stats.active.delete(requestId);
                entry.resolve({status:'cancelled',reason:'cancelled'});
                return true;
            },
            close() {
                for (const requestId of Array.from(fakeCd2Stats.active.keys())) this.cancel(requestId);
            }
        };
    };
}
require(path.join(runtime, 'electronapp/main.js'));
