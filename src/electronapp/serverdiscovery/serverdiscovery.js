define([], function () {

    return {

        findServers: function (timeoutMs) {

            return new Promise(function (resolve, reject) {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', 'electronserverdiscovery://findservers?timeout=' + timeoutMs, true);
                xhr.onload = function () {
                    if (this.response) {
                        var data = this.response;
                        try {
                            var servers = JSON.parse(data);
                            resolve(servers);
                        } catch (e){
                            reject();
                        }
                    } else {
                        reject();
                    }
                };
                xhr.onerror = reject;
                xhr.send();
                // Expected server properties
                // Name, Id, Address, EndpointAddress (optional)
            });
        }
    };

});
/* Modified for Emby Theater Enhanced on 2026-09-12/13. Distributed under GPL-2.0-only; see LICENSE. */
