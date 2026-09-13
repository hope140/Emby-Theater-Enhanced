'use strict';
const fs = require('fs');
const output = process.argv[2];
if (!output || fs.existsSync(output)) throw Error('Supply a new output path');
const frame = Buffer.concat([Buffer.from('FRAME\n'), Buffer.alloc(64*64, 100), Buffer.alloc(64*64/4, 90), Buffer.alloc(64*64/4, 180)]);
fs.writeFileSync(output, Buffer.concat([Buffer.from('YUV4MPEG2 W64 H64 F30:1 Ip A1:1 C420jpeg\n'), ...Array(150).fill(frame)]));
