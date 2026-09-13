# 播放链路审计

以下结论来自当前本地源码；行号以初始第一轮导入为参考，继续工作优先搜索函数名。真实运行验收状态以 `docs/LIVE_ACCEPTANCE.md` 为唯一当前真相：2026-09-13 已通过真实 STRM、Session 与后台控制验收；本文件中的静态链路结论不替代该验收。

## 主链路

1. Web UI 将播放请求交给 `www/modules/common/playback/playbackmanager.js`。
2. `getPlaybackInfo`（约 199 行）组织 Item、DeviceProfile、起始位置、MediaSourceId 与 DirectPlay 协议，调用 `apiClient.getPlaybackInfo`（约 284 行）。
3. 同文件约 1003–1121 行读取 PlaybackInfo.MediaSources，优先选可直接播放版本，其次 DirectStream/Transcode；必要时打开 LiveStream。服务器返回的 PlaySessionId 沿上下文传递。
4. `createStreamInfo`（约 1195 行）形成最终 url。DirectPlay 取 MediaSource.Path，DirectStream 取服务器流 URL，Transcode 取 TranscodingUrl；同时保留 item、mediaSource、playSessionId、playMethod 与起始 offset。
5. 初次播放约 1149 行执行 `player.play(streamInfo)`，成功后 `onPlaybackStarted`；换流走 `setSrcIntoPlayer`（约 513 行），仍保留旧会话结束与进度逻辑。
6. `plugins/libmpv.js` 的 `self.play` → `createMediaElement` 创建 `<embed type="application/x-mpvjs">`，收到 ready 后 `playInternal(options)` 读取 options.url 和 options.mediaSource。
7. build overlay 在 PlaybackManager 每次播放入口生成单调 request id，并在异步阶段与 `player.play()` 前拒绝已被新请求淘汰的旧请求；完整 Web snapshot 仍不进入公开仓库。
8. `libmpv.self.play` 同步建立 generation/AbortController，`playInternal` 将 `Item.Path`、`MediaSource.Path` 和原始 `options.url` 分别保存为 `sidecarPath`、`sourcePath` 和 `nativeSource`，异步调用 STRM Source Resolver。
9. Resolver 先把确定性媒体候选经窄 IPC 交给 main-process CD2 service；CD2 miss 再同步尝试 Mount，最终回 native。Resolver 不修改原始 `options` 或播放上下文。
10. 每个 await 后、`currentSrc` 修改前和最终 `loadfile` 前均检查 generation。只有当前请求可以设置 source、绑定/完成 `core-playing` 并进入原 PlaybackManager `onPlaybackStarted`。

## Resolver 插入位置

当前实现位于 `plugins/libmpv.js` 的 `playInternal(options)` 中，读取 `options.url` 后、设置 `currentSrc` 和发出 `loadfile` 前。只在明确 STRM 且原生上下文可用时评估增强；普通媒体保持原路径。原始 `options.item`、`options.mediaSource`、`options.playSessionId`、字幕和播放上报字段均保留。

当前结果可产生 `native`、`local` 或经过 main-process same-origin 校验的 `url`。CD2 使用纯 JS grpc-js、单条 mapping 与 750ms absolute budget；不 refresh、retry、扫描目录、创建 Session 或自行 seek。任何失败先尝试 Mount，再返回 `nativeSource`。

DirectPlay 和 DirectStream 允许在确定性 Mount 命中时替换 source；Transcode 始终保留 native source。起始 offset、音字幕流索引、请求头、鉴权和换流重入仍由原 PlaybackManager/libmpv 生命周期处理，Resolver 不主动重写这些字段。当前已有单元测试和隔离 runtime 夹具验证，真实 Emby Mount 样本仍待用户实机验收。

## 选择与边界

播放器注册及优先级由 PlaybackManager 的 registerPlayer / priority 排序处理；libmpv priority=-2，普通 HTML 视频播放器仍是基线中保留的后备模块。第一轮禁用外置插件注册后，隔离启动实际注册 libmpv、图片、YouTube、HTML audio/video 和远控插件，没有 externalplayer。普通视频是否最终均选中 libmpv，库内仍无真实样本；现有普通媒体证据仅为本地/模拟验证。

独立测试脚本可调用 libmpv 插件播放合成视频来检测桥接；这只是测试入口，产品播放逻辑没有绕过 PlaybackManager。此类测试不代表 Emby Session 正常。
