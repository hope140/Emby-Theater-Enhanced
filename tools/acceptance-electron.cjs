'use strict';
// Explicitly authorized live acceptance, plus isolated profile inspect/manual login.
// No credentials, API URLs, media paths or raw exceptions are exported.
const {app} = require('electron');
const fs = require('fs');
const path = require('path');
const runtime=process.env.ETE_ACCEPT_RUNTIME;
const output=process.env.ETE_ACCEPT_OUTPUT;
if(!runtime || !output) throw Error('Live acceptance parameters required');
const profileInspect=process.env.ETE_ACCEPT_PROFILE_INSPECT==='1';
const manualLogin=process.env.ETE_ACCEPT_MANUAL_LOGIN==='1';
const profileInspectSource=fs.readFileSync(path.join(__dirname,'acceptance-profile-inspect.js'),'utf8');
const expectedCd2LocalPrefix=process.env.ETE_ACCEPT_CD2_LOCAL_PREFIX || process.env.ETE_CD2_LOCAL_PREFIX || '';
const metadata=JSON.parse(fs.readFileSync(path.join(runtime,'electronapp/package.json'),'utf8'));
app.setName(metadata.productName || metadata.name);
app.getVersion=()=>metadata.version;
let win;
let busy=false;
const report={startedAt:new Date().toISOString(),version:metadata.version,stages:[],completed:false};
const resolverMessages=[];
function recordResolverMessage(message){
    const match=/STRM resolver: invoked isStrm=(yes|no) type=([A-Za-z0-9_-]+) reason=([A-Za-z0-9_-]+) cd2=([A-Za-z0-9_-]+) localExists=(yes|no) fallback=(yes|no)/.exec(String(message||''));
    if(match)resolverMessages.push({isStrm:match[1],type:match[2],reason:match[3],cd2:match[4],localExists:match[5],fallback:match[6]});
}
function safeResolverRows(rows){
    if(!Array.isArray(rows))return [];
    return rows.filter(row=>row&&/^(yes|no)$/.test(row.isStrm||'')&&/^[A-Za-z0-9_-]+$/.test(row.type||'')&&/^[A-Za-z0-9_-]+$/.test(row.reason||'')&&/^[A-Za-z0-9_-]+$/.test(row.cd2||'')&&/^(yes|no)$/.test(row.localExists||'')&&/^(yes|no)$/.test(row.fallback||'')).map(row=>({isStrm:row.isStrm,type:row.type,reason:row.reason,cd2:row.cd2,localExists:row.localExists,fallback:row.fallback}));
}
function save(){fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify(report,null,2));}
async function evaluate(code){return win.webContents.executeJavaScript(code);}
async function end(error){
    if(report.completed)return;
    if(win) await evaluate('window.eteAcceptance ? window.eteAcceptance.cleanup() : Promise.resolve()').catch(()=>{});
    report.error=error || null;report.completed=true;save();app.exit(error?1:0);
}
async function inspectProfile(){
    const result=await evaluate('('+profileInspectSource+')(require)');
    report.loggedIn=!!(result&&result.loggedIn);
    report.reason=result&&typeof result.reason==='string'?result.reason:'inspection-error';
    report.completed=true;
    save();
    app.exit(0);
}
if(!manualLogin)setTimeout(()=>{
    if(profileInspect){report.loggedIn=false;report.reason='inspection-error';}
    end('acceptance-timeout');
},profileInspect?30000:240000);
app.on('browser-window-created',(_,created)=>{
    win=created;
    created.webContents.on('console-message',(_,level,message)=>recordResolverMessage(message));
    if(manualLogin)return;
    created.webContents.once('did-finish-load',()=>{
        if(busy)return;busy=true;
        (async()=>{
            try{
                await new Promise(r=>setTimeout(r,7000));
                if(profileInspect){await inspectProfile();return;}
                await evaluate('window.__eteExpectedCd2Origin='+JSON.stringify(process.env.ETE_ACCEPT_CD2_ORIGIN || '')+';window.__eteExpectedCd2LocalPrefix='+JSON.stringify(expectedCd2LocalPrefix)+';void 0;');
                await evaluate(`(function(){
                    window.__eteResolverMessages=[];
                    var original=console.log;
                    console.log=function(){
                        try{
                            var text=Array.prototype.join.call(arguments,' ');
                            var match=/STRM resolver: invoked isStrm=(yes|no) type=([A-Za-z0-9_-]+) reason=([A-Za-z0-9_-]+) cd2=([A-Za-z0-9_-]+) localExists=(yes|no) fallback=(yes|no)/.exec(text);
                            if(match)window.__eteResolverMessages.push({isStrm:match[1],type:match[2],reason:match[3],cd2:match[4],localExists:match[5],fallback:match[6]});
                        }catch(_){ }
                        return original.apply(console,arguments);
                    };
                })();void 0;`);
                await evaluate(fs.readFileSync(path.join(__dirname,'../tests/live-acceptance-browser.js'),'utf8')+'\nvoid 0;');
                const methods=process.env.ETE_ACCEPT_INSPECT_ONLY?['inspect']:process.env.ETE_ACCEPT_SELECT_ONLY?['inspect','select']:process.env.ETE_ACCEPT_VISUAL?['inspect','select','play','visual','stop']:['inspect','select','play','pause','seek','resume','next','stop'];
                for(const method of methods){
                    report.currentStage=method;save();
                    const result=await evaluate('window.eteAcceptance.'+method+'()');
                    report.stages.push({method,result,time:new Date().toISOString()});save();
                    if(result.ok===false){await end(method+'-failed');return;}
                }
                const pageResolverMessages=safeResolverRows(await evaluate('window.__eteResolverMessages || []'));
                const combined=safeResolverRows(resolverMessages.concat(pageResolverMessages));
                if(combined.length)report.resolver=combined;
                await end();
            }catch(_){await end('acceptance-operation-failed');}
        })();
    });
});
require(path.join(runtime,'electronapp/main.js'));
