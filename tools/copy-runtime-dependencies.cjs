'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const destination = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Destination electronapp path is required.');

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packageEntries = Object.entries(lock.packages || {}).filter(([packagePath, metadata]) =>
    packagePath.startsWith('node_modules/') && metadata.dev !== true
);

for (const [packagePath] of packageEntries) {
    const source = path.join(root, packagePath);
    const target = path.join(destination, packagePath);
    if (!fs.existsSync(source)) throw new Error('Run npm ci before build; missing ' + packagePath);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.cpSync(source, target, {recursive: true, force: true});
}

const nativeAddons = [];
for (const [packagePath] of packageEntries) {
    const packageRoot = path.join(destination, packagePath);
    const pending = [packageRoot];
    while (pending.length) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
            const child = path.join(current, entry.name);
            if (entry.isDirectory()) pending.push(child);
            else if (entry.isFile() && entry.name.endsWith('.node')) nativeAddons.push(child);
        }
    }
}
if (nativeAddons.length) throw new Error('Runtime dependency closure contains a native addon.');

console.log('Runtime dependencies copied: ' + packageEntries.length + ' packages');
