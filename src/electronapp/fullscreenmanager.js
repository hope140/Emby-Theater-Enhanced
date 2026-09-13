define(['apphost', 'events'], function (appHost, events) {
    'use strict';

    function fullscreenManager() {
        document.addEventListener("windowstatechanged", () => {
            events.trigger(this, 'fullscreenchange')
        })
    }

    fullscreenManager.prototype.requestFullscreen = function (element) {
        appHost.setWindowState('Maximized');
    };

    fullscreenManager.prototype.exitFullscreen = function () {
        appHost.setWindowState('Normal');
    };

    fullscreenManager.prototype.isFullScreen = function () {
        var windowState = appHost.getWindowState();
        return windowState == 'Maximized' || windowState == 'Fullscreen';
    };

    return new fullscreenManager();
});
/* Modified for Emby Theater Enhanced on 2026-09-12/13. Distributed under GPL-2.0-only; see LICENSE. */
