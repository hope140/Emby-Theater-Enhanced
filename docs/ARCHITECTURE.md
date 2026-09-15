# 架构

基线为提供的 Carnival 3.0（应用声明 3.0.20-3.0）叠加综合补丁。保留 Windows .NET 启动壳、Electron、离线 Web UI 与内嵌 libmpv 的现有目录关系。

普通视频：Emby → PlaybackManager → 原生 MediaSource → libmpv 插件 → Pepper bridge → mpv-1.dll。Session、PlaySession、进度和远控仍由 Emby Web 生命周期负责。

STRM 增强：仅在确认 `Item.Path` 的 `.strm` 后缀或 `MediaSource.Container=strm` 时，在正常播放上下文内按命中规则的 DirectUrl/CD2 HTTP/Mount/Native 顺序解析。Resolver 位于 `libmpv.js` 的 `playInternal(options)`，只替换最终交给 `loadfile` 的 source。`sidecarPath=Item.Path`、`sourcePath=MediaSource.Path`、`nativeSource=options.url`，三者不可互换；PlaybackManager、Item、MediaSource、PlaySession、WebSocket 和远控生命周期保持原链路。Transcode 永远使用 native source。

`src/electronapp/resolvers/strm-resolver.js` 负责 STRM 判定、异步 source 编排、播放方式保护与 fallback；`mount-resolver.js` 生成确定性本地候选并执行 `existsSync`；`cd2-resolver.js` 只通过窄 IPC 请求 source。Electron main process 的 `enhanced/cd2-service.js` 持有 token、proto、grpc channel 与 active calls，按命中的规则执行 `sourcePrefix → cloudPrefix` mapping，依次调用 `FindFileByPath` 与 `GetDownloadUrlPath`。DirectUrl 只在 URL、expiry、空 additionalHeaders 与受限 User-Agent 全部安全时返回；否则复用同次响应或再次请求的 same-origin `downloadUrlPath`。source/mount/cloud 三个 prefix 保持独立；Windows drive/UNC 比较大小写不敏感，absolute POSIX 比较大小写敏感，均执行严格边界与 `..` 检查。main 从 persistent config store 创建 service，并立即删除 `process.env` 中的全部 `ETE_CD2_*` 输入，renderer 不继承 token、origin、mapping、Bearer metadata、raw gRPC client 或方法名。

STRM resolver settings 由 `enhanced/strm-config-store.js` 持久化 schema version 1 配置和 main-process-only secret 文件；`enhanced/strm-config-ipc.js` 只向当前 BrowserWindow 返回脱敏配置。`libmpv.getRoutes()` 注册 `mpvplayer/strm.html`，页面保存规则后提示重启生效。规则使用最长前缀匹配，支持 `cloud-first`、`mount-first` 和可校验的 `custom` order；AUTO discovery 只能更新 AUTO，USER 与 DISABLED tombstone 受到保护。

播放器只通过 `loadfile <url> replace -1 user-agent=<value>` 传入已验证的 file-local User-Agent；不修改全局 `user-agent` 或 `http-header-fields`。`additionalHeaders` 当前不进入播放器。完整 contract 见 `CD2_DIRECT_URL.md`。

异步播放使用 PlaybackManager request id 与 libmpv monotonic generation 双层保护。新 Play、terminal `PlaybackManager.stop()`、NextTrack、libmpv Stop 和 destroy 会使旧请求失效；新 Play 内部为换项执行的 previous-player stop 不额外失效新请求。active unary call 会被取消，每个异步阶段、`currentSrc` 修改和最终 `loadfile` 前均检查 generation。连接准备最多 200ms，Find 最多 350ms，download URL 最多 300ms，并共享 750ms absolute budget。任何非 Abort transport reject、timeout、RPC、mapping 或 response validation 失败都继续 Mount → native；Abort 和 superseded 向上终止，late response 不能加载旧 source 或触发旧 PlaybackManager error recovery。

`vendor/` 保留已校验的输入说明与文件清单，解包 runtime 不进版本控制；`src/electronapp/` 是可维护应用层；`tools/` 负责本地构建与验证；`installer/` 只负责安装。`src/electronapp/preload.js` 是由 `tools/prepare-preload.cjs` 从 `vendor/carnival/electronapp/preload.js` 生成的 prepared workspace artifact，不是开发机 source；runtime provenance 单独校验 base、generator、prepared 和 runtime hash。该生成 block 只提供非阻塞 diagnostics/sticky observation，不改变 Pepper 创建、播放、停止或 Session 生命周期。继续保留 vendor 目录布局以免破坏相对加载路径。

正式安装入口直接启动 `{app}\Emby.Theater.exe`。Electron main process 在创建窗口前执行幂等 bootstrap，按 `{runtime}\config\system.xml` 作为 seed，只补齐 Enhanced profile 的 `config`、`cec-driver`、缺失 `system.xml` 和 `cancel`，不覆盖用户文件、不改变 `ProgramDataPath`，也不启动外部进程。
