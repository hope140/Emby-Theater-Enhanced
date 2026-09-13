window.eteAcceptance = (function(){
    let api,manager,events,user,items,sessionId;
    const received=[];
    const reports=[];
    let authorizedPlayback=false;
    function wait(ms){return new Promise(r=>setTimeout(r,ms));}
    function sourceKind(source){
        if(typeof source!=='string' || !source)return 'missing';
        if(/^[A-Za-z]:[\\/]/.test(source) || /^\\\\/.test(source) || /^\/\/[^\/]/.test(source))return 'local';
        if(/^\//.test(source))return 'posix';
        if(/^https?:\/\//i.test(source)){
            try{if(window.__eteExpectedCd2Origin&&new URL(source).origin===new URL(window.__eteExpectedCd2Origin).origin)return 'cd2-url';}catch(e){}
            return 'url';
        }
        return 'other';
    }
    function localPrefixMatches(value, prefix){
        if(typeof value!=='string'||typeof prefix!=='string'||!prefix)return false;
        var root=prefix.replace(/[\\/]+$/,'');
        return value===root||value.indexOf(root+'/')===0;
    }
    async function until(fn,limit=15000){
        const start=Date.now();
        while(Date.now()-start<limit){const value=await fn();if(value)return value;await wait(700);}
        return null;
    }
    function playerState(){
        const p=manager._currentPlayer;
        if(!p)return null;
        const s=manager.getPlayerState();
        return {player:p.id,item:s.NowPlayingItem&&s.NowPlayingItem.Id,
            ticks:s.PlayState.PositionTicks,paused:s.PlayState.IsPaused,
            playSession:s.PlayState.PlaySessionId,source:s.PlayState.MediaSourceId,
            playMethod:s.PlayState.PlayMethod,
            sourceKind:sourceKind(p.currentSrc&&p.currentSrc())};
    }
    async function ownSession(){
        const all=await api.getSessions({DeviceId:api.deviceId()});
        return all.filter(s=>s.DeviceId===api.deviceId() && s.UserId===api.getCurrentUserId() && s.Client===api.appName() && s.ApplicationVersion===api.appVersion()).sort((a,b)=>new Date(b.LastActivityDate)-new Date(a.LastActivityDate))[0];
    }
    function sanitizedSession(s){return s?{present:true,item:s.NowPlayingItem&&s.NowPlayingItem.Id,ticks:s.PlayState&&s.PlayState.PositionTicks,
        paused:s.PlayState&&s.PlayState.IsPaused,remote:s.SupportsRemoteControl}: {present:false};}
    async function control(name,options){
        const before=received.length;
        try{await api.sendPlayStateCommand(sessionId,name,options||{});}catch(e){return {ok:false,httpStatus:e&&e.status||null};}
        const delivered=await until(()=>received.slice(before).some(c=>c===name),10000);
        return {ok:!!delivered,serverAccepted:true,websocketDelivered:!!delivered};
    }
    return {
        async inspect(){
            const deps=await new Promise((resolve,reject)=>require(['connectionManager','playbackManager','events'],(...d)=>resolve(d),reject));
            manager=deps[1];events=deps[2];
            api=await until(()=>deps[0].currentApiClient(),15000);
            if(!api)return {ok:false,reason:'not-logged-in'};
            user=await api.getCurrentUser();
            const existing=playerState();
            if(existing&&existing.item)return {ok:false,reason:'existing-playback-preserved'};
            events.on(api,'message',(e,msg)=>{if(msg.MessageType==='Playstate')received.push(msg.Data.Command);});
            // Observe real requests; never replace transport or manufacture reports.
            const originalAjax=api.ajax;
            api.ajax=function(request){
                const endpoint=new URL(request.url).pathname;
                const match=/\/Sessions\/Playing(\/Progress|\/Stopped)?$/.exec(endpoint);
                let row;
                if(match&&request.type==='POST'&&request.data){
                    const info=JSON.parse(request.data);
                    const method=match[1]==='/Stopped'?'reportPlaybackStopped':match[1]==='/Progress'?'reportPlaybackProgress':'reportPlaybackStart';
                    row={method,item:info.ItemId,source:info.MediaSourceId,playSession:info.PlaySessionId,ticks:info.PositionTicks,paused:info.IsPaused,accepted:null};
                    reports.push(row);
                }
                return originalAjax.apply(this,arguments).then(value=>{if(row)row.accepted=true;return value;},error=>{if(row)row.accepted=false;throw error;});
            };
            api.ensureWebSocket();
            const capabilities=await deps[0].capabilities();
            const sessions=await api.getSessions({DeviceId:api.deviceId()});
            const session=await ownSession();
            if(!session)return {ok:false,reason:'own-session-not-visible',nonAdmin:!user.Policy.IsAdministrator};
            sessionId=session.Id;
            return {ok:true,nonAdmin:!user.Policy.IsAdministrator,websocketOpen:api.isWebSocketOpen(),session:sanitizedSession(session),
                capabilities:{mediaControl:capabilities.SupportsMediaControl,remote:capabilities.SupportsRemoteControl,commands:capabilities.SupportedCommands&&capabilities.SupportedCommands.length},
                clientName:api.appName(),ownSessions:sessions.filter(s=>s.DeviceId===api.deviceId()&&s.UserId===api.getCurrentUserId()).map(s=>({client:s.Client,sameClient:s.Client===api.appName(),sameVersion:s.ApplicationVersion===api.appVersion(),remote:s.SupportsRemoteControl,commands:s.SupportedCommands&&s.SupportedCommands.length,lastActivity:s.LastActivityDate})),
                permission:{controlOwn:user.Policy.EnableRemoteControlOfOtherUsers,sharedDevices:user.Policy.EnableSharedDeviceControl}};
        },
        async select(){
            const result=await api.getItems(api.getCurrentUserId(),{Recursive:true,IncludeItemTypes:'Movie,Episode',Limit:16,
                Fields:'Path,MediaSources',SortBy:'DateCreated',SortOrder:'Descending',Filters:'IsUnplayed'});
            items=result.Items.filter(item=>typeof item.Path==='string'&&item.Path.toLowerCase().endsWith('.strm')&&item.RunTimeTicks>1200000000).slice(0,2);
            if(items.length<2)return {ok:false,reason:'not-enough-strm-samples',scanned:result.Items.length};
            return {ok:true,scanned:result.Items.length,samples:items.map(i=>{const source=(i.MediaSources||[])[0]||{};return {id:i.Id,name:i.Name,series:i.SeriesName,type:i.Type,strm:true,itemPathKind:sourceKind(i.Path),itemPathPrefixMatch:localPrefixMatches(i.Path,window.__eteExpectedCd2LocalPrefix),sourceCount:i.MediaSources&&i.MediaSources.length,sourcePathKind:sourceKind(source.Path),sourcePathPrefixMatch:localPrefixMatches(source.Path,window.__eteExpectedCd2LocalPrefix),container:String(source.Container||'').toLowerCase()||'missing'};})};
        },
        async play(){
            authorizedPlayback=true;
            const first=items[0];
            const started=manager.play({items:items,fullscreen:true,startPositionTicks:0});
            const done=await Promise.race([started.then(()=>true,()=>false),wait(45000).then(()=>false)]);
            if(!done)return {ok:false,reason:'playback-not-started'};
            const progressed=await until(()=>{const s=playerState();return s&&s.item===first.Id&&s.ticks>30000000?s:null;},30000);
            const server=await until(async()=>{const s=await ownSession();return s&&s.NowPlayingItem&&s.NowPlayingItem.Id===first.Id&&s.PlayState.PositionTicks>0?s:null;},15000);
            return {ok:!!progressed&&!!server,local:progressed,server:sanitizedSession(server),reported:reports.filter(r=>r.item===first.Id)};
        },
        async pause(){
            const command=await control('Pause');if(!command.ok)return command;
            const paused=await until(()=>playerState()?.paused);
            const server=await until(async()=>{const s=await ownSession();return s&&s.PlayState.IsPaused?s:null;});
            return {ok:!!paused&&!!server,command,local:playerState(),server:sanitizedSession(server)};
        },
        async visual(){await wait(20000);return {ok:!!playerState()?.item,local:playerState()};},
        async seek(){
            const command=await control('Seek',{SeekPositionTicks:600000000});if(!command.ok)return command;
            const sought=await until(()=>{const s=playerState();return s&&Math.abs(s.ticks-600000000)<40000000;});
            const server=await until(async()=>{const s=await ownSession();return s&&Math.abs(s.PlayState.PositionTicks-600000000)<50000000?s:null;});
            return {ok:!!sought&&!!server,command,local:playerState(),server:sanitizedSession(server)};
        },
        async resume(){
            const command=await control('Unpause');if(!command.ok)return command;
            const resumed=await until(()=>{const s=playerState();return s&&!s.paused&&s.ticks>620000000;});
            return {ok:!!resumed,command,local:playerState()};
        },
        async next(){
            const command=await control('NextTrack');if(!command.ok)return command;
            const next=await until(()=>{const s=playerState();return s&&s.item===items[1].Id&&s.ticks>10000000?s:null;},45000);
            const server=await until(async()=>{const s=await ownSession();return s&&s.NowPlayingItem&&s.NowPlayingItem.Id===items[1].Id?s:null;});
            return {ok:!!next&&!!server,command,local:next,server:sanitizedSession(server)};
        },
        async stop(){
            const command=await control('Stop');if(!command.ok)return command;
            const stopped=await until(()=>!playerState()?.item);
            const server=await until(async()=>{const s=await ownSession();return s&&!s.NowPlayingItem?s:null;});
            const acceptedStops=reports.filter(r=>r.method==='reportPlaybackStopped'&&r.accepted);
            const startedItems=new Set(reports.filter(r=>r.method==='reportPlaybackStart'&&r.accepted).map(r=>r.item));
            return {ok:!!stopped&&!!server&&startedItems.size>0&&[...startedItems].every(item=>acceptedStops.some(r=>r.item===item)),command,server:sanitizedSession(server),reports};
        },
        async cleanup(){if(authorizedPlayback&&manager&&manager._currentPlayer)await manager.stop().catch(()=>{});}
    };
})();
