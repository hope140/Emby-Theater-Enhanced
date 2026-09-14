'use strict';

const {app} = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const runtime = process.env.ETE_UA_PROBE_RUNTIME;
const evidence = process.env.ETE_UA_PROBE_EVIDENCE;
if (!runtime || !evidence) throw new Error('UA probe environment is incomplete.');

const uaA = 'ETE-File-Local-Probe-A/1.0';
const uaB = 'ETE-File-Local-Probe-B/1.0';
const frame = Buffer.concat([
    Buffer.from('FRAME\n'),
    Buffer.alloc(64 * 64, 100),
    Buffer.alloc(64 * 64 / 4, 90),
    Buffer.alloc(64 * 64 / 4, 180)
]);
const media = Buffer.concat([
    Buffer.from('YUV4MPEG2 W64 H64 F30:1 Ip A1:1 C420jpeg\n'),
    ...Array(300).fill(frame)
]);
const requests = [];
let finished = false;
let server;

function classifyUserAgent(value) {
    if (value === uaA) return 'ua-a';
    if (value === uaB) return 'ua-b';
    return value ? 'default-or-other' : 'absent';
}

function finish(result) {
    if (finished) return;
    finished = true;
    const observed = requests.map(function (entry) {
        return {path: entry.path, method: entry.method, userAgentClass: entry.userAgentClass, accepted: entry.accepted};
    });
    const output = Object.assign({}, result, {requests: observed});
    fs.writeFileSync(path.join(evidence, 'libmpv-file-local-ua-probe.json'), JSON.stringify(output, null, 2));
    const exit = function () { app.exit(output.ok ? 0 : 1); };
    if (server) server.close(exit);
    else exit();
}

function serve(request, response) {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const userAgent = request.headers['user-agent'] || '';
    const expected = pathname === '/a' ? uaA : pathname === '/b' ? uaB : null;
    const accepted = pathname === '/c'
        ? userAgent !== uaA && userAgent !== uaB
        : !!expected && userAgent === expected;
    requests.push({path: pathname, method: request.method, userAgentClass: classifyUserAgent(userAgent), accepted});

    if (!accepted) {
        response.writeHead(403, {'Content-Length': '0'});
        response.end();
        return;
    }

    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    if (range) {
        const start = Number(range[1]);
        const requestedEnd = range[2] ? Number(range[2]) : media.length - 1;
        const end = Math.min(requestedEnd, media.length - 1);
        if (!Number.isSafeInteger(start) || start < 0 || start > end) {
            response.writeHead(416, {'Content-Range': 'bytes */' + media.length});
            response.end();
            return;
        }
        const body = media.subarray(start, end + 1);
        response.writeHead(206, {
            'Accept-Ranges': 'bytes',
            'Content-Type': 'video/x-yuv4mpeg',
            'Content-Length': String(body.length),
            'Content-Range': 'bytes ' + start + '-' + end + '/' + media.length
        });
        if (request.method === 'HEAD') response.end();
        else response.end(body);
        return;
    }

    response.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/x-yuv4mpeg',
        'Content-Length': String(media.length)
    });
    if (request.method === 'HEAD') response.end();
    else response.end(media);
}

app.setName('emby-theater-enhanced-file-local-ua-probe');
app.setPath('userData', path.join(evidence, 'profile'));
setTimeout(function () { finish({ok: false, errorCategory: 'probe_timeout'}); }, 45000);

