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
39. 当前 exact Pepper/mpv 0.41 已实测 `loadfile <url> replace -1 user-agent=<value>` 的 per-file 恢复语义：UA-A → UA-B → same-origin C 无泄漏。这个结论只覆盖严格校验的 User-Agent，不自动扩展到 `http-header-fields` 或任意 additionalHeaders。
40. DirectUrl acquisition 可以复用同一次 `get_direct_url=true` 响应里的 `downloadUrlPath`，但 transport timeout 仍可能需要第二次 same-origin RPC；两者必须共享一个 absolute budget，并为 fallback 保留实际时间，不能串联两个完整 timeout。
41. 真实 DirectUrl 在独立 embedded libmpv 中推进不等于完整 Emby 验收。若 PlaybackManager 在 resolver 日志出现前超时，应把 source acquisition/libmpv 与 Session/WebSocket/controls/reports 分层报告，不能把 PR #2 的 same-origin 全链证据迁移为 PR #4 通过。
42. blocker 修复后不能仅按 runtime 目录名复用旧 frozen 产物；关键 `src/` 文件必须与 verification runtime 做逐文件 hash 校验，确保测试确实覆盖最新预算和 UA fail-closed 逻辑。
43. Acceptance runner 必须保存自己启动的 exact root PID，并用该 PID 的 process tree 做超时清理；进程名快照和全局 `Stop-Process` 会把 ownership 证明与用户已有进程混在一起。无论 harness 是否启动，都要先落 stdout/stderr 和 machine-readable runner report，再解释 acceptance report 是否存在。
44. Readiness observer 只应记录产品事实；`enhancedDiagnostics(..., 'ready')` 才是 Pepper authoritative-ready，native bootstrap ready 只能作为独立观察项。模块解析、阶段超时和成功判定应留在 live acceptance flow，不能在 observer 中复制事件总线或 gate state machine。
45. 真实 acceptance 在 inspect/module 前置阶段阻塞时，只能报告前置阻塞和缺失 gates；runner 已完成或旧分层 media 证据不能替代本次完整 PlaybackManager/Session/controls/reports 验收。单次 run 后遵守停止边界，不用第二次运行掩盖第一次证据。
46. frozen Alameda app startup 会把 `ConnectionManager`、`ApiClient`、`Events` 暴露到 window，而 `playbackManager` 仍应按 canonical module id 单独取得；acceptance flow 应先有界等待 global，再只做一次已确认模块的 require，并分别记录 API client、PlaybackManager 与 Events 的 source/result。三模块 batch callback 不能作为可靠 readiness 证明。
47. acceptance 必须把 runtime provenance 纳入 gate：旧 dist runtime 可能成功创建播放器并完成 native `loadfile`，但没有当前 resolver 代码，不能把 resolver marker missing 归因于产品 flow。resolver 完成日志不能命名为 resolver-enter；embed `postMessage` 覆盖失败时，loadfile 必须标为 observability gap，不能用 manager-play-resolved 替代。
48. acceptance runtime 必须在启动前绑定 source commit、关键文件 hash、resolver directory 和 `resolveAsync` marker；resolver 完成日志应使用 result/decision 语义，loadfile outgoing source 不可观察时应为 unavailable 并从硬 gate 排除。current-main runtime 的 `resolver-result` 通过后，才能把主链结论与 loadfile 观测缺口分开记录。
49. current-main acceptance 只有在 runtime provenance 通过后才具有产品 flow 解释力；`resolver-result` 与 `manager-play-resolved` 均通过且 loadfile unavailable 时，可将主链记为成功，同时保留 loadfile observability gap，不把它升级为产品 regression。
50. acceptance report 的 `completed=true` 与 terminal classification 才能触发 runner 收尾；成功和明确失败都应 `timedOut=false`、`runnerResult=completed`，只有缺少终态报告才进入 deadline timeout。taskkill 后的 child exit code 不能覆盖已确认的 terminal success，owned process residual 才是清理结果的关键证据。
51. runtime provenance 不能只校验少量 sentinel；构建验收应覆盖全部 repo-owned `src/electronapp` 文件和启动 wrapper，并把构建时改写的 package metadata、PlaybackManager overlay 与 vendor/node_modules/Electron/native payload 分开建模。终态收尾还必须在 exact root PID kill 前重新核对 CreationDate；PID 缺失按已退出处理，CreationDate 不同只记录 ownership mismatch，绝不按进程名扩大清理范围。
52. `embed-created` 若来自 acceptance DOM observer，只能命名为 creation observation，不能冒充产品 `createElement()` 调用；要拆分 PlaybackManager 前置等待，必须单独定义边界信号。
53. 当前 Pepper `ready` message 先由产品 embed listener 处理，再同步触发 window `ready` 和 authoritative diagnostics；acceptance listener 后注册时可能出现毫秒级负差值，这属于 listener 顺序与 Date.now 取整，不是真实负耗时。
54. 三次同 commit/runtime 的 readiness 样本如果 `embed→authoritative ready` 稳定而 `play→embed` 波动，应先定位 embed 前置链，不能把长尾直接归因于 PPAPI、DLL 或 resolver。
55. terminal acceptance report 已持久化后 root 自然退出属于可验证收尾路径；runner 可只检查已建立 ownership 的 known descendants，并保持 creation-date 边界，不能把正常 root exit 误报成 harness failure。
56. 当前 Alameda acceptance loader 可能返回 Promise，且 `ConnectionManager.currentApiClient` 可能在 global 初始化后才出现；profile inspect 必须兼容 callback/Promise 和有界等待，失败只能输出安全枚举。
57. Pepper bridge 的行为回归必须模拟 attach 同步窗口内的 immediate ready；仅检查 `addEventListener` 与 `insertBefore` 的文本顺序不足以证明 callback 实际捕获事件。listener ordering 修复应保持 `{once:true}` 和现有 destroy/reuse 生命周期，并用一次有界真实 acceptance 做非性能性质的回归。
58. ignored required source 不能靠开发机残留维持：如果 `src/electronapp/preload.js` 是 vendor-derived 加项目诊断的 prepared artifact，应由 tracked generator 在 prepare/build 中生成，并由 test、runtime provenance 共用同一 contract；缺失时测试必须失败而不是 skip。
59. readiness 证据必须分层：embed raw `ready`、产品 diagnostics callback、sticky/current state、core-playing、视频 PositionTicks、Session NowPlaying 和已接受 report 各自记录；direct marker 缺失但完整播放事实存在时归为 class B observer-only-miss，不能写成 Pepper initialization failure，也不能 silent PASS。
60. run-scoped readiness state 需要 runId、时间边界和 bridge identity；旧 run 的 ready event 即使晚到也不能污染新 run。loadfile 或产品函数调用不可观测时保留 unavailable/observation wording，不用 manager resolved 替代未取得的信号。
