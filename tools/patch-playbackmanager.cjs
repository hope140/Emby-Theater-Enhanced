'use strict';

const fs = require('fs');

const file = process.argv[2];
if (!file) throw new Error('PlaybackManager path is required.');
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(name, before, after) {
    const first = source.indexOf(before);
    if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
        throw new Error(name + ' anchor count mismatch.');
    }
    source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
    'request sequence',
    '    function playInternal(item, playOptions, onPlaybackStartedFn) {\n      return "disc" === item.Container',
    '    function isCurrentEnhancedPlayRequest(playOptions) {\n' +
    '      return !playOptions || !playOptions._etePlayRequestId || playOptions._etePlayRequestId === self._etePlayRequestSequence;\n' +
    '    }\n' +
    '    function playInternal(item, playOptions, onPlaybackStartedFn) {\n' +
    '      playOptions = playOptions || {};\n' +
    '      self._etePlayRequestSequence = (self._etePlayRequestSequence || 0) + 1;\n' +
    '      playOptions._etePlayRequestId = self._etePlayRequestSequence;\n' +
    '      return "disc" === item.Container'
);

replaceOnce(
    'preplay generation check',
    '            .then(function () {\n              playOptions.fullscreen && _loading.default.show();',
    '            .then(function () {\n' +
    '              if (!isCurrentEnhancedPlayRequest(playOptions)) return;\n' +
    '              playOptions.fullscreen && _loading.default.show();'
);

replaceOnce(
    'play failure generation check',
    '            }, onInterceptorRejection)\n            .catch(onUnhandledPlaybackFailure));',
    '            }, onInterceptorRejection)\n' +
    '            .catch(function (error) {\n' +
    '              if (!isCurrentEnhancedPlayRequest(playOptions)) return;\n' +
    '              return onUnhandledPlaybackFailure(error);\n' +
    '            }));'
);

replaceOnce(
    'playAfter generation check',
    '    function playAfterBitrateDetect(maxBitrate, item, playOptions, onPlaybackStartedFn) {\n      var startPosition = playOptions.startPositionTicks,',
    '    function playAfterBitrateDetect(maxBitrate, item, playOptions, onPlaybackStartedFn) {\n' +
    '      if (!isCurrentEnhancedPlayRequest(playOptions)) return Promise.resolve();\n' +
    '      var startPosition = playOptions.startPositionTicks,'
);

replaceOnce(
    'device profile generation check',
    '          : Promise.all([promise, player.getDeviceProfile(item)]).then(function (responses) {\n              onPlaybackRequested(player, streamInfo);',
    '          : Promise.all([promise, player.getDeviceProfile(item)]).then(function (responses) {\n' +
    '              if (!isCurrentEnhancedPlayRequest(playOptions)) return;\n' +
    '              onPlaybackRequested(player, streamInfo);'
);

replaceOnce(
    'resolved media generation check',
    '                  ).then(function (mediaSourceInfo) {\n                    var mediaSource = mediaSourceInfo.mediaSource,',
    '                  ).then(function (mediaSourceInfo) {\n' +
    '                    if (!isCurrentEnhancedPlayRequest(playOptions)) return;\n' +
    '                    var mediaSource = mediaSourceInfo.mediaSource,'
);

replaceOnce(
    'local generation check',
    '        : promise.then(function () {\n            var streamInfo = (function (item) {',
    '        : promise.then(function () {\n' +
    '            if (!isCurrentEnhancedPlayRequest(playOptions)) return;\n' +
    '            var streamInfo = (function (item) {'
);

replaceOnce(
    'stream request id',
    '      return mediaSourceContainer && (prefix.backdropUrl = mediaSourceContainer), prefix;\n',
    '      item && item.playOptions && item.playOptions._etePlayRequestId &&\n' +
    '        (prefix._etePlayRequestId = item.playOptions._etePlayRequestId);\n' +
    '      return mediaSourceContainer && (prefix.backdropUrl = mediaSourceContainer), prefix;\n'
);

replaceOnce(
    'stream change superseded',
    '          function (err) {\n            console.log("setSrcIntoPlayer error: " + err),\n              previousPlaySessionId && apiClient.stopActiveEncodings(previousPlaySessionId);\n            var playerData = getPlayerData(player);',
    '          function (err) {\n' +
    '            if (err && err.playbackSuperseded) {\n' +
    '              previousPlaySessionId && apiClient.stopActiveEncodings(previousPlaySessionId);\n' +
    '              return;\n' +
    '            }\n' +
    '            console.log("setSrcIntoPlayer error: " + err),\n' +
    '              previousPlaySessionId && apiClient.stopActiveEncodings(previousPlaySessionId);\n' +
    '            var playerData = getPlayerData(player);'
);

replaceOnce(
    'initial play superseded',
    '                        function (err) {\n                          return (\n                            console.log("player.play error: " + err),',
    '                        function (err) {\n' +
    '                          if (err && err.playbackSuperseded) return;\n' +
    '                          return (\n' +
    '                            console.log("player.play error: " + err),'
);

replaceOnce(
    'local play superseded',
    '                function () {\n                  _loading.default.hide(), self.stop(player);\n                }',
    '                function (err) {\n' +
    '                  if (err && err.playbackSuperseded) return;\n' +
    '                  _loading.default.hide(), self.stop(player);\n' +
    '                }'
);

replaceOnce(
    'terminal stop invalidation',
    '    (PlaybackManager.prototype.stop = function (player) {\n      return (player = player || this._currentPlayer)',
    '    (PlaybackManager.prototype.stop = function (player) {\n' +
    '      this._etePlayRequestSequence = (this._etePlayRequestSequence || 0) + 1;\n' +
    '      return (player = player || this._currentPlayer)'
);

fs.writeFileSync(file, source, 'utf8');
