# 播放链路审计

以下结论来自当前本地源码；行号以初始第一轮导入为参考，继续工作优先搜索函数名。真实运行验收状态以 `docs/LIVE_ACCEPTANCE.md` 为唯一当前真相：2026-09-13 已通过真实 STRM、Session 与后台控制验收；本文件中的静态链路结论不替代该验收。

## 主链路

1. Web UI 将播放请求交给 `www/modules/common/playback/playbackmanager.js`。
2. `getPlaybackInfo`（约 199 行）组织 Item、DeviceProfile、起始位置、MediaSourceId 与 DirectPlay 协议，调用 `apiClient.getPlaybackInfo`（约 284 行）。
3. 同文件约 1003–1121 行读取 PlaybackInfo.MediaSources，优先选可直接播放版本，其次 DirectStream/Transcode；必要时打开 LiveStream。服务器返回的 PlaySessionId 沿上下文传递。
4. `createStreamInfo`（约 1195 行）形成最终 url。DirectPlay 取 MediaSource.Path，DirectStream 取服务器流 URL，Transcode 取 TranscodingUrl；同时保留 item、mediaSource、playSessionId、playMethod 与起始 offset。
5. 初次播放约 1149 行执行 `player.play(streamInfo)`，成功后 `onPlaybackStarted`；换流走 `setSrcIntoPlayer`（约 513 行），仍保留旧会话结束与进度逻辑。
6. `plugins/libmpv.js` 的 `self.play` → `createMediaElement` 创建 `<embed type="application/x-mpvjs">`，收到 ready 后 `playInternal(options)` 读取 options.url 和 options.mediaSource。
7. `playInternal` 设置 Emby 播放属性，随后 `sendCommand(['loadfile', url])`，通过 embed.postMessage 交给 Pepper bridge 和同目录 mpv-1.dll。

## 未来 Resolver 插入位置

建议在 `plugins/libmpv.js` 的 `playInternal(options)` 中，读取 `options.url` 后、设置 `currentSrc` 和发出 loadfile 前。只在明确 STRM 且原生上下文已可用时评估增强；普通媒体保持原路径。保留原始 `options.item`、`options.mediaSource`、`options.playSessionId`、字幕和播放上报字段。

未来结果可使用 `{type: 'native'|'local'|'url', source: '...'}`。输入同时保存 `sidecarPath=Item.Path`、`sourcePath=MediaSource.Path`、`nativeSource=options.url`。失败必须返回 nativeSource。第一轮尚未添加 Resolver 模块。

这是候选插入点，不是已经验证的 Resolver 契约。后续必须分别验证 DirectPlay、DirectStream、Transcode 的起始 offset、音字幕流索引、请求头、鉴权与换流重入。尤其不能在收到转码流上下文时只换成原文件而继续沿用转码 offset；需要限定适用条件。

## 选择与边界

播放器注册及优先级由 PlaybackManager 的 registerPlayer / priority 排序处理；libmpv priority=-2，普通 HTML 视频播放器仍是基线中保留的后备模块。第一轮禁用外置插件注册后，隔离启动实际注册 libmpv、图片、YouTube、HTML audio/video 和远控插件，没有 externalplayer。普通视频是否最终均选中 libmpv，库内仍无真实样本；现有普通媒体证据仅为本地/模拟验证。

独立测试脚本可调用 libmpv 插件播放合成视频来检测桥接；这只是测试入口，产品播放逻辑没有绕过 PlaybackManager。此类测试不代表 Emby Session 正常。
