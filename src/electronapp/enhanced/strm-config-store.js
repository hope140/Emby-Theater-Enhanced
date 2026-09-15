'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const cd2Service = require('./cd2-service');
const pathRules = require('../resolvers/path-rules');

const SCHEMA_VERSION = 1;
const DEFAULT_ORIGIN = 'http://127.0.0.1:19798';
const DEFAULT_ORDER = ['direct-url', 'cd2-http', 'mount', 'native'];
const MOUNT_FIRST_ORDER = ['mount', 'direct-url', 'cd2-http', 'native'];
const VALID_STAGES = ['direct-url', 'cd2-http', 'mount', 'native'];
const VALID_STORAGE_TYPES = ['local-nas', 'cloud-mount'];
const VALID_STRATEGIES = ['cloud-first', 'mount-first', 'custom'];
const LEGACY_ENV_NAMES = [
    'ETE_CD2_ENABLED',
    'ETE_CD2_ORIGIN',
    'ETE_CD2_TOKEN',
    'ETE_CD2_LOCAL_PREFIX',
    'ETE_CD2_CLOUD_PREFIX',
    'ETE_CD2_DIRECT_URL',
    'ETE_CD2_SOURCE_PREFIX',
    'ETE_CD2_MOUNT_PREFIX'
];

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function booleanValue(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stripBearer(value) {
    return String(value || '').replace(/^Bearer\s+/i, '').trim();
}

function validateToken(value) {
    if (typeof value !== 'string') throw new Error('invalid_token');
    const token = stripBearer(value);
    if (!token || token.length > 8192 || /[\u0000-\u001f\u007f]/.test(token)) {
        throw new Error('invalid_token');
    }
    return token;
}

function makeRuleId() {
    return 'rule-' + crypto.randomBytes(8).toString('hex');
}

function strategyOrder(strategy, customOrder) {
    if (strategy === 'cloud-first') return DEFAULT_ORDER.slice();
    if (strategy === 'mount-first') return MOUNT_FIRST_ORDER.slice();
    if (strategy !== 'custom' || !Array.isArray(customOrder) || customOrder.length !== VALID_STAGES.length) {
        throw new Error('invalid_strategy_order');
    }
    const order = customOrder.map(value => String(value));
    if (new Set(order).size !== VALID_STAGES.length ||
        VALID_STAGES.some(stage => order.indexOf(stage) < 0)) {
        throw new Error('invalid_strategy_order');
    }
    return order;
}

function normalizeRule(input, defaultOriginState) {
    if (!isObject(input)) throw new Error('invalid_rule');

    const rawId = nonEmpty(input.id);
    const id = rawId || makeRuleId();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('invalid_rule_id');

    const sourcePrefix = pathRules.normalizeMappingPrefix(input.sourcePrefix);
    const mountRaw = nonEmpty(input.mountPrefix);
    const cloudRaw = nonEmpty(input.cloudPrefix);
    const mountPrefix = mountRaw ? pathRules.normalizeMappingPrefix(mountRaw) : null;
    const cloudPrefix = cloudRaw ? pathRules.normalizeCloudPrefix(cloudRaw) : null;
    if (!sourcePrefix) throw new Error('invalid_source_prefix');
    if (mountRaw && !mountPrefix) throw new Error('invalid_mount_prefix');
    if (cloudRaw && !cloudPrefix) throw new Error('invalid_cloud_prefix');

    const storageType = input.storageType === undefined || input.storageType === ''
        ? 'cloud-mount'
        : input.storageType;
    const strategy = input.strategy === undefined || input.strategy === ''
        ? 'cloud-first'
        : input.strategy;
    if (VALID_STORAGE_TYPES.indexOf(storageType) < 0) throw new Error('invalid_storage_type');
    if (VALID_STRATEGIES.indexOf(strategy) < 0) throw new Error('invalid_strategy');
    const originState = ['AUTO', 'USER', 'DISABLED'].indexOf(input.originState) >= 0
        ? input.originState
        : (defaultOriginState || 'USER');
    const enabled = originState === 'DISABLED' ? false : booleanValue(input.enabled, true);

    return {
        id: id,
        sourcePrefix: sourcePrefix,
        mountPrefix: mountPrefix,
        cloudPrefix: cloudPrefix,
        storageType: storageType,
        strategy: strategy,
        order: strategyOrder(strategy, input.order),
        originState: originState,
        enabled: enabled
    };
}

function normalizeConfig(input) {
    if (!isObject(input)) throw new Error('invalid_config');
    if (input.version !== undefined && Number(input.version) !== SCHEMA_VERSION) {
        throw new Error('unsupported_schema');
    }

    const cd2 = isObject(input.cd2) ? input.cd2 : {};
    const origin = nonEmpty(cd2.origin) || DEFAULT_ORIGIN;
    if (!cd2Service.parseOrigin(origin)) throw new Error('invalid_origin');

    const rulesInput = input.rules === undefined ? [] : input.rules;
    if (!Array.isArray(rulesInput)) throw new Error('invalid_rules');
    const rules = rulesInput.map(rule => normalizeRule(rule, 'USER'));
    const ids = new Set();
    rules.forEach(rule => {
        if (ids.has(rule.id)) throw new Error('duplicate_rule_id');
        ids.add(rule.id);
    });

    return {
        version: SCHEMA_VERSION,
        enabled: booleanValue(input.enabled, true),
        cd2: {
            enabled: booleanValue(cd2.enabled, true),
            origin: cd2Service.parseOrigin(origin).url,
            directUrlEnabled: booleanValue(cd2.directUrlEnabled, true)
        },
        rules: rules
    };
}

function ruleFieldsEqual(left, right) {
    if (!left || !right) return false;
    return left.sourcePrefix === right.sourcePrefix &&
        left.mountPrefix === right.mountPrefix &&
        left.cloudPrefix === right.cloudPrefix &&
        left.storageType === right.storageType &&
        left.strategy === right.strategy &&
        left.enabled === right.enabled &&
        JSON.stringify(left.order) === JSON.stringify(right.order);
}

function mappingKey(rule) {
    if (!rule) return '';
    return [rule.sourcePrefix || '', rule.mountPrefix || '', rule.cloudPrefix || ''].join('|');
}

function persistedConfig(config) {
    return {
        version: SCHEMA_VERSION,
        enabled: config.enabled,
        cd2: {
            enabled: config.cd2.enabled,
            origin: config.cd2.origin,
            directUrlEnabled: config.cd2.directUrlEnabled
        },
        rules: config.rules.map(rule => clone(rule))
    };
}

function parseJsonFile(filePath, fileSystem) {
    try {
        return JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeJsonAtomic(filePath, value, fileSystem) {
    const directory = path.dirname(filePath);
    const temporary = filePath + '.tmp-' + process.pid + '-' + Date.now();
    fileSystem.mkdirSync(directory, {recursive: true});
    fileSystem.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {encoding: 'utf8', mode: 0o600});
    fileSystem.renameSync(temporary, filePath);
}

function legacyValue(environment, name) {
    return environment && Object.prototype.hasOwnProperty.call(environment, name)
        ? environment[name]
        : undefined;
}

function hasLegacyEnvironment(environment) {
    return LEGACY_ENV_NAMES.some(name => {
        const value = legacyValue(environment, name);
        return value !== undefined && String(value).trim() !== '';
    });
}

function bootstrapLegacy(environment) {
    const env = environment || {};
    const enabled = booleanValue(legacyValue(env, 'ETE_CD2_ENABLED'), true);
    const originValue = nonEmpty(legacyValue(env, 'ETE_CD2_ORIGIN')) || DEFAULT_ORIGIN;
    const parsedOrigin = cd2Service.parseOrigin(originValue);
    const origin = parsedOrigin ? parsedOrigin.url : DEFAULT_ORIGIN;
    const legacyLocal = pathRules.normalizeMappingPrefix(legacyValue(env, 'ETE_CD2_LOCAL_PREFIX'));
    const explicitSource = pathRules.normalizeMappingPrefix(legacyValue(env, 'ETE_CD2_SOURCE_PREFIX'));
    const explicitMount = pathRules.normalizeMappingPrefix(legacyValue(env, 'ETE_CD2_MOUNT_PREFIX'));
    const sourcePrefix = explicitSource || legacyLocal;
    const mountPrefix = explicitMount || (legacyLocal && pathRules.isWindowsPath(legacyLocal) ? legacyLocal : null);
    const cloudPrefix = pathRules.normalizeCloudPrefix(legacyValue(env, 'ETE_CD2_CLOUD_PREFIX'));
    const rules = [];

    if (sourcePrefix) {
        rules.push({
            id: 'legacy-cd2',
            sourcePrefix: sourcePrefix,
            mountPrefix: mountPrefix,
            cloudPrefix: cloudPrefix,
            storageType: mountPrefix ? 'cloud-mount' : 'cloud-mount',
            strategy: 'cloud-first',
            order: DEFAULT_ORDER.slice(),
            originState: 'AUTO',
            enabled: true
        });
    }

    return {
        config: {
            version: SCHEMA_VERSION,
            enabled: enabled,
            cd2: {
                enabled: enabled,
                origin: origin,
                directUrlEnabled: booleanValue(legacyValue(env, 'ETE_CD2_DIRECT_URL'), true)
            },
            rules: rules
        },
        token: stripBearer(legacyValue(env, 'ETE_CD2_TOKEN'))
    };
}

function defaultConfig() {
    return {
        version: SCHEMA_VERSION,
        enabled: true,
        cd2: {
            enabled: true,
            origin: DEFAULT_ORIGIN,
            directUrlEnabled: true
        },
        rules: []
    };
}

function createStore(options) {
    const settings = options || {};
    const fileSystem = settings.fs || fs;
    const environment = settings.environment || process.env;
    const rootDir = path.resolve(settings.rootDir || path.join(
        settings.userDataPath || environment.APPDATA || process.cwd(), 'config'
    ));
    const configPath = path.join(rootDir, 'strm-resolver.json');
    const secretsPath = path.join(rootDir, 'strm-resolver-secrets.json');
    const configFile = parseJsonFile(configPath, fileSystem);
    let config;
    let token = '';

    if (configFile) {
        try {
            config = normalizeConfig(configFile);
        } catch (_) {
            config = defaultConfig();
        }
    } else if (hasLegacyEnvironment(environment)) {
        const legacy = bootstrapLegacy(environment);
        config = normalizeConfig(legacy.config);
        token = legacy.token;
        if (token) {
            try {
                token = validateToken(token);
                writeJsonAtomic(secretsPath, {version: SCHEMA_VERSION, cd2Token: token}, fileSystem);
            } catch (_) {
                token = '';
            }
        }
        writeJsonAtomic(configPath, persistedConfig(config), fileSystem);
    } else {
        config = defaultConfig();
    }

    if (configFile) {
        const secrets = parseJsonFile(secretsPath, fileSystem);
        if (secrets && typeof secrets.cd2Token === 'string') {
            try { token = validateToken(secrets.cd2Token); } catch (_) { token = ''; }
        }
    }

    function publicConfig() {
        return {
            version: SCHEMA_VERSION,
            enabled: config.enabled,
            cd2: {
                enabled: config.cd2.enabled,
                origin: config.cd2.origin,
                tokenConfigured: !!token,
                directUrlEnabled: config.cd2.directUrlEnabled
            },
            rules: config.rules.map(rule => clone(rule))
        };
    }

    function save(input) {
        const normalized = normalizeConfig(input);
        const previous = new Map(config.rules.map(rule => [rule.id, rule]));
        const nextIds = new Set(normalized.rules.map(rule => rule.id));

        normalized.rules = normalized.rules.map(rule => {
            const old = previous.get(rule.id);
            if (!old) {
                rule.originState = 'USER';
                return rule;
            }
            if (old.originState === 'DISABLED') {
                return clone(old);
            }
            if (old.originState === 'AUTO' && !ruleFieldsEqual(old, rule)) {
                rule.originState = 'USER';
            } else {
                rule.originState = old.originState;
            }
            return rule;
        });

        config.rules.forEach(old => {
            if (!nextIds.has(old.id) && (old.originState === 'AUTO' || old.originState === 'DISABLED')) {
                normalized.rules.push(Object.assign({}, clone(old), {originState: 'DISABLED', enabled: false}));
            }
        });

        config = normalized;
        writeJsonAtomic(configPath, persistedConfig(config), fileSystem);
        return publicConfig();
    }

    function setToken(value) {
        token = validateToken(value);
        writeJsonAtomic(secretsPath, {version: SCHEMA_VERSION, cd2Token: token}, fileSystem);
        return publicConfig();
    }

    function clearToken() {
        token = '';
        writeJsonAtomic(secretsPath, {version: SCHEMA_VERSION}, fileSystem);
        return publicConfig();
    }

    function disableRule(id) {
        const rule = config.rules.find(value => value.id === id);
        if (!rule) throw new Error('rule_not_found');
        rule.originState = 'DISABLED';
        rule.enabled = false;
        writeJsonAtomic(configPath, persistedConfig(config), fileSystem);
        return publicConfig();
    }

    function restoreAutoRule(id) {
        const rule = config.rules.find(value => value.id === id);
        if (!rule) throw new Error('rule_not_found');
        rule.originState = 'AUTO';
        rule.enabled = true;
        writeJsonAtomic(configPath, persistedConfig(config), fileSystem);
        return publicConfig();
    }

    function applyDiscovery(suggestions) {
        if (!Array.isArray(suggestions)) throw new Error('invalid_discovery');
        let changed = false;
        suggestions.forEach(suggestion => {
            let candidate;
            try {
                candidate = normalizeRule(Object.assign({}, suggestion, {originState: 'AUTO'}), 'AUTO');
            } catch (_) {
                return;
            }

            const existing = config.rules.find(rule => rule.id === candidate.id ||
                rule.sourcePrefix === candidate.sourcePrefix);
            if (existing) {
                if (existing.originState !== 'AUTO') return;
                const replacement = Object.assign({}, candidate, {id: existing.id, originState: 'AUTO'});
                if (!ruleFieldsEqual(existing, replacement)) {
                    Object.assign(existing, replacement);
                    changed = true;
                }
                return;
            }

            if (config.rules.some(rule => rule.originState === 'DISABLED' && mappingKey(rule) === mappingKey(candidate))) {
                return;
            }
            config.rules.push(candidate);
            changed = true;
        });

        if (changed) writeJsonAtomic(configPath, persistedConfig(config), fileSystem);
        return publicConfig();
    }

    function getRule(id) {
        const rule = config.rules.find(value => value.id === id);
        return rule ? clone(rule) : null;
    }

    function runtimeConfig() {
        return {
            enabled: config.enabled && config.cd2.enabled,
            origin: cd2Service.parseOrigin(config.cd2.origin),
            token: token,
            directUrlEnabled: config.cd2.directUrlEnabled,
            rules: config.rules.map(rule => clone(rule)),
            totalBudgetMs: 750
        };
    }

    return {
        applyDiscovery: applyDiscovery,
        clearToken: clearToken,
        disableRule: disableRule,
        getConfigPaths: function () { return {configPath: configPath, secretsPath: secretsPath}; },
        getPublicConfig: publicConfig,
        getRule: getRule,
        getRuntimeConfig: runtimeConfig,
        restoreAutoRule: restoreAutoRule,
        save: save,
        setToken: setToken
    };
}

module.exports = {
    DEFAULT_ORDER: DEFAULT_ORDER,
    MOUNT_FIRST_ORDER: MOUNT_FIRST_ORDER,
    SCHEMA_VERSION: SCHEMA_VERSION,
    VALID_STAGES: VALID_STAGES,
    bootstrapLegacy: bootstrapLegacy,
    createStore: createStore,
    defaultConfig: defaultConfig,
    mappingKey: mappingKey,
    normalizeConfig: normalizeConfig,
    normalizeRule: normalizeRule,
    strategyOrder: strategyOrder
};
