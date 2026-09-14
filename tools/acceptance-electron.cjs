'use strict';
// Explicitly authorized live acceptance, plus isolated profile inspect/manual login.
// No credentials, API URLs, media paths or raw exceptions are exported.
const {app} = require('electron');
const fs = require('fs');
const path = require('path');
const readiness = require('./acceptance-readiness.cjs');
const {createTerminalWriter} = require('./acceptance-terminal-guard.cjs');
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
fs.mkdirSync(output,{recursive:true});
let win;
let busy=false;
const epoch=Number(process.env.ETE_ACCEPT_EPOCH||Date.now());
const recorder=readiness.createRecorder();
const report={startedAt:new Date().toISOString(),version:metadata.version,runtime:{name:process.env.ETE_ACCEPT_RUNTIME_NAME||path.basename(runtime),sourceCommit:process.env.ETE_ACCEPT_SOURCE_COMMIT||'',validation:process.env.ETE_ACCEPT_RUNTIME_VALIDATED==='1'?'passed':'unvalidated'},readinessEpoch:epoch,stages:[],completed:false};
const resolverMessages=[];
function trace(stage){try{fs.writeFileSync(path.join(output,'acceptance-trace.txt'),stage+'\r\n',{flag:'a'});}catch(_){}}
function mark(stage){recorder.mark(stage,Date.now()-epoch);}
function recordResolverMessage(message){
    const match=/STRM resolver: invoked isStrm=(yes|no) type=([A-Za-z0-9_-]+) reason=([A-Za-z0-9_-]+) cd2=([A-Za-z0-9_-]+) localExists=(yes|no) fallback=(yes|no)(?: sourceKind=([A-Za-z0-9_-]+) direct=([A-Za-z0-9_-]+))?/.exec(String(message||''));
    if(!match)return;
    mark('resolver-result');
    resolverMessages.push({isStrm:match[1],type:match[2],reason:match[3],cd2:match[4],localExists:match[5],fallback:match[6],sourceKind:match[7]||'unknown',direct:match[8]||'not_attempted'});
}
function safeResolverRows(rows){
    if(!Array.isArray(rows))return [];
    return rows.filter(row=>row&&/^(yes|no)$/.test(row.isStrm||'')&&/^[A-Za-z0-9_-]+$/.test(row.type||'')&&/^[A-Za-z0-9_-]+$/.test(row.reason||'')&&/^[A-Za-z0-9_-]+$/.test(row.cd2||'')&&/^(yes|no)$/.test(row.localExists||'')&&/^(yes|no)$/.test(row.fallback||'')&&/^[A-Za-z0-9_-]+$/.test(row.sourceKind||'unknown')&&/^[A-Za-z0-9_-]+$/.test(row.direct||'not_attempted')).map(row=>({isStrm:row.isStrm,type:row.type,reason:row.reason,cd2:row.cd2,localExists:row.localExists,fallback:row.fallback,sourceKind:row.sourceKind||'unknown',direct:row.direct||'not_attempted'}));
}
function save(){fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify(report,null,2));}
async function evaluate(code){return win.webContents.executeJavaScript(code);}
function safeText(value,limit){
    const text=String(value||'').replace(/[A-Za-z]:\\[^\s'"]*/g,'<path>').replace(/\s+/g,' ').trim();
    return text.length>limit?text.slice(0,limit):text;
}
const end=createTerminalWriter({report,save,exit:code=>app.exit(code),beforeWrite:async function(error,terminal){
    try{
        const state=await evaluate('window.__eteReadiness ? window.__eteReadiness.snapshot() : null');
        report.readinessState=recorder.sanitizeState(state);
    }catch(_){ }
    if(win) await evaluate('window.eteAcceptance ? window.eteAcceptance.cleanup() : Promise.resolve()').catch(()=>{});
    if(terminal.mark)mark(terminal.mark);
    mark('acceptance-end');
    recorder.setResolverRows(safeResolverRows(resolverMessages));
    report.readiness=recorder.build(report);
}});
async function inspectProfile(){
    const result=await evaluate('('+profileInspectSource+')(typeof require === "function" ? require : (window && typeof window.require === "function" ? window.require : null), {connectionManager: window && window.ConnectionManager, getConnectionManager: function(){return window && window.ConnectionManager;}})');
    const reason=result&&typeof result.reason==='string'?result.reason:'inspection-error';
    await end(null,{profile:{loggedIn:!!(result&&result.loggedIn),reason},classification:reason});
}
if(!manualLogin)setTimeout(()=>{
    const terminal={classification:'acceptance-timeout',mark:'acceptance-budget-exceeded'};
    if(profileInspect)terminal.profile={loggedIn:false,reason:'inspection-error'};
    void end('acceptance-timeout',terminal);
},profileInspect?30000:240000);
app.on('browser-window-created',(_,created)=>{
    trace('browser-window-created');
    win=created;
    mark('window-created');
    // Publish the acceptance epoch in the renderer before any application code
    // runs; the product preload stays untouched.
    created.webContents.on('did-start-loading',()=>{
        created.webContents.executeJavaScript('window.__eteEpoch='+JSON.stringify(epoch)+';void 0;').catch(()=>{});
    });
    created.webContents.on('console-message',(_,level,message)=>recordResolverMessage(message));
    if(manualLogin)return;
    created.webContents.on('did-finish-load',()=>{
        // The initial about:blank load must not start the flow; only the
        // application document does.
        let url='';
        try{url=String(created.webContents.getURL()||'');}catch(_){}
        trace('did-finish-load url='+(/index\.html/i.test(url)?'app-document':'other'));
        if(!/index\.html/i.test(url))return;
        if(busy)return;busy=true;
        (async()=>{
            try{
                mark('app-load');
                mark('renderer-ready');
                // Playback readiness is observed from the app's own signals and
                // staged after manager.play(); the previous fixed pre-flow sleep
                // is replaced by an explicit app readiness condition.
                trace('observer-inject-start');
                await evaluate(fs.readFileSync(path.join(__dirname,'../tests/acceptance-readiness.js'),'utf8')+'\nvoid 0;');
                trace('observer-injected');
                if(profileInspect){await inspectProfile();return;}
                await evaluate('window.__eteExpectedCd2Origin='+JSON.stringify(process.env.ETE_ACCEPT_CD2_ORIGIN || '')+';window.__eteExpectedCd2LocalPrefix='+JSON.stringify(expectedCd2LocalPrefix)+';void 0;');
                await evaluate(fs.readFileSync(path.join(__dirname,'../tests/live-acceptance-browser.js'),'utf8')+'\nvoid 0;');
                mark('flow-injected');
                trace('flow-injected');
                const override=String(process.env.ETE_ACCEPT_METHODS||'').split(',').map(name=>name.trim()).filter(name=>/^[A-Za-z]+$/.test(name));
                const methods=override.length?override:process.env.ETE_ACCEPT_INSPECT_ONLY?['inspect']:process.env.ETE_ACCEPT_SELECT_ONLY?['inspect','select']:process.env.ETE_ACCEPT_DIRECT_SMOKE?['inspect','select','directSmoke']:process.env.ETE_ACCEPT_VISUAL?['inspect','select','play','visual','stop']:['inspect','select','play','pause','seek','resume','next','stop'];
                for(const method of methods){
                    if(end.state()!=='OPEN')return;
                    report.currentStage=method;save();
                    trace('method-start='+method);
                    const result=await evaluate('window.eteAcceptance.'+method+'()');
                    if(end.state()!=='OPEN')return;
                    trace('method-done='+method);
                    report.stages.push({method,result,time:new Date().toISOString()});save();
                    if(method==='inspect'&&result&&result.moduleAcquisition)report.moduleAcquisition=result.moduleAcquisition;
                    if(result&&result.ok===false){
                        const failure={method,reason:result.reason,failureClassification:result.failureClassification,stage:result.stage,errorType:result.errorType};
                        await end(method+'-failed',{failure,classification:failure.failureClassification||failure.reason||'acceptance-failed'});
                        return;
                    }
                }
                if(end.state()!=='OPEN')return;
                const combined=safeResolverRows(resolverMessages);
                if(combined.length)report.resolver=combined;
                recorder.setResolverRows(combined);
                await end();
            }catch(error){
                // Sanitized: only the first line and frame of the failure, never data.
                const operationError=safeText(error&&error.message,160);
                trace('operation-error '+operationError);
                await end('acceptance-operation-failed',{operationError,classification:'acceptance-operation-failed'});
            }
        })();
    });
});
trace('harness-start');
trace('runtime='+path.basename(runtime));
require(path.join(runtime,'electronapp/main.js'));
trace('product-main-loaded');
