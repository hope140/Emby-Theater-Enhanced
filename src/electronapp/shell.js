define([], function () {

    function sendCommand(name) {

        return new Promise(function (resolve, reject) {

            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'electronapphost://' + name, true);

            xhr.onload = function () {
                if (this.response) {
                    resolve(this.response);
                } else {
                    reject();
                }
            };
            xhr.onerror = reject;
            xhr.send();
        });
    }

    var shell = {};

    shell.openUrl = function (url) {
        return sendCommand('openurl?url=' + url);
    };

    return shell;
});
/* Modified for Emby Theater Enhanced on 2026-09-12/13. Distributed under GPL-2.0-only; see LICENSE. */
