# 架构

基线为提供的 Carnival 3.0（应用声明 3.0.20-3.0）叠加综合补丁。保留 Windows .NET 启动壳、Electron、离线 Web UI 与内嵌 libmpv 的现有目录关系。

普通视频：Emby → PlaybackManager → 原生 MediaSource → libmpv 插件 → Pepper bridge → mpv-1.dll。Session、PlaySession、进度和远控仍由 Emby Web 生命周期负责。

STRM 增强：仅在确认 `Item.Path` 的 `.strm` 后缀或 `MediaSource.Container=strm` 时，在正常播放上下文内按 CloudDrive2 same-origin HTTP → Mount → native source 解析。Resolver 位于 `libmpv.js` 的 `playInternal(options)`，只替换最终交给 `loadfile` 的 source。`sidecarPath=Item.Path`、`sourcePath=MediaSource.Path`、`nativeSource=options.url`，三者不可互换；PlaybackManager、Item、MediaSource、PlaySession、WebSocket 和远控生命周期保持原链路。Transcode 永远使用 native source。

`src/electronapp/resolvers/strm-resolver.js` 负责 STRM 判定、异步 source 编排、播放方式保护与 fallback；`mount-resolver.js` 生成确定性本地候选并执行 `existsSync`；`cd2-resolver.js` 只通过窄 IPC 请求 source。Electron main process 的 `enhanced/cd2-service.js` 持有 token、proto、grpc channel 与 active calls，使用一条 Windows local prefix → POSIX cloud prefix mapping，依次调用 `FindFileByPath` 和 `GetDownloadUrlPath(get_direct_url=false)`，只接受 CD2 same-origin HTTP(S) URL。main 同步读取并预加载后立即删除 `process.env` 中的全部 `ETE_CD2_*` 输入，renderer 不继承 token、origin、mapping、Bearer metadata、raw gRPC client 或方法名。

异步播放使用 PlaybackManager request id 与 libmpv monotonic generation 双层保护。新 Play、NextTrack、Stop 和 destroy 会使旧 generation 失效并取消 active unary call；每个异步阶段、`currentSrc` 修改和最终 `loadfile` 前均检查 generation。连接准备最多 200ms，Find 最多 350ms，download URL 最多 300ms，并共享 750ms absolute budget。任何 timeout、cancel、RPC、mapping 或 response validation 失败都继续 Mount → native，late response 不能加载旧 source 或触发旧 PlaybackManager error recovery。

`vendor/` 保留已校验的输入说明与文件清单，解包 runtime 不进版本控制；`src/electronapp/` 是可维护应用层；`tools/` 负责本地构建与验证；`installer/` 只负责安装。继续保留 vendor 目录布局以免破坏相对加载路径。
