define(['loading', 'baseView', 'emby-button', 'emby-scroller', 'css!./diagnostics'], function (loading, BaseView) {
    'use strict';

    var CHANNELS = {
        status: 'enhanced-diagnostics-status',
        export: 'enhanced-diagnostics-export',
        open: 'enhanced-diagnostics-open-directory',
        clear: 'enhanced-diagnostics-clear'
    };

    function request(channel, payload) {
        if (!window.ipc || typeof window.ipc.invoke !== 'function') return Promise.reject(new Error('diagnostics_api_unavailable'));
        return window.ipc.invoke(channel, payload);
    }

    function setStatus(node, text, isError) {
        node.textContent = text || '';
        node.setAttribute('role', isError ? 'alert' : 'status');
    }

    function formatBytes(value) {
        var bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes < 0) return '未知';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MiB';
    }

    function DiagnosticsView(view) {
        BaseView.apply(this, arguments);
        this.view = view;
        view.querySelector('.btnExportDiagnostics').addEventListener('click', this.exportDiagnostics.bind(this));
        view.querySelector('.btnOpenDiagnostics').addEventListener('click', this.openDirectory.bind(this));
        view.querySelector('.btnClearDiagnostics').addEventListener('click', this.clearLogs.bind(this));
    }

    Object.assign(DiagnosticsView.prototype, BaseView.prototype);

    DiagnosticsView.prototype.loadStatus = function () {
        var view = this.view;
        loading.show();
        return request(CHANNELS.status).then(function (response) {
            if (!response || response.status !== 'ok') throw new Error('diagnostics_status_failed');
            view.querySelector('.diagnosticsEnabled').textContent = response.enabled === true ? '已启用' : '不可用';
            view.querySelector('.diagnosticsDirectory').textContent = response.logDirectory || '%APPDATA%\\EmbyTheaterEnhanced\\logs';
            view.querySelector('.diagnosticsSize').textContent = formatBytes(response.currentBytes);
            setStatus(view.querySelector('.diagnosticsState'), '', false);
        }).catch(function () {
            setStatus(view.querySelector('.diagnosticsState'), '无法读取日志状态，请重启应用后重试。', true);
        }).then(function () {
            loading.hide();
        });
    };

    DiagnosticsView.prototype.exportDiagnostics = function () {
        var view = this.view;
        var button = view.querySelector('.btnExportDiagnostics');
        button.disabled = true;
        setStatus(view.querySelector('.diagnosticsState'), '正在准备诊断报告…', false);
        request(CHANNELS.export).then(function (response) {
            if (response && response.status === 'exported') {
                setStatus(view.querySelector('.diagnosticsState'), '已导出：' + response.fileName, false);
            } else if (response && response.status === 'cancelled') {
                setStatus(view.querySelector('.diagnosticsState'), '已取消导出。', false);
            } else {
                setStatus(view.querySelector('.diagnosticsState'), '导出失败，请稍后重试。', true);
            }
        }).catch(function () {
            setStatus(view.querySelector('.diagnosticsState'), '导出失败，请稍后重试。', true);
        }).then(function () {
            button.disabled = false;
        });
    };

    DiagnosticsView.prototype.openDirectory = function () {
        var state = this.view.querySelector('.diagnosticsState');
        request(CHANNELS.open).then(function (response) {
            setStatus(state, response && response.status === 'opened' ? '已打开日志目录。' : '无法打开日志目录。', !(response && response.status === 'opened'));
        }).catch(function () {
            setStatus(state, '无法打开日志目录。', true);
        });
    };

    DiagnosticsView.prototype.clearLogs = function () {
        var state = this.view.querySelector('.diagnosticsState');
        if (!window.confirm('确定清空诊断日志？')) return;
        if (!window.confirm('再次确认：当前日志和轮转日志都将被删除。')) return;
        request(CHANNELS.clear, {confirmed: true}).then(function (response) {
            if (response && response.status === 'cleared') {
                setStatus(state, '日志已清空。', false);
                this.loadStatus();
            } else {
                setStatus(state, '清空日志失败。', true);
            }
        }.bind(this)).catch(function () {
            setStatus(state, '清空日志失败。', true);
        });
    };

    DiagnosticsView.prototype.onResume = function (options) {
        BaseView.prototype.onResume.apply(this, arguments);
        if (!options || options.refresh !== false) this.loadStatus();
        else loading.hide();
    };

    DiagnosticsView.prototype.onPause = function () {
        BaseView.prototype.onPause.apply(this, arguments);
    };

    return DiagnosticsView;
});
