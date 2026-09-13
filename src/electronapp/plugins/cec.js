define(['globalize', 'apphost', 'playbackManager', 'pluginManager', 'events', 'embyRouter', 'appSettings', 'userSettings', 'loading', 'dom', 'require', 'connectionManager'], function (globalize, appHost, playbackManager, pluginManager, events, embyRouter, appSettings, userSettings, loading, dom, require, connectionManager) {
    'use strict';

    return function () {

        this.name = 'cec';
        this.type = 'input'
        this.id = 'cecinput';

        this.getRoutes = function () {

            var routes = [];

            routes.push({
                path: 'cec/cec.html',
                transition: 'slide',
                controller: pluginManager.mapPath(this, 'cec/cec.js'),
                type: 'settings',
                title: 'HDMI-CEC',
                category: 'Playback',
                thumbImage: '',
                icon: 'tv',
                settingsTheme: true,
                adjustHeaderForEmbeddedScroll: true
            });

            return routes;
        };

        function startClient() {
            return new Promise((resolve, reject) => {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', `electroncec://start?hdmiport=${appSettings.get('cec-hdmiport')}`)
                xhr.onload = function () {
                    resolve(this.response)
                }
                xhr.onerror = reject;
                xhr.send();
            })
        }

        startClient()
    }

})
/* Modified for Emby Theater Enhanced on 2026-09-12/13. Distributed under GPL-2.0-only; see LICENSE. */
