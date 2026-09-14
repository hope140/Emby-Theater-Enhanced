'use strict';

const path = require('path');

const runtime = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Runtime path is required.');
const electronapp = path.join(runtime, 'electronapp');
const grpc = require(path.join(electronapp, 'node_modules', '@grpc', 'grpc-js'));
const protoLoader = require(path.join(electronapp, 'node_modules', '@grpc', 'proto-loader'));
const serviceModule = require(path.join(electronapp, 'enhanced', 'cd2-service'));
const protoPath = path.join(electronapp, 'enhanced', 'proto', 'clouddrive-v1.proto');
const definition = protoLoader.loadSync(protoPath, {keepCase: true, longs: String, enums: String, defaults: true, oneofs: true});
const api = grpc.loadPackageDefinition(definition).clouddrive;
const server = new grpc.Server();
let metadataAccepted = false;
let requestShapeAccepted = false;

server.addService(api.CloudDriveFileSrv.service, {
    FindFileByPath(call, callback) {
        metadataAccepted = call.metadata.get('authorization').length === 1;
        requestShapeAccepted = call.request.parentPath === '' && call.request.path === '/cloud/Show/E01.mkv';
        callback(null, {fullPathName: call.request.path, size: '1024', fileType: 'File', isDirectory: false});
    },
    GetDownloadUrlPath(call, callback) {
        requestShapeAccepted = requestShapeAccepted && call.request.preview === false &&
            call.request.lazy_read === false && call.request.get_direct_url === true;
        callback(null, {
            downloadUrlPath: '/static/{SCHEME}/{HOST}/{PREVIEW}/fixture',
            directUrl: 'https://cdn.example.test/fixture',
            userAgent: 'ETE-Runtime-Smoke/1.0',
            expiresIn: '60',
            additionalHeaders: {}
        });
    }
});

server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), async (error, port) => {
    if (error) throw error;
    const instance = serviceModule.createService({config: {
        enabled: true,
        origin: serviceModule.parseOrigin('http://127.0.0.1:' + port),
        token: 'placeholder',
        localPrefix: serviceModule.normalizeLocalPath('X:\\Media'),
        cloudPrefix: serviceModule.normalizeCloudPath('/cloud'),
        totalBudgetMs: 750
    }});
    try {
        const response = await instance.resolve({requestId: 'runtime-smoke', candidates: ['X:\\Media\\Show\\E01.mkv']});
        const nativeAddons = Object.keys(require.cache).filter(name =>
            name.startsWith(path.join(electronapp, 'node_modules')) && name.endsWith('.node')
        );
        const result = response.status === 'hit' && response.type === 'url' && response.sourceKind === 'direct-url' &&
            response.requestOptions && response.requestOptions.userAgent === 'ETE-Runtime-Smoke/1.0' && metadataAccepted &&
            requestShapeAccepted && nativeAddons.length === 0 &&
            process.versions.node === '16.13.2' && process.versions.electron === '18.3.15';
        console.log(JSON.stringify({
            ok: result,
            node: process.versions.node,
            electron: process.versions.electron,
            grpcJs: require(path.join(electronapp, 'node_modules', '@grpc', 'grpc-js', 'package.json')).version,
            protoLoader: require(path.join(electronapp, 'node_modules', '@grpc', 'proto-loader', 'package.json')).version,
            metadataAccepted,
            requestShapeAccepted,
            sourceType: response.type || null,
            sourceKind: response.sourceKind || null,
            fileLocalUserAgent: !!(response.requestOptions && response.requestOptions.userAgent),
            nativeAddonCount: nativeAddons.length
        }));
        process.exitCode = result ? 0 : 1;
    } finally {
        instance.close();
        server.tryShutdown(() => {});
    }
});
