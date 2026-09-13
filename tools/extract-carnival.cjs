'use strict';
const fs = require('fs');
const path = require('path');
const { createExtractorFromFile } = require('node-unrar-js');

async function main() {
    const [archive, destination] = process.argv.slice(2);
    if (!archive || !destination) throw new Error('Usage: node tools/extract-carnival.cjs archive.exe destination');
    const root = path.resolve(destination);
    if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('Destination must be empty');
    const extractor = await createExtractorFromFile({
        filepath: path.resolve(archive), targetPath: root,
        filenameTransform: name => {
            const resolved = path.resolve(root, name);
            if (!resolved.startsWith(root + path.sep) && resolved !== root) throw new Error('Unsafe archive path');
            return name;
        }
    });
    const list = extractor.getFileList();
    const headers = [...list.fileHeaders];
    if (headers.some(h => h.flags.encrypted)) throw new Error('Encrypted entries are not supported');
    for (const header of headers) {
        const target = path.resolve(root, header.name);
        if (!target.startsWith(root + path.sep) && target !== root) throw new Error('Unsafe archive path');
    }
    let count = 0;
    for (const entry of extractor.extract().files) if (!entry.fileHeader.flags.directory) count++;
    console.log(JSON.stringify({ files: count, entries: headers.length, encrypted: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
