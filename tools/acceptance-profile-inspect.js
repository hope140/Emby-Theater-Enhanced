async function inspectAcceptanceProfile(loadRequire, options) {
    var settings = options || {};
    var pollTimeoutMs = Number.isFinite(settings.pollTimeoutMs) ? settings.pollTimeoutMs : 28000;
    var userTimeoutMs = Number.isFinite(settings.userTimeoutMs) ? settings.userTimeoutMs : 5000;
    var pollIntervalMs = Number.isFinite(settings.pollIntervalMs) ? settings.pollIntervalMs : 250;
    var started = Date.now();

    function result(loggedIn, reason) {
        return {loggedIn: loggedIn, reason: reason};
    }

    function inspectionError() {
        return result(false, 'inspection-error');
    }

    function notLoggedIn() {
        return result(false, 'not-logged-in');
    }

    function wait(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function inspectApi(api) {
        var request;

        if (!api || typeof api.getCurrentUser !== 'function') {
            return Promise.resolve(inspectionError());
        }

        try {
            request = Promise.resolve(api.getCurrentUser());
        } catch (err) {
            return Promise.resolve(inspectionError());
        }

        return new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(function () {
                if (!settled) {
                    settled = true;
                    resolve(inspectionError());
                }
            }, userTimeoutMs);

            function finish(value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }

            request.then(function (user) {
                finish(user && typeof user === 'object'
                    ? result(true, 'logged-in')
                    : notLoggedIn());
            }, function () {
                finish(notLoggedIn());
            });
        });
    }

    if (typeof loadRequire !== 'function') {
        return inspectionError();
    }

    var connectionManager;
    try {
        connectionManager = await new Promise(function (resolve, reject) {
            loadRequire(['connectionManager'], resolve, reject);
        });
    } catch (err) {
        return inspectionError();
    }

    if (!connectionManager || typeof connectionManager.currentApiClient !== 'function') {
        return inspectionError();
    }

    while (Date.now() - started < pollTimeoutMs) {
        var api;
        try {
            api = connectionManager.currentApiClient();
        } catch (err) {
            return inspectionError();
        }

        if (api) {
            return inspectApi(api);
        }

        await wait(pollIntervalMs);
    }

    return notLoggedIn();
}
