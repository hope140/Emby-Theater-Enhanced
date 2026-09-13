# 架构

基线为提供的 Carnival 3.0（应用声明 3.0.20-3.0）叠加综合补丁。保留 Windows .NET 启动壳、Electron、离线 Web UI 与内嵌 libmpv 的现有目录关系。

普通视频：Emby → PlaybackManager → 原生 MediaSource → libmpv 插件 → Pepper bridge → mpv-1.dll。Session、PlaySession、进度和远控仍由 Emby Web 生命周期负责。

STRM 增强：仅在确认 `Item.Path` 的 `.strm` 后缀或 `MediaSource.Container=strm` 时，在正常播放上下文内尝试 Mount；当前优先级为 Mount → native source，CD2 留待后续阶段。Resolver 位于 `libmpv.js` 的 `playInternal(options)`，只替换最终交给 `loadfile` 的 source。`sidecarPath=Item.Path`、`sourcePath=MediaSource.Path`、`nativeSource=options.url`，三者不可互换；PlaybackManager、Item、MediaSource、PlaySession、WebSocket 和远控生命周期保持原链路。

`src/electronapp/resolvers/strm-resolver.js` 负责 STRM 判定、播放方式保护与 fallback，`mount-resolver.js` 负责确定性本地路径推导和 `existsSync` 检查。只有本地文件真实存在时才返回 `type: 'local'`；缺字段、解析异常、路径不存在和 Transcode 均返回原始 native source。

`vendor/` 保留已校验的输入说明与文件清单，解包 runtime 不进版本控制；`src/electronapp/` 是可维护应用层；`tools/` 负责本地构建与验证；`installer/` 只负责安装。继续保留 vendor 目录布局以免破坏相对加载路径。
