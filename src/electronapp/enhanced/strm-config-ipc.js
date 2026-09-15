'use strict';

const fs = require('fs');

const cd2Service = require('./cd2-service');
const pathRules = require('../resolvers/path-rules');

const CHANNELS = Object.freeze({
    GET: 'enhanced-strm-config-get',
    SAVE: 'enhanced-strm-config-save',
    SET_TOKEN: 'enhanced-strm-token-set',
    CLEAR_TOKEN: 'enhanced-strm-token-clear',
    TEST_CONNECTION: 'enhanced-strm-cd2-test-connection',
    TEST_RULE: 'enhanced-strm-rule-test',
    RESTORE_AUTO: 'enhanced-strm-rule-restore-auto',
    DISABLE_RULE: 'enhanced-strm-rule-disable'
});

function errorReason(error) {
    const message = String(error && error.message || '');
    if (/^(invalid_token|rule_not_found|invalid_discovery)$/.test(message)) return message;
    if (/^unsupported_schema$/.test(message)) return message;
    return 'invalid_config';
}

function register(options) {
    const settings = options || {};
    const ipcMain = settings.ipcMain;
    const store = settings.store;
    const getWebContents = settings.getWebContents;
    const fileSystem = settings.fs || fs;
    const createTestService = settings.createTestService;
    const handlers = [];

    function isTrusted(event) {
        const expected = typeof getWebContents === 'function' ? getWebContents() : null;
        return !!expected && event && event.sender === expected;
    }

    function rejectUntrusted() {
        return {status: 'error', reason: 'untrusted_sender'};
    }

    function registerHandler(channel, handler) {
        ipcMain.handle(channel, function (event, request) {
            if (!isTrusted(event)) return rejectUntrusted();
            return handler(request);
        });
        handlers.push(channel);
    }

    function saveRequest(request) {
        const config = request && request.config && typeof request.config === 'object'
            ? request.config
            : request;
        try {
            return {status: 'saved', requiresRestart: true, config: store.save(config)};
        } catch (error) {
            return {status: 'error', reason: errorReason(error)};
        }
    }

    async function testConnection() {
        let service;
        try {
            service = typeof createTestService === 'function' ? createTestService() : settings.service;
            if (!service || typeof service.testConnection !== 'function') {
                return {status: 'incomplete', reason: 'service_unavailable'};
            }
            return await service.testConnection();
        } catch (_) {
            return {status: 'connection_failed', reason: 'connection_failed'};
        } finally {
            if (service && service !== settings.service && typeof service.close === 'function') service.close();
        }
    }

    function testRule(request) {
        const rule = store.getRule(request && request.ruleId);
        let mountStatus = 'not_configured';
        let cloudStatus = 'not_configured';

        if (!rule) return {status: 'error', reason: 'rule_not_found'};
        if (rule.mountPrefix) {
            if (process.platform === 'win32' && pathRules.isPosixPath(rule.mountPrefix)) {
                mountStatus = 'unsupported_path';
            } else {
                try {
                    mountStatus = fileSystem.existsSync(rule.mountPrefix) ? 'ok' : 'missing';
                } catch (_) {
                    mountStatus = 'unavailable';
                }
            }
        }
        if (rule.cloudPrefix) {
            const probe = pathRules.appendSuffix(rule.sourcePrefix, 'ete-rule-test.mkv');
            cloudStatus = probe && cd2Service.mapLocalPath(probe, rule.sourcePrefix, rule.cloudPrefix)
                ? 'mapped'
                : 'invalid';
        }

        return {
            status: mountStatus === 'missing' || mountStatus === 'unavailable' ? 'warning' : 'ok',
            ruleId: rule.id,
            mount: mountStatus,
            cloud: cloudStatus
        };
    }

    registerHandler(CHANNELS.GET, function () {
        return store.getPublicConfig();
    });
    registerHandler(CHANNELS.SAVE, saveRequest);
    registerHandler(CHANNELS.SET_TOKEN, function (request) {
        try {
            return {status: 'saved', requiresRestart: true, config: store.setToken(request && request.token)};
        } catch (error) {
            return {status: 'error', reason: errorReason(error)};
        }
    });
    registerHandler(CHANNELS.CLEAR_TOKEN, function () {
        try {
            return {status: 'saved', requiresRestart: true, config: store.clearToken()};
        } catch (_) {
            return {status: 'error', reason: 'invalid_config'};
        }
    });
    registerHandler(CHANNELS.TEST_CONNECTION, testConnection);
    registerHandler(CHANNELS.TEST_RULE, testRule);
    registerHandler(CHANNELS.RESTORE_AUTO, function (request) {
        try {
            return {status: 'saved', requiresRestart: true, config: store.restoreAutoRule(request && request.ruleId)};
        } catch (error) {
            return {status: 'error', reason: errorReason(error)};
        }
    });
    registerHandler(CHANNELS.DISABLE_RULE, function (request) {
        try {
            return {status: 'saved', requiresRestart: true, config: store.disableRule(request && request.ruleId)};
        } catch (error) {
            return {status: 'error', reason: errorReason(error)};
        }
    });

    return function unregister() {
        if (typeof ipcMain.removeHandler === 'function') {
            handlers.forEach(function (channel) { ipcMain.removeHandler(channel); });
        }
    };
}

module.exports = {
    CHANNELS: CHANNELS,
    register: register
};