app.on('browser-window-created', function (_, win) {
    win.webContents.once('did-finish-load', function () {
        setTimeout(async function () {
            try {
                const baseUrl = 'http://127.0.0.1:' + server.address().port;
                const result = await win.webContents.executeJavaScript(`(async function () {
                    var uaA = ${JSON.stringify(uaA)};
                    var uaB = ${JSON.stringify(uaB)};
                    var baseUrl = ${JSON.stringify(baseUrl)};
                    var embed = document.createElement('embed');
                    embed.type = 'application/x-mpvjs';
                    embed.style.width = '64px';
                    embed.style.height = '64px';
                    document.body.appendChild(embed);

                    var ready = await new Promise(function (resolve) {
                        var timer = setTimeout(function () { resolve(false); }, 8000);
                        embed.addEventListener('message', function onMessage(event) {
                            if (event.data && event.data.type === 'ready') {
                                clearTimeout(timer);
                                embed.removeEventListener('message', onMessage);
                                resolve(true);
                            }
                        });
                    });
                    if (!ready) return {ok:false,errorCategory:'bridge_not_ready'};

                    ['path','time-pos','file-format','core-idle'].forEach(function (name) {
                        embed.postMessage({type:'observe_property',data:name});
                    });

                    async function load(name, command) {
                        var expectedPath = baseUrl + '/' + name;
                        var state = {pathAccepted:false,fileFormat:null,coreIdleFalse:false,firstTime:null,maxTime:0,timeAdvanced:false};
                        function receive(event) {
                            var message = event.data || {};
                            if (message.type !== 'property_change' || !message.data) return;
                            var property = message.data.name;
                            var value = message.data.value;
                            if (property === 'path' && value === expectedPath) state.pathAccepted = true;
                            else if (!state.pathAccepted) return;
                            else if (property === 'file-format' && typeof value === 'string') state.fileFormat = value;
                            else if (property === 'core-idle' && value === false) state.coreIdleFalse = true;
                            else if (property === 'time-pos' && typeof value === 'number') {
                                if (state.firstTime === null) state.firstTime = value;
                                state.maxTime = Math.max(state.maxTime, value);
                                state.timeAdvanced = state.maxTime - state.firstTime > 0.1;
                            }
                        }
                        embed.addEventListener('message', receive);
                        embed.postMessage({type:'command',data:command});
                        for (var i = 0; i < 100 && !state.timeAdvanced; i++) {
                            await new Promise(function (resolve) { setTimeout(resolve, 100); });
                            if (state.pathAccepted && i % 10 === 0) {
                                ['file-format','core-idle','time-pos'].forEach(function (property) {
                                    embed.postMessage({type:'get_property_async',data:property});
                                });
                            }
                        }
                        embed.removeEventListener('message', receive);
                        return state;
                    }

                    var a = await load('a', ['loadfile', baseUrl + '/a', 'replace', '-1', 'user-agent=' + uaA]);
                    var b = await load('b', ['loadfile', baseUrl + '/b', 'replace', '-1', 'user-agent=' + uaB]);
                    var c = await load('c', ['loadfile', baseUrl + '/c']);
                    embed.postMessage({type:'command',data:['stop']});
                    return {
                        ok:a.pathAccepted && a.timeAdvanced && b.pathAccepted && b.timeAdvanced && c.pathAccepted && c.timeAdvanced,
                        stages:{a:a,b:b,c:c},
                        commandShape:'loadfile,url,replace,-1,file-local-options'
                    };
                }())`);

                const wrongPathHeaders = requests.filter(function (entry) {
                    return (entry.path === '/a' && entry.userAgentClass !== 'ua-a') ||
                        (entry.path === '/b' && entry.userAgentClass !== 'ua-b') ||
                        (entry.path === '/c' && (entry.userAgentClass === 'ua-a' || entry.userAgentClass === 'ua-b'));
                });
                result.noCrossFileLeak = wrongPathHeaders.length === 0;
                result.ok = result.ok && result.noCrossFileLeak;
                if (!result.ok && !result.errorCategory) result.errorCategory = 'file_local_ua_not_proven';
                finish(result);
            } catch (error) {
                finish({ok: false, errorCategory: 'probe_operation_failed', errorType: error && error.name || 'Error'});
            }
        }, 6500);
    });
});

server = http.createServer(serve);
server.listen(0, '127.0.0.1');
require(path.join(runtime, 'electronapp', 'main.js'));
