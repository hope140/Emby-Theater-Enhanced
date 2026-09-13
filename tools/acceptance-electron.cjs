'use strict';
// Explicitly authorized live acceptance. Reuses the existing Enhanced profile.
// No credentials, API URLs, media paths or raw exceptions are exported.
const {app} = require('electron');
const fs = require('fs');
const path = require('path');
const runtime=process.env.ETE_ACCEPT_RUNTIME;
const output=process.env.ETE_ACCEPT_OUTPUT;
if(!runtime || !output) throw Error('Live acceptance parameters required');
const metadata=JSON.parse(fs.readFileSync(path.join(runtime,'electronapp/package.json'),'utf8'));
app.setName(metadata.productName || metadata.name);
app.getVersion=()=>metadata.version;
let win;
let busy=false;
const report={startedAt:new Date().toISOString(),version:metadata.version,stages:[],completed:false};
function save(){fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify(report,null,2));}
async function evaluate(code){return win.webContents.executeJavaScript(code);}
async function end(error){
    if(report.completed)return;
    if(win) await evaluate('window.eteAcceptance ? window.eteAcceptance.cleanup() : Promise.resolve()').catch(()=>{});
    report.error=error || null;report.completed=true;save();app.exit(error?1:0);
}
setTimeout(()=>end('acceptance-timeout'),240000);
app.on('browser-window-created',(_,created)=>{
    win=created;
    created.webContents.once('did-finish-load',()=>{
        if(busy)return;busy=true;
        (async()=>{
            try{
                await new Promise(r=>setTimeout(r,7000));
                await evaluate('window.__eteExpectedCd2Origin='+JSON.stringify(process.env.ETE_ACCEPT_CD2_ORIGIN || '')+';void 0;');
                await evaluate(fs.readFileSync(path.join(__dirname,'../tests/live-acceptance-browser.js'),'utf8')+'\nvoid 0;');
                const methods=process.env.ETE_ACCEPT_INSPECT_ONLY?['inspect']:process.env.ETE_ACCEPT_SELECT_ONLY?['inspect','select']:process.env.ETE_ACCEPT_VISUAL?['inspect','select','play','visual','stop']:['inspect','select','play','pause','seek','resume','next','stop'];
                for(const method of methods){
                    report.currentStage=method;save();
                    const result=await evaluate('window.eteAcceptance.'+method+'()');
                    report.stages.push({method,result,time:new Date().toISOString()});save();
                    if(result.ok===false){await end(method+'-failed');return;}
                }
                await end();
            }catch(_){await end('acceptance-operation-failed');}
        })();
    });
});
require(path.join(runtime,'electronapp/main.js'));
