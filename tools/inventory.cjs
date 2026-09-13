'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(dir, prefix = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]).sort();
}
const upstream = path.join(root, '.work/upstream/electron/MediaBrowser-emby-theater-electron-db0f4c8');
const base = path.join(root, 'vendor/carnival');
const patch = path.join(root, 'vendor/patch');
const files = walk(base).map(file => {
    const sha256 = hash(path.join(base, file));
    const relative = file.replace(/^electronapp\//, '');
    const reference = path.join(upstream, relative);
    let category = 'E';
    let evidence = 'Provenance not independently established';
    if (/^(x64\/electron\/|electronapp\/node_modules\/)/.test(file)) {
        category = 'C'; evidence = 'Bundled third-party runtime; individual upstream reproducibility not established';
    } else if (/\.(exe|dll|node|pdb)$/i.test(file)) {
        category = 'D'; evidence = 'Native/managed vendor binary; no reproducible source build for this exact file';
    } else if (file.startsWith('electronapp/') && fs.existsSync(reference) && fs.statSync(reference).isFile()) {
        category = hash(reference) === sha256 ? 'A' : 'B';
        evidence = category === 'A' ? 'Byte-identical to official Electron 3.0.21 reference' : 'Plaintext/asset differs from official 3.0.21 reference; author of every delta not established';
    } else if (/Emby\.(ConfigureAndUninstall|Dialog)\.bat|CustomCssJS\.js/.test(file)) {
        category = 'B'; evidence = 'Carnival customization entry present as plaintext';
    }
    return { path: file, size: fs.statSync(path.join(base, file)).size, sha256, category, evidence };
});
const manifest = {
    schemaVersion: 1,
    baseline: 'Carnival 3.0 / application 3.0.20-3.0 + combined patch',
    reference: { electron: 'db0f4c814ee1e7d9b5f50010065c5cb64a20357e', windows: '708fadc068cbf66ced6aece4a32f3e12bb2c4e13' },
    archives: [
        { pattern: 'Emby for Windows_3.0.20_v3.0(Carnival).exe', sha256: '9d53fe71b42a530e9941f97ad712bd6724dbb0e7aa0e7de73a4bf9614b28b001' },
        { pattern: 'Emby Theater 3.0.20 综合补丁包（最终版-含新版libmpv）.zip', sha256: '2316cd37733b4abf5475dcb9f36d050e2e83c52807ea3b40b9b97d8a80263b43' }
    ],
    components: [
        { path: 'Emby.Theater.exe', role: 'Windows host', source: 'Carnival archive; official Windows 3.0.20 source used for structural reference', version: '3.0.20 (file metadata to verify)', sourceAvailable: 'Reference only; exact Carnival build unknown', plannedReplacement: false },
        { path: 'electronapp/libmpv/x64/mpv-win32-x64.node', role: 'Chromium Pepper bridge to libmpv (not a normal Node require addon)', source: 'Carnival archive', version: 'unknown', sourceAvailable: 'Exact build unknown', plannedReplacement: false },
        { path: 'x64/electron/electron.exe', role: 'Frozen Electron runtime', source: 'Carnival archive', version: '18.3.15 (executed)', sourceAvailable: 'Electron upstream; exact bundled build not reproduced', plannedReplacement: false }
    ].map(c => Object.assign(c, { sha256: files.find(f => f.path === c.path).sha256 })),
    libmpv: { source: 'Combined patch source note / shinchiro/mpv-winbuild-cmake', release: '20260809', buildDate: '2026-08-09 (source note; runtime property separately probed)', asset: 'mpv-dev-x86_64-20260809-git-dd5d17d328.7z', url: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260809', path: 'payload/libmpv/mpv-1.dll', sha256: hash(path.join(patch, 'payload/libmpv/mpv-1.dll')), clientApi: '2.5 (DLL export executed)', sourceAvailable: 'Upstream source; exact build not reproduced', plannedReplacement: 'Managed independently; no automatic upgrades' },
    files,
    patchFiles: walk(patch).map(file => ({ path: file, sha256: hash(path.join(patch, file)) }))
};
fs.writeFileSync(path.join(root, 'vendor/runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(files.reduce((c, f) => { c[f.category] = (c[f.category] || 0) + 1; return c; }, {})));
