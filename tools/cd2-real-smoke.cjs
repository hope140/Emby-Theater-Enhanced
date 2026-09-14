'use strict';

const http = require('http');
const https = require('https');
const path = require('path');

const runtime = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Runtime path is required.');
const serviceModule = require(path.join(runtime, 'electronapp', 'enhanced', 'cd2-service'));
const service = serviceModule.createService({environment: process.env});
const candidate = process.env.ETE_CD2_REAL_CANDIDATE;
if (!candidate) throw new Error('ETE_CD2_REAL_CANDIDATE is required.');

function probe(source, method, headers) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(source);
        const client = parsed.protocol === 'https:' ? https : http;
        const request = client.request(parsed, {method, headers: headers || {}, timeout: 5000}, response => {
            response.resume();
            response.on('end', () => resolve({
                status: response.statusCode,
                acceptRanges: response.headers['accept-ranges'] || 'absent',
                contentRange: response.headers['content-range'] ? 'present' : 'absent',
                contentLength: response.headers['content-length'] ? 'present' : 'absent',
                redirect: response.headers.location ? 'present' : 'absent'
            }));
        });
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.on('error', reject);
        request.end();
    });
}

(async () => {
    try {
        const resolved = await service.resolve({requestId: 'real-smoke', candidates: [candidate]});
        if (resolved.status !== 'hit') {
            console.log(JSON.stringify({ok: false, resolve: resolved.reason || 'miss'}));
            process.exitCode = 1;
            return;
        }
        const direct = resolved.sourceKind === 'direct-url';
        const requestHeaders = {Range: 'bytes=0-0', 'Accept-Encoding': 'identity'};
        if (direct && resolved.requestOptions && resolved.requestOptions.userAgent) {
            requestHeaders['User-Agent'] = resolved.requestOptions.userAgent;
        }
        const headHeaders = {};
        if (requestHeaders['User-Agent']) headHeaders['User-Agent'] = requestHeaders['User-Agent'];
        const head = await probe(resolved.source, 'HEAD', headHeaders);
        const range = await probe(resolved.source, 'GET', requestHeaders);
        const ok = (direct || head.status === 200) && range.status === 206 && range.contentRange === 'present';
        console.log(JSON.stringify({
            ok,
            resolve: 'hit',
            sourceType: direct ? 'direct-url' : 'same-origin-http',
            userAgentPresent: !!requestHeaders['User-Agent'],
            expiresInPresent: resolved.expiresAt !== undefined,
            additionalHeadersSupported: false,
            head,
            range
        }));
        process.exitCode = ok ? 0 : 1;
    } catch (error) {
        console.log(JSON.stringify({ok: false, resolve: 'error', errorType: error && error.name || 'Error'}));
        process.exitCode = 1;
    } finally {
        service.close();
    }
})();
