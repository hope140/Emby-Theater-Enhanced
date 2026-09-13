# 架构

基线为提供的 Carnival 3.0（应用声明 3.0.20-3.0）叠加综合补丁。保留 Windows .NET 启动壳、Electron、离线 Web UI 与内嵌 libmpv 的现有目录关系。

普通视频：Emby → PlaybackManager → 原生 MediaSource → libmpv 插件 → Pepper bridge → mpv-1.dll。Session、PlaySession、进度和远控仍由 Emby Web 生命周期负责。

未来 STRM：仅在确认 Item.Path 的 .strm 后缀或 MediaSource.Container=strm 时，在正常播放上下文内依次尝试 CD2、Mount、原生 source。sidecarPath=Item.Path；sourcePath=MediaSource.Path，二者不可互换。第一轮只审计插入位置。

`vendor/` 保留已校验的输入说明与文件清单，解包 runtime 不进版本控制；`src/electronapp/` 是可维护应用层；`tools/` 负责本地构建与验证；`installer/` 只负责安装。继续保留 vendor 目录布局以免破坏相对加载路径。
