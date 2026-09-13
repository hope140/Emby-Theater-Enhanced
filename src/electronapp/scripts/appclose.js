require(['playbackManager'], function (playbackManager) {
    'use strict';

    window.AppCloseHelper = {
        onClosing: function () {

            // Prevent backwards navigation from stopping video
            history.back = function () { };

            playbackManager.onAppClose();
        }
    };
});
/* Modified for Emby Theater Enhanced on 2026-09-12/13. Distributed under GPL-2.0-only; see LICENSE. */
