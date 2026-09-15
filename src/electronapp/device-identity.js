'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IDENTITY_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidDeviceId(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

function generateDeviceId(random = crypto) {
    if (typeof random.randomUUID === 'function') {
        const value = random.randomUUID();
        if (isValidDeviceId(value)) return value.toLowerCase();
    }
    if (typeof random.randomBytes !== 'function') {
        throw new Error('A UUID-capable crypto implementation is required.');
    }
    const bytes = Buffer.from(random.randomBytes(16));
    if (bytes.length !== 16) throw new Error('Crypto randomBytes must return 16 bytes.');
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function readDeviceId(file, fileSystem = fs) {
    try {
        const value = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
        if (value && value.version === IDENTITY_VERSION && isValidDeviceId(value.deviceId)) {
            return value.deviceId.toLowerCase();
        }
    } catch (_) { }
    return null;
}

function atomicWriteJson(file, value, fileSystem = fs, random = crypto) {
    const directory = path.dirname(file);
    fileSystem.mkdirSync(directory, {recursive: true});
    const suffix = typeof random.randomBytes === 'function'
        ? random.randomBytes(8).toString('hex')
        : String(Date.now());
    const temporary = file + '.' + process.pid + '.' + suffix + '.tmp';
    const data = JSON.stringify(value) + '\n';
    let handle;
    try {
        handle = fileSystem.openSync(temporary, 'wx');
        fileSystem.writeFileSync(handle, data, 'utf8');
        if (typeof fileSystem.fsyncSync === 'function') fileSystem.fsyncSync(handle);
        fileSystem.closeSync(handle);
        handle = null;
        fileSystem.renameSync(temporary, file);
    } finally {
        if (handle !== undefined && handle !== null) {
            try { fileSystem.closeSync(handle); } catch (_) { }
        }
        try {
            if (fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary);
        } catch (_) { }
    }
}

function getOrCreateDeviceId(file, dependencies = {}) {
    const fileSystem = dependencies.fs || fs;
    const random = dependencies.crypto || crypto;
    const existing = readDeviceId(file, fileSystem);
    if (existing) return existing;

    const generated = generateDeviceId(random);
    try {
        atomicWriteJson(file, {version: IDENTITY_VERSION, deviceId: generated}, fileSystem, random);
    } catch (error) {
        const raced = readDeviceId(file, fileSystem);
        if (raced) return raced;
        throw error;
    }
    return generated;
}

module.exports = {IDENTITY_VERSION, isValidDeviceId, generateDeviceId, readDeviceId, getOrCreateDeviceId};
