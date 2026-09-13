// Executed only by the local integration harness in an isolated Electron profile.
// Real PlaybackManager + ApiClient report serializers + message dispatcher;
// API responses and delivery are in memory, not a real Emby server/session.
async function runPipelineFixture(fixture) {
    const trace = window.__pipelineTrace = [];
    window.addEventListener('unhandledrejection', event=>trace.push('rejection: '+String(event.reason)));
    const deps = await new Promise((resolve,reject) => require([
        'playbackManager','connectionManager','events','pluginManager',
        'modules/emby-apiclient/apiclient','modules/common/input/api','embyRouter'
    ], (...args)=>resolve(args), reject));
    const [manager, connections, events, plugins, ApiClientModule] = deps;
    // No authenticated navigation exists in this fixture. Keep the real playback
    // context fullscreen (and reportable), while replacing only OSD navigation.
    deps[6].showVideoOsd = () => Promise.resolve();
    const embedded = plugins.ofType('mediaplayer').find(p=>p.id==='libmpvmediaplayer');
    const originalPlay = embedded.play;
    embedded.play = function(options) { trace.push('embedded.play source-match='+String(options.url===fixture)+' method='+options.playMethod); return originalPlay.call(this,options); };
    trace.push('modules loaded');
    const ApiClient = ApiClientModule.default || ApiClientModule;
    const api = new ApiClient(window.localStorage, null, 'http://127.0.0.1:1', 'Enhanced fixture', '0.1.0', 'Fixture', 'fixture-device', 1);
    const records = [];
    const calls = [];
    const items = new Map();
    let activeItem;
    api.serverInfo = () => ({Id:'fixture-server'});
    api.serverId = () => 'fixture-server';
    api.getCurrentUserId = () => 'fixture-user';
    api.getCurrentUser = () => Promise.resolve({Id:'fixture-user',Configuration:{},Policy:{EnableMediaPlayback:true}});
    api.getSavedEndpointInfo = () => ({IsInNetwork:true,IsLocal:true});
    api.getEndpointInfo = () => Promise.resolve({IsInNetwork:true,IsLocal:true});
    api.detectBitrate = () => Promise.resolve(200000000);
    api.getIntros = () => Promise.resolve({Items:[]});
    api.ensureWebSocket = () => { calls.push('ensureWebSocket'); };
    api.getPlaybackInfo = (id) => {
        trace.push('PlaybackInfo');
        calls.push('PlaybackInfo');
        const selected = items.get(id) || activeItem;
        return Promise.resolve({PlaySessionId:'play-'+selected.Id,MediaSources:[{
            Id:'source-'+selected.Id,Path:fixture,Protocol:'Http',IsRemote:false,Container:'y4m',
            MediaStreams:[],RunTimeTicks:50000000,SupportsDirectPlay:true,
            SupportsDirectStream:true,SupportsTranscoding:false,RequiredHttpHeaders:[]
        }]});
    };
    api.getItem = (user,id) => Promise.resolve(items.get(id) || activeItem);
    api.getItems = () => Promise.resolve({Items:[activeItem],TotalRecordCount:1});
    api.ajax = request => {
        trace.push('ajax: '+new URL(request.url).pathname);
        if (request.url.includes('/Sessions/Playing')) {
            records.push({endpoint:new URL(request.url).pathname,body:JSON.parse(request.data)});
            return Promise.resolve();
        }
        return Promise.reject(Error('Unexpected fixture API request: '+new URL(request.url).pathname));
    };
    api.stopActiveEncodings = () => Promise.resolve();
    connections.getApiClient = () => api;
    connections.currentApiClient = () => api;
    connections.getApiClients = () => [api];
    events.trigger(connections, 'apiclientcreated', [api]);
    const sleep = ms => new Promise(r=>setTimeout(r,ms));
    const send = (command, extra) => events.trigger(api, 'message', [{MessageType:'Playstate',Data:Object.assign({Command:command},extra)}]);
    const results = [];
    for (const kind of ['video','strm']) {
        trace.push('starting '+kind);
        activeItem = {Id:'fixture-'+kind,ServerId:'fixture-server',Name:'Synthetic '+kind,
            MediaType:'Video',Type:'Movie',Path:kind==='strm'?'fixture-sidecar.strm':fixture,
            RunTimeTicks:50000000,UserData:{},MediaStreams:[]};
        items.set(activeItem.Id,activeItem);
        await manager.play({items:[activeItem],fullscreen:true,startPositionTicks:0});
        trace.push('playing '+kind);
        await sleep(600);
        const player = manager._currentPlayer;
        const state = manager.getPlayerState();
        send('Pause'); await sleep(150); const paused=player.paused();
        send('Seek',{SeekPositionTicks:20000000}); await sleep(200); const sought=player.currentTime()>=1800;
        send('Unpause'); await sleep(200); const resumed=!player.paused();
        send('Stop'); await sleep(250);
        const itemRecords=records.filter(r=>r.body.ItemId===activeItem.Id);
        const start=itemRecords.find(r=>r.endpoint.endsWith('/Playing'));
        const progress=itemRecords.filter(r=>r.endpoint.endsWith('/Progress'));
        const stop=itemRecords.find(r=>r.endpoint.endsWith('/Stopped'));
        results.push({kind,playerId:player.id,paused,sought,resumed,
            itemSidecarPreserved:state.NowPlayingItem.Path===activeItem.Path,
            sourcePreserved:state.MediaSource.Path===fixture,
            sessionPreserved:!!start && !!stop && itemRecords.every(r=>r.body.PlaySessionId==='play-'+activeItem.Id && r.body.MediaSourceId==='source-'+activeItem.Id),
            hasStart:!!start,hasProgress:progress.length>0,hasStop:!!stop,
            pauseReported:progress.some(r=>r.body.IsPaused===true),
            seekReported:progress.some(r=>r.body.PositionTicks>=18000000)});
    }
    const queue = ['a','b'].map(suffix=>({Id:'fixture-next-'+suffix,ServerId:'fixture-server',Name:'Queue '+suffix,MediaType:'Video',Type:'Movie',Path:fixture,RunTimeTicks:50000000,UserData:{},MediaStreams:[]}));
    queue.forEach(item=>items.set(item.Id,item));
    activeItem=queue[0];
    await manager.play({items:queue,fullscreen:true,startPositionTicks:0});
    send('NextTrack');
    for(let i=0;i<30 && !(records.some(r=>r.endpoint.endsWith('/Playing') && r.body.ItemId===queue[1].Id));i++) await sleep(100);
    const next={selected:manager.currentItem().Id===queue[1].Id,
        priorStopped:records.some(r=>r.endpoint.endsWith('/Stopped') && r.body.ItemId===queue[0].Id),
        nextStarted:records.some(r=>r.endpoint.endsWith('/Playing') && r.body.PlaySessionId==='play-'+queue[1].Id)};
    send('Stop'); await sleep(200);
    return {results,next,records,calls};
}
