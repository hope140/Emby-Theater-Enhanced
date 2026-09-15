define(['loading', 'baseView', 'emby-select', 'emby-checkbox', 'emby-input', 'emby-button', 'emby-scroller', 'css!./strm'], function (loading, BaseView) {
    'use strict';

    var CHANNELS = {
        get: 'enhanced-strm-config-get',
        save: 'enhanced-strm-config-save',
        setToken: 'enhanced-strm-token-set',
        clearToken: 'enhanced-strm-token-clear',
        testConnection: 'enhanced-strm-cd2-test-connection',
        testRule: 'enhanced-strm-rule-test',
        restoreAuto: 'enhanced-strm-rule-restore-auto',
        disableRule: 'enhanced-strm-rule-disable'
    };
    var STAGES = ['direct-url', 'cd2-http', 'mount', 'native'];
    var STAGE_LABELS = {
        'direct-url': 'DirectUrl',
        'cd2-http': 'CD2 HTTP',
        mount: 'Mount',
        native: 'Native'
    };
    var STRATEGY_ORDERS = {
        'cloud-first': ['direct-url', 'cd2-http', 'mount', 'native'],
        'mount-first': ['mount', 'direct-url', 'cd2-http', 'native']
    };

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function option(value, label) {
        var node = element('option', null, label);
        node.value = value;
        return node;
    }

    function request(channel, payload) {
        if (!window.ipc || typeof window.ipc.invoke !== 'function') {
            return Promise.reject(new Error('config_api_unavailable'));
        }
        return window.ipc.invoke(channel, payload);
    }

    function statusText(response) {
        if (!response) return '配置服务不可用，请重启应用后重试。';
        if (response.reason === 'untrusted_sender') return '配置服务拒绝了当前页面。';
        if (response.reason === 'invalid_config') return '保存失败：请检查路径和地址格式。';
        if (response.reason === 'invalid_token') return 'Token 无效，请输入不含控制字符的值。';
        return '操作未完成，请检查配置后重试。';
    }

    function strategyOrder(strategy, customOrder) {
        if (STRATEGY_ORDERS[strategy]) return STRATEGY_ORDERS[strategy].slice();
        if (strategy === 'custom' && Array.isArray(customOrder) && customOrder.length === 4) return customOrder.slice();
        return STAGES.slice();
    }

    function setStatus(node, text, isError) {
        node.textContent = text || '';
        node.setAttribute('role', isError ? 'alert' : 'status');
    }

    function ruleStateLabel(state) {
        if (state === 'USER') return '用户配置';
        if (state === 'DISABLED') return '已抑制';
        return '自动建议';
    }

    function storageLabel(value) {
        return value === 'local-nas' ? 'NAS / 本地存储' : '云盘挂载';
    }

    function createLabeledInput(ruleId, field, label, value) {
        var wrapper = element('div', 'inputContainer');
        var inputId = 'ete-rule-' + ruleId + '-' + field;
        var labelNode = element('label', 'ete-strm-field-label', label);
        var input = element('input');
        input.id = inputId;
        input.type = 'text';
        input.className = 'rule-' + field;
        input.value = value || '';
        input.setAttribute('is', 'emby-input');
        input.setAttribute('aria-label', label);
        labelNode.htmlFor = inputId;
        wrapper.appendChild(labelNode);
        wrapper.appendChild(input);
        return wrapper;
    }

    function createLabeledSelect(ruleId, field, label, values, selected, labels) {
        var wrapper = element('div', 'selectContainer');
        var selectId = 'ete-rule-' + ruleId + '-' + field;
        var labelNode = element('label', 'ete-strm-field-label', label);
        var select = element('select');
        select.id = selectId;
        select.className = 'rule-' + field;
        select.setAttribute('is', 'emby-select');
        select.setAttribute('aria-label', label);
        labelNode.htmlFor = selectId;
        values.forEach(function (value) {
            select.appendChild(option(value, labels[value] || value));
        });
        select.value = selected;
        wrapper.appendChild(labelNode);
        wrapper.appendChild(select);
        return wrapper;
    }

    function createOrderEditor(ruleId, order) {
        var wrapper = element('div', 'ete-strm-custom-order');
        order = strategyOrder('custom', order);
        for (var index = 0; index < STAGES.length; index++) {
            var label = element('label', null, '第 ' + (index + 1) + ' 顺位');
            var select = element('select', 'rule-order-stage');
            select.setAttribute('is', 'emby-select');
            select.setAttribute('aria-label', '自定义顺序第 ' + (index + 1) + ' 顺位');
            select.dataset.index = String(index);
            STAGES.forEach(function (stage) {
                select.appendChild(option(stage, STAGE_LABELS[stage]));
            });
            select.value = order[index];
            label.appendChild(select);
            wrapper.appendChild(label);
        }
        return wrapper;
    }

    function updateOrderPreview(card) {
        var strategy = card.querySelector('.rule-strategy').value;
        var order = strategyOrder(strategy, Array.prototype.map.call(card.querySelectorAll('.rule-order-stage'), function (select) {
            return select.value;
        }));
        var value = card.querySelector('.ete-strm-order-value');
        var editor = card.querySelector('.ete-strm-custom-order');
        value.textContent = order.map(function (stage) { return STAGE_LABELS[stage]; }).join(' → ');
        if (strategy === 'custom') {
            if (!editor) {
                editor = createOrderEditor(card.dataset.ruleId, order);
                card.querySelector('.ete-strm-order').appendChild(editor);
            }
            editor.classList.remove('hide');
        } else if (editor) {
            editor.classList.add('hide');
        }
    }

    function renderRule(rule) {
        var card = element('article', 'ete-strm-rule-card');
        var heading = element('div', 'ete-strm-rule-heading');
        var title = element('span', 'ete-strm-rule-title', rule.sourcePrefix || '新建路径规则');
        var state = element('span', 'ete-strm-rule-state', ruleStateLabel(rule.originState));
        var grid = element('div', 'ete-strm-rule-grid');
        var order = element('div', 'ete-strm-order');
        var orderLabel = element('span', 'ete-strm-order-label', '实际顺序');
        var orderValue = element('span', 'ete-strm-order-value');
        var actions = element('div', 'ete-strm-rule-actions');
        var testButton = element('button', null, '测试映射');
        var restoreButton = element('button', null, '恢复自动配置');
        var disableButton = element('button', null, rule.originState === 'DISABLED' ? '保持抑制' : '禁用/删除');
        var result = element('span', 'ete-strm-rule-test secondaryText');

        card.dataset.ruleId = rule.id;
        heading.appendChild(title);
        heading.appendChild(state);
        card.appendChild(heading);
        grid.appendChild(createLabeledInput(rule.id, 'sourcePrefix', '源路径', rule.sourcePrefix));
        grid.appendChild(createLabeledInput(rule.id, 'mountPrefix', '挂载路径', rule.mountPrefix));
        grid.appendChild(createLabeledInput(rule.id, 'cloudPrefix', 'CloudDrive2 路径', rule.cloudPrefix));
        grid.appendChild(createLabeledSelect(rule.id, 'storageType', '存储类型', ['cloud-mount', 'local-nas'], rule.storageType, {
            'cloud-mount': '云盘挂载',
            'local-nas': 'NAS / 本地存储'
        }));
        grid.appendChild(createLabeledSelect(rule.id, 'strategy', '解析策略', ['cloud-first', 'mount-first', 'custom'], rule.strategy, {
            'cloud-first': '云端直连优先',
            'mount-first': '本地 / NAS 优先',
            custom: '自定义顺序'
        }));
        card.appendChild(grid);
        order.appendChild(orderLabel);
        order.appendChild(orderValue);
        if (rule.strategy === 'custom') order.appendChild(createOrderEditor(rule.id, rule.order));
        card.appendChild(order);

        testButton.type = 'button';
        restoreButton.type = 'button';
        disableButton.type = 'button';
        testButton.className = 'btnTestRule';
        restoreButton.className = 'btnRestoreAuto';
        disableButton.className = 'btnDisableRule';
        actions.appendChild(testButton);
        if (rule.originState !== 'AUTO') actions.appendChild(restoreButton);
        actions.appendChild(disableButton);
        actions.appendChild(result);
        card.appendChild(actions);
        updateOrderPreview(card);

        if (rule.originState === 'DISABLED') {
            card.classList.add('is-disabled');
            Array.prototype.forEach.call(card.querySelectorAll('input, select'), function (input) { input.disabled = true; });
            restoreButton.disabled = false;
            disableButton.disabled = true;
        }
        return card;
    }

    function renderConfig(view, config) {
        var list = view.querySelector('.rulesList');
        view.querySelector('.chkEnabled').checked = config.enabled === true;
        view.querySelector('.chkCd2Enabled').checked = config.cd2.enabled === true;
        view.querySelector('.chkDirectUrlEnabled').checked = config.cd2.directUrlEnabled !== false;
        view.querySelector('.txtCd2Origin').value = config.cd2.origin || '';
        view.querySelector('.txtCd2Token').value = '';
        view.querySelector('.tokenState').textContent = config.cd2.tokenConfigured ? '已配置 ········' : '未配置';
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!config.rules.length) {
            list.appendChild(element('div', 'ete-strm-empty secondaryText', '尚未配置路径规则。添加一条规则后，STRM 将按最长前缀匹配。'));
        } else {
            config.rules.forEach(function (rule) { list.appendChild(renderRule(rule)); });
        }
    }

    function collectConfig(view, config) {
        var next = clone(config);
        next.enabled = view.querySelector('.chkEnabled').checked;
        next.cd2.enabled = view.querySelector('.chkCd2Enabled').checked;
        next.cd2.directUrlEnabled = view.querySelector('.chkDirectUrlEnabled').checked;
        next.cd2.origin = view.querySelector('.txtCd2Origin').value.trim();
        next.rules = Array.prototype.map.call(view.querySelectorAll('.ete-strm-rule-card'), function (card) {
            var original = next.rules.filter(function (rule) { return rule.id === card.dataset.ruleId; })[0] || {
                id: card.dataset.ruleId,
                originState: 'USER',
                enabled: true
            };
            var strategy = card.querySelector('.rule-strategy').value;
            var order = strategy === 'custom'
                ? Array.prototype.map.call(card.querySelectorAll('.rule-order-stage'), function (select) { return select.value; })
                : strategyOrder(strategy);
            return {
                id: original.id,
                sourcePrefix: card.querySelector('.rule-sourcePrefix').value.trim(),
                mountPrefix: card.querySelector('.rule-mountPrefix').value.trim(),
                cloudPrefix: card.querySelector('.rule-cloudPrefix').value.trim(),
                storageType: card.querySelector('.rule-storageType').value,
                strategy: strategy,
                order: order,
                originState: original.originState,
                enabled: original.enabled !== false
            };
        });
        return next;
    }

    function newRule() {
        return {
            id: 'new-rule-' + Date.now().toString(36),
            sourcePrefix: '',
            mountPrefix: '',
            cloudPrefix: '',
            storageType: 'cloud-mount',
            strategy: 'cloud-first',
            order: STAGES.slice(),
            originState: 'USER',
            enabled: true
        };
    }

    function SettingsView(view) {
        BaseView.apply(this, arguments);
        this.view = view;
        this.config = null;
        this.loadingConfig = null;
        view.querySelector('form').addEventListener('submit', function (event) {
            event.preventDefault();
            this.saveSettings();
        }.bind(this));
        view.querySelector('.btnAddRule').addEventListener('click', function () {
            if (!this.config) return;
            this.config.rules.push(newRule());
            renderConfig(view, this.config);
            var first = view.querySelector('.rule-sourcePrefix');
            if (first) first.focus();
        }.bind(this));
        view.addEventListener('change', function (event) {
            if (event.target.classList.contains('rule-strategy') || event.target.classList.contains('rule-order-stage')) {
                updateOrderPreview(event.target.closest('.ete-strm-rule-card'));
            }
        });
        view.addEventListener('click', function (event) {
            var card = event.target.closest('.ete-strm-rule-card');
            var ruleId = card && card.dataset.ruleId;
            if (!card || !ruleId) return;
            if (event.target.classList.contains('btnTestRule')) this.testRule(ruleId, card);
            if (event.target.classList.contains('btnRestoreAuto')) this.restoreAuto(ruleId);
            if (event.target.classList.contains('btnDisableRule')) this.disableRule(ruleId);
        }.bind(this));
        view.querySelector('.btnSetToken').addEventListener('click', function () { this.setToken(); }.bind(this));
        view.querySelector('.btnClearToken').addEventListener('click', function () { this.clearToken(); }.bind(this));
        view.querySelector('.btnTestConnection').addEventListener('click', function () { this.testConnection(); }.bind(this));
    }

    Object.assign(SettingsView.prototype, BaseView.prototype);

    SettingsView.prototype.loadSettings = function () {
        var view = this.view;
        loading.show();
        this.loadingConfig = request(CHANNELS.get).then(function (config) {
            if (!config || Number(config.version) !== 1 || !config.cd2 || !Array.isArray(config.rules)) {
                throw new Error('invalid_config_response');
            }
            this.config = clone(config);
            renderConfig(view, this.config);
            setStatus(view.querySelector('.saveState'), '', false);
            loading.hide();
            return config;
        }.bind(this)).catch(function () {
            loading.hide();
            setStatus(view.querySelector('.saveState'), '无法读取 STRM 设置，请重启应用后重试。', true);
        });
        return this.loadingConfig;
    };

    SettingsView.prototype.saveSettings = function () {
        if (!this.config) return Promise.resolve();
        var view = this.view;
        var next = collectConfig(view, this.config);
        var button = view.querySelector('.btnSave');
        button.disabled = true;
        setStatus(view.querySelector('.saveState'), '正在保存…', false);
        return request(CHANNELS.save, {config: next}).then(function (response) {
            if (!response || response.status !== 'saved') {
                setStatus(view.querySelector('.saveState'), statusText(response), true);
                return;
            }
            this.config = clone(response.config);
            renderConfig(view, this.config);
            setStatus(view.querySelector('.saveState'), response.requiresRestart ? '已保存，重启应用后播放链生效。' : '设置已保存。', false);
        }.bind(this)).catch(function () {
            setStatus(view.querySelector('.saveState'), '保存失败，请检查配置服务。', true);
        }).then(function () {
            button.disabled = false;
        });
    };

    SettingsView.prototype.setToken = function () {
        var view = this.view;
        var input = view.querySelector('.txtCd2Token');
        var value = input.value;
        if (!value) {
            setStatus(view.querySelector('.saveState'), '请输入新的 Token。', true);
            input.focus();
            return;
        }
        input.disabled = true;
        request(CHANNELS.setToken, {token: value}).then(function (response) {
            if (!response || response.status !== 'saved') {
                setStatus(view.querySelector('.saveState'), statusText(response), true);
                return;
            }
            this.config = clone(response.config);
            input.value = '';
            view.querySelector('.tokenState').textContent = '已配置 ········';
            setStatus(view.querySelector('.saveState'), 'Token 已保存，重启应用后播放链生效。', false);
        }.bind(this)).catch(function () {
            setStatus(view.querySelector('.saveState'), 'Token 保存失败。', true);
        }).then(function () {
            input.disabled = false;
        });
    };

    SettingsView.prototype.clearToken = function () {
        if (!window.confirm('清除 CloudDrive2 Token？')) return;
        request(CHANNELS.clearToken).then(function (response) {
            if (!response || response.status !== 'saved') {
                setStatus(this.view.querySelector('.saveState'), statusText(response), true);
                return;
            }
            this.config = clone(response.config);
            this.view.querySelector('.tokenState').textContent = '未配置';
            setStatus(this.view.querySelector('.saveState'), 'Token 已清除，重启应用后播放链生效。', false);
        }.bind(this)).catch(function () {
            setStatus(this.view.querySelector('.saveState'), 'Token 清除失败。', true);
        }.bind(this));
    };

    SettingsView.prototype.testConnection = function () {
        var state = this.view.querySelector('.connectionState');
        state.textContent = '正在连接…';
        request(CHANNELS.testConnection).then(function (response) {
            var message = {
                ok: '连接正常',
                auth_failed: '认证失败',
                connection_failed: '连接失败',
                incomplete: '配置不完整'
            }[response && response.status] || '连接失败';
            state.textContent = message;
            state.setAttribute('role', response && response.status === 'ok' ? 'status' : 'alert');
        }).catch(function () {
            state.textContent = '连接失败';
            state.setAttribute('role', 'alert');
        });
    };

    SettingsView.prototype.testRule = function (ruleId, card) {
        var state = card.querySelector('.ete-strm-rule-test');
        state.textContent = '正在检查…';
        request(CHANNELS.testRule, {ruleId: ruleId}).then(function (response) {
            if (!response || response.status === 'error') {
                state.textContent = statusText(response);
                state.setAttribute('role', 'alert');
                return;
            }
            var mount = response.mount === 'not_configured' ? '挂载未配置' : '挂载 ' + response.mount;
            var cloud = response.cloud === 'not_configured' ? 'CD2 路径未配置' : 'CD2 映射 ' + response.cloud;
            state.textContent = mount + '；' + cloud;
            state.setAttribute('role', response.status === 'ok' ? 'status' : 'alert');
        }).catch(function () {
            state.textContent = '规则检查失败';
            state.setAttribute('role', 'alert');
        });
    };

    SettingsView.prototype.restoreAuto = function (ruleId) {
        request(CHANNELS.restoreAuto, {ruleId: ruleId}).then(function (response) {
            if (!response || response.status !== 'saved') {
                setStatus(this.view.querySelector('.saveState'), statusText(response), true);
                return;
            }
            this.config = clone(response.config);
            renderConfig(this.view, this.config);
            setStatus(this.view.querySelector('.saveState'), '已恢复自动配置。', false);
        }.bind(this)).catch(function () {
            setStatus(this.view.querySelector('.saveState'), '恢复自动配置失败。', true);
        }.bind(this));
    };

    SettingsView.prototype.disableRule = function (ruleId) {
        if (!window.confirm('禁用这条路径规则？系统不会在自动发现时重新创建相同映射。')) return;
        request(CHANNELS.disableRule, {ruleId: ruleId}).then(function (response) {
            if (!response || response.status !== 'saved') {
                setStatus(this.view.querySelector('.saveState'), statusText(response), true);
                return;
            }
            this.config = clone(response.config);
            renderConfig(this.view, this.config);
            setStatus(this.view.querySelector('.saveState'), '规则已禁用并记住抑制状态。', false);
        }.bind(this)).catch(function () {
            setStatus(this.view.querySelector('.saveState'), '规则禁用失败。', true);
        }.bind(this));
    };

    SettingsView.prototype.onResume = function (options) {
        BaseView.prototype.onResume.apply(this, arguments);
        if (!this.config || (options && options.refresh)) this.loadSettings();
        else loading.hide();
    };

    SettingsView.prototype.onPause = function () {
        if (this.config) this.saveSettings();
        BaseView.prototype.onPause.apply(this, arguments);
    };

    return SettingsView;
});
