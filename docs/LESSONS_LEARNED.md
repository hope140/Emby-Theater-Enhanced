# 已确认经验

1. 本地 SFX 可直接解包为 1009 个文件，未发现加密条目；无须逆向安装器。
2. `electronapp/package.json` 声明 Electron ^9.4.0，但本地 `x64/electron/electron.exe` 文件版本是 18.3.15。运行时版本需要实测，不可从开发依赖推断。
3. 原 `libmpv.js` 在播放时根据 appSettings 设置 hwdec、vo、demuxer-max-bytes 等；mpv.conf 中对应设置可能随后被覆盖。
4. 原桥接 getProperty 在无回复时不会结束；新增诊断必须有超时并移除监听器，不能阻塞播放。
5. Windows 自带 tar 不能解压本包所声明的字典大小；固定 node-unrar-js 2.0.2 解包成功。
6. 隐藏窗口的合成播放器测试未收到 ready；可见窗口能收到 ready/playing 并通过 5 项动作。测试没有画面时不能仅靠延长隐藏窗口等待宣称播放正常。
7. 未登录情况下直接调用已经注册到 PlaybackManager 的插件会触发需要服务器 API client 的回调。合成单元级播放测试应实例化独立插件；真实 Session 测试必须有服务器上下文。
8. Windows native mpv 通过 Known Folder 获取默认配置目录；只改 APPDATA 不会改变该路径。已验证子进程 MPV_HOME 能加载独立配置标记，正式用户配置不需要修改。
9. 900/2048/3072/4096/8192MiB 同 handle 实验确认 native 属性正确、bridge 的数值回传截断到 int32。0.1.1 使用 mpv 文本快照取得准确值，不能用负数加 2^32 的方法修正任意容量。
10. 本地 PlaybackManager fixture 需要提供完整 endpoint 能力；将 HTTP 源错误标为不受支持的 remote 会走 DirectStream 并请求错误的模拟 URL。修正 fixture 后 DirectPlay、消息分派与上报集成通过；未改变产品能力判断。
11. GitHub 上显示 GPL-2.0 的仓库及其 GPL v2 文本本身不足以证明 “or later”；只有明确的版权/许可通知才能扩大该授权。公开派生维护层应保守使用 GPL-2.0-only，并将来源未确认资产留在版本控制之外。
12. 播放与 Session 的当前验收状态必须集中以 `LIVE_ACCEPTANCE.md` 为准；静态审计文档只能描述其证据边界，不能保留与真实验收冲突的旧结论。
13. Alameda 为 `file://` 模块加载相对依赖时不会可靠地为带协议的模块 ID 补 `.js`；新增相对 AMD 依赖应显式写扩展名，并用隔离 runtime 验证实际插件注册。
14. renderer 侧现有安全边界只通过 preload 暴露 `window.fs`，Mount 检查应使用同步 `existsSync` 和有限路径规则，不应引入服务器请求、递归扫描或不确定映射。
15. `embedded.play` 收到的 `options.url` 必须继续是 PlaybackManager 形成的 native source；验证换源结果应检查插件的 `currentSrc` 或最终 `loadfile`，不能把原始播放上下文误当成已替换 source。
16. Electron runtime 夹具必须串行启动并单独核对进程；UI 启动超时、插件加载失败和实际媒体播放失败要分别记录，不能用其中一项替代另外两项证据。
17. Resolver 的规则优先级必须在每条规则完成候选生成后立即检查存在性；低优先级 URL 解析失败不能回溯覆盖已经命中的 sidecar 或本地 sourcePath。
18. 文件扩展名是播放安全边界的一部分；第一版应维护明确的音视频 allowlist，接受少量漏命中，避免把 `.txt`、`.nfo`、图片等文件交给播放器。
19. 真实 smoke 应把 sourcePath 形态、实际 PlayMethod 和最终 source 类型分开记录；当前服务器没有自然 Mount 映射时，必须明确记录 real Emby Mount hit pending，并把 native fallback 作为独立通过项。
20. 真实验收只需在隔离输出中保留脱敏的状态枚举和报告计数；服务器地址、账号、认证材料、媒体路径与 Item 标识不应进入仓库或公开 evidence。
21. ETLP beta 的 CloudDrive2 控制/文件查询使用 gRPC，HTTP 主要承载 CD2 下载 URL 和 ETLP 本地 gateway；不能把 HTTP 管理端口误认为已存在 REST 文件解析 API。
22. CloudDrive2 proto source version 与运行时 API version 可能错位；本机 proto 1.0.13 与 runtime 1.0.15 的基础只读 RPC 兼容，但实现前仍需固定版本和字段兼容策略。
23. ETLP 的 Windows 本地路径进入 CD2 查询前必须经过明确 `path_map`；配置存在不代表命中，local prefix 与实际挂载路径的 mapping hit 需要单独实测。
24. 本机 CD2 样本返回的同源 HTTP URL 自带 query 鉴权并支持 byte Range，但这不能推导所有 provider 都不需要 `User-Agent`、Cookie、Referer 或其他动态 headers。
25. 115 开启 Support Direct Link 后，真实 `get_direct_url=true` 响应会返回外部 HTTPS `directUrl`、专用 `userAgent` 和分钟级 `expiresIn`；裸 Range 为 403，携带该 User-Agent 才稳定为 206，因此不能把“有 directUrl”直接等同于可安全播放。
26. 当前 Pepper bridge 的 command 路径会把每个参数转为字符串后调用 `mpv_command`，不能传 `MPV_FORMAT_NODE_MAP`。mpv 0.41 的 `loadfile ... -1 <options>` 可以承载 file-local 选项并在文件结束后恢复，但任意 header 的字符串编码和 bridge 实机行为必须单独验收，不能改全局 User-Agent 后立即清理。
27. 同步 Mount Resolver 改成异步 CD2 lookup 后，deadline 只能限制资源占用，不能阻止 late response 覆盖新播放。PlaybackManager 请求、libmpv `loadfile`、NextTrack 与 Stop 必须共享 generation/request id，并在每个 await 后和最终 `loadfile` 前复核。
28. `@grpc/grpc-js` 可在当前 Electron 18.3.15 内置 Node 16.13.2 中以纯 JavaScript 完成带 Bearer metadata 和 deadline 的真实只读 RPC；`grpc-web` 使用不同 wire protocol，直连原生 CD2 gRPC 仍需要代理，不适合作为本项目 V1 transport。
29. grpc/proto 的首次同步 require 与 schema 解析可能接近 1 秒，JavaScript timer 无法抢占这段冷加载；CD2 enabled 时应在 main 启动阶段预加载 transport，让 750ms playback budget 只承担 readiness 与 RPC。
30. 仅在 libmpv 拒绝旧 generation 还不够：旧 PlaybackManager 请求可能在到达 `player.play` 前先停止新播放器。request id 必须在 PlaybackManager 的 preplay、bitrate、device profile、PlaybackInfo 和最终 player 调用边界复核。
31. CloudDrive2 drive-letter mount point 可能返回 `X:`；作为绝对 mapping root 使用时必须规范化为 `X:\`。`X:folder` 是当前盘符相对路径，应该继续拒绝。
32. 可见 frozen Electron media fixture 必须串行；并行运行会竞争 Pepper/GPU/窗口资源并产生无关超时。失败后先核对残留进程，再用相同参数串行复跑。
33. “CD2 URL 已成为 currentSrc”只证明 source replacement；没有 `core-playing`、控制和报告证据时，不能写成真实 Enhanced CD2 playback 通过。
34. terminal `PlaybackManager.stop()` 与新 Play 内部 `activePlayer.stop()` 语义不同；只在 terminal API 失效 request sequence，才能关闭 Stop-before-player.play 而不让换集流程自我取消。
35. CD2 transport Promise reject 必须转为 miss 后继续 Mount/Native；只有 Abort/superseded 可以跳过 fallback 并向上终止。
36. 空 cloudPrefix 与显式 `/` 必须区分：前者是缺配置，后者是合法 cloud-root mapping。
37. 真实 Emby 的 Item/MediaSource 路径可能是 absolute POSIX，即使客户端运行在 Windows。单条 mapping 需要按路径风格选择大小写规则，不能把 Windows 平台等同于 Windows source identity。
38. Pepper bridge 当前没有转发 mpv start-file/file-loaded/end-file/log-message；真实媒体验收可直接观察 path/core-playing/core-idle/time-pos，并以 file-format+track-list 推断 file-loaded，但必须标明证据性质。
