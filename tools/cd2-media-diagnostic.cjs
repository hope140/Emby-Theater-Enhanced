'use strict';

const {app} = require('electron');
const fs = require('fs');
const path = require('path');

const runtime = process.env.ETE_DIAGNOSTIC_RUNTIME;
const evidence = process.env.ETE_DIAGNOSTIC_EVIDENCE;
const candidate = process.env.ETE_CD2_DIAGNOSTIC_CANDIDATE;
const localFixture = process.env.ETE_DIAGNOSTIC_LOCAL_FIXTURE;
const sampleClass = process.env.ETE_CD2_DIAGNOSTIC_CLASS || 'unknown';
if (!runtime || !evidence || !candidate || !localFixture) throw new Error('Diagnostic environment is incomplete.');

app.setName('emby-theater-enhanced-cd2-diagnostic');
let finished = false;

function finish(result) {
    if (finished) return;
    finished = true;
    fs.writeFileSync(path.join(evidence, 'cd2-media-diagnostic.json'), JSON.stringify(result, null, 2));
    app.exit(result.ok ? 0 : 1);
}

setTimeout(() => finish({ok: false, errorCategory: 'diagnostic_timeout', sampleClass}), 45000);
app.on('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
            try {
                const result = await win.webContents.executeJavaScript(`(async function () {
                    var dependencies = await new Promise(function (resolve, reject) {
                        require(['pluginManager', 'embyRouter'], function (plugins, router) { resolve([plugins, router]); }, reject);
                    });
                    dependencies[1].showVideoOsd = function () { return Promise.resolve(); };
                    var registered = dependencies[0].ofType('mediaplayer').find(function (player) { return player.id === 'libmpvmediaplayer'; });
                    var player = new registered.constructor();
                    var fixture = ${JSON.stringify(localFixture)};
                    await player.play({
                        item:{Id:'diagnostic-local',Name:'Diagnostic fixture',MediaType:'Video',Type:'Movie',Path:fixture},
                        mediaSource:{Id:'diagnostic-local-source',Path:fixture,Container:'y4m',MediaStreams:[],RunTimeTicks:50000000},
                        url:fixture,mediaType:'Video',fullscreen:false,playMethod:'DirectPlay'
                    });
                    await player.stop(false);
                    await new Promise(function (resolve) { setTimeout(resolve, 150); });

                    var resolved = await window.ipc.invoke('enhanced-cd2-resolve', {
                        requestId:'media-diagnostic', candidates:[${JSON.stringify(candidate)}]
                    });
                    if (!resolved || resolved.status !== 'hit') {
                        await player.stop(true);
                        return {ok:false, resolve:resolved && resolved.reason || 'miss', sampleClass:${JSON.stringify(sampleClass)}};
                    }

                    var bridge = document.querySelector('embed[type="application/x-mpvjs"]');
                    var state = {
                        pathAccepted:false,fileFormat:null,trackCount:0,audioTracks:0,videoTracks:0,
                        coreIdleFalse:false,corePlayingEvents:0,timeAdvanced:false,firstTime:null,maxTime:0,
                        cacheStateSeen:false,cacheTimeSeen:false,eofObserved:false
                    };
                    function safeFormat(value) {
                        return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(value) ? value : null;
                    }
                    function receive(event) {
                        var message = event.data || {};
                        if (message.type !== 'property_change' || !message.data) return;
                        var name = message.data.name;
                        var value = message.data.value;
                        if (name === 'path' && typeof value === 'string' && value === resolved.source && !state.pathAccepted) {
                            state.pathAccepted = true;
                            state.fileFormat = null;
                            state.trackCount = 0;
                            state.audioTracks = 0;
                            state.videoTracks = 0;
                            state.coreIdleFalse = false;
                            state.corePlayingEvents = 0;
                            state.timeAdvanced = false;
                            state.firstTime = null;
                            state.maxTime = 0;
                            state.cacheStateSeen = false;
                            state.cacheTimeSeen = false;
                            state.eofObserved = false;
                        } else if (!state.pathAccepted) return;
                        else if (name === 'file-format') state.fileFormat = safeFormat(value);
                        else if (name === 'track-list' && Array.isArray(value)) {
                            state.trackCount = value.length;
                            state.audioTracks = value.filter(function (track) { return track && track.type === 'audio'; }).length;
                            state.videoTracks = value.filter(function (track) { return track && track.type === 'video'; }).length;
                        } else if (name === 'core-idle' && value === false) state.coreIdleFalse = true;
                        else if (name === 'time-pos' && typeof value === 'number') {
                            if (state.firstTime === null) state.firstTime = value;
                            state.maxTime = Math.max(state.maxTime, value);
                            state.timeAdvanced = state.maxTime - state.firstTime > 0.1;
                        } else if (name === 'demuxer-cache-state' && value) state.cacheStateSeen = true;
                        else if (name === 'demuxer-cache-time' && value !== null && value !== undefined) state.cacheTimeSeen = true;
                        else if (name === 'eof-reached' && value === true) state.eofObserved = true;
                    }
                    function onCorePlaying() { state.corePlayingEvents++; }
                    bridge.addEventListener('message', receive);
                    window.addEventListener('core-playing', onCorePlaying);
                    ['path','file-format','track-list','core-idle','time-pos','demuxer-cache-state','demuxer-cache-time','eof-reached'].forEach(function (name) {
                        bridge.postMessage({type:'observe_property',data:name});
                    });
                    bridge.postMessage({type:'command',data:['loadfile',resolved.source]});
                    for (var i=0;i<300 && !state.timeAdvanced && !state.eofObserved;i++) {
                        await new Promise(function (resolve) { setTimeout(resolve, 100); });
                        if (state.pathAccepted && i % 10 === 0) {
                            ['file-format','track-list','core-idle','time-pos','demuxer-cache-state','demuxer-cache-time','eof-reached'].forEach(function (name) {
                                bridge.postMessage({type:'get_property_async',data:name});
                            });
                        }
                    }
                    bridge.removeEventListener('message', receive);
                    window.removeEventListener('core-playing', onCorePlaying);
                    await player.stop(true);
                    var fileLoadedInferred = !!state.fileFormat && state.trackCount > 0;
                    var corePlaying = state.corePlayingEvents > 0 && state.coreIdleFalse;
                    return {
                        ok:fileLoadedInferred && corePlaying && state.timeAdvanced,
                        resolve:'hit',sampleClass:${JSON.stringify(sampleClass)},
                        startFile:{observable:false,pathAccepted:state.pathAccepted},
                        fileLoaded:{observable:false,inferred:fileLoadedInferred,fileFormat:state.fileFormat,trackCount:state.trackCount,audioTracks:state.audioTracks,videoTracks:state.videoTracks},
                        corePlaying:{eventObserved:state.corePlayingEvents>0,coreIdleFalse:state.coreIdleFalse,timeAdvanced:state.timeAdvanced},
                        cache:{stateSeen:state.cacheStateSeen,timeSeen:state.cacheTimeSeen},
                        endFile:{observable:false,eofObserved:state.eofObserved},
                        errorCategory:fileLoadedInferred ? (corePlaying ? (state.timeAdvanced ? 'none' : 'playback_stalled') : 'core_not_playing') : (state.pathAccepted ? 'open_or_demux_failed' : 'loadfile_not_accepted')
                    };
                }())`);
                finish(result);
            } catch (error) {
                finish({ok:false,errorCategory:'diagnostic_operation_failed',errorType:error && error.name || 'Error',sampleClass});
            }
        }, 6500);
    });
});

require(path.join(runtime, 'electronapp', 'main.js'));
