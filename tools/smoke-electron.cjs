'use strict';
// Run with the frozen Electron, not the development Node. No server login is used.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const runtime = process.env.ETE_TEST_RUNTIME;
const evidence = process.env.ETE_TEST_EVIDENCE;
if (!runtime || !evidence) throw Error('ETE_TEST_RUNTIME and ETE_TEST_EVIDENCE are required');
app.setName('emby-theater-enhanced-smoke');
let fixtureUrl;
const mediaRequests = [];
if (process.env.ETE_TEST_PIPELINE) {
    const media = fs.readFileSync(process.env.ETE_TEST_MEDIA);
    const server = require('http').createServer((request,response) => {
        mediaRequests.push({method:request.method,range:request.headers.range || null});
        if (request.url !== '/fixture.y4m') { response.writeHead(404); return response.end(); }
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
    fs.writeFileSync(path.join(evidence, 'electron-smoke.json'), JSON.stringify(result, null, 2));
    app.exit(result.ok ? 0 : 1);
}
setTimeout(async () => {
    const trace = testWindow ? await testWindow.webContents.executeJavaScript('window.__pipelineTrace || []').catch(()=>[]) : [];
    finish({ok:false, error:'UI smoke timeout', trace, mediaRequests});
}, 25000);
app.on('browser-window-created', (_, win) => {
    testWindow = win;
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
                    state.pipeline = await win.webContents.executeJavaScript(source + '\nrunPipelineFixture(' + JSON.stringify(fixtureUrl) + ', ' + JSON.stringify(process.env.ETE_TEST_MOUNT_SIDECAR || null) + ')');
                    if (!Object.values(state.pipeline.next).every(Boolean) || !state.pipeline.results.every(result => result.playerId==='libmpvmediaplayer' && Object.entries(result).filter(([k])=>!['kind','playerId'].includes(k)).every(([,v])=>v===true))) {
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
require(path.join(runtime, 'electronapp/main.js'));
