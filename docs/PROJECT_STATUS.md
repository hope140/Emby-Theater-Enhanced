# 项目状态

更新时间 2026-09-14（UTC+8）。**当前产品代码保持冻结。readiness harness baseline 已由 `3d1cc6d906131d2e7e1d0a10af5fd354b228a41d` 提交；本轮独立 follow-up 加固了 runtime provenance、终态单写入和 PID ownership 边界。历史 real acceptance artifact 已分开记录：旧 `readiness-main-20260914-070236533-48d1e60e` 是 acceptance success 但 runner 在旧生命周期下以 242507ms timeout 收尾；较新的 `terminal-real-20260914-073146032-27837240` 是 acceptance success、runnerResult=`completed`、timedOut=`false`、elapsed=`15959ms`、residual=0。两次均保持 `loadfile` unavailable observability gap，不作为 gate。**

## 接手摘要

- Baseline：用户提供的 Carnival 3.0（应用 3.0.20-3.0）+ 综合补丁最终 ZIP。
- Enhanced：0.1.1 开发候选；Windows host 文件版本保持 3.0.20.0，Electron 应用构建版本为 0.1.1。
- Git：本地 Git baseline 完成；`main` 与 `origin/main` 的产品基线为 `c880b97757be422ae818fe30b3a335003e41227b`，当前工作分支为 `fix/acceptance-readiness`。readiness harness baseline 与本轮 follow-up 均为独立提交，尚未推送或创建 PR；未知来源的完整 Web snapshot、vendor 输入、二进制与构建产物均排除。
- 源码：`src/electronapp`；原件在根目录，解包输入在 `vendor/carnival` 与 `vendor/patch`。
- 交付：`dist/EmbyTheaterEnhanced-0.1.1-final-win-x64/Start-Enhanced.cmd`；`dist/EmbyTheaterEnhanced-0.1.1-win-x64-setup.exe`。旧 0.1.0 产物保留。
- 工具：`tools/prepare.ps1`、`build.ps1`、`package.ps1`、`test-runtime.ps1`、`test-host.ps1`、`tests/readiness-acceptance.ps1`。

## 验收状态

| 项目 | 状态 |
|---|---|
| 工程目录和知识库 | 完成；公开 Git baseline 已推送，Mount Resolver 已合并到 `main` |
| Carnival 分类与 vendor 清单 | 完成；E 类 815 文件精确上游来源未确认 |
| 可重复 runtime 构建 | 通过；merge review final/repeat 各 2156 个 manifest 载荷，逐文件 SHA256 0 差异 |
| 原 Windows host 启动 | 测试副本通过；host+4 Electron 进程、诊断日志 |
| Electron UI 与播放器注册 | 通过，已视觉查看；无 externalplayer |
| Inno 安装包 | PR #2 隔离编译/解包通过，2157 个 `{app}` 文件与 runtime 逐哈希一致；本轮未执行系统安装 |
| 合成媒体内嵌 libmpv | 可见测试通过播放推进/暂停/seek/恢复/stop |
| 原生普通媒体 / STRM | 真实 STRM 两集通过，走原生 DirectStream；普通文件仅本地/模拟验证，库内无样本 |
| Session / Remote Control | 非管理员账号下，真实服务器接受命令、WebSocket 送达、播放器响应及服务端状态回读全部通过 |
| WatchTogether | 按用户确认的后台控制正常口径通过；未宣称插件双客户端同步精度已测试 |
| STRM Mount Resolver | 已实现 Detection、Mount → Native contract、确定性优先级、媒体扩展 allowlist、Transcode protection 和安全诊断；POSIX source candidate 只进入 CD2，不进入 Windows Mount；43/43 与隔离 runtime 通过；真实 native fallback 通过 |
| CloudDrive2 Resolver PR #2 | merge blocker 已修正；43/43、fake/frozen、Stop-before-player、reject fallback、POSIX mapping、真实 CD2 media core-playing 通过；两个真实 Emby POSIX STRM 样本均 `cd2_hit`，完整控制链与报告通过 |
| CloudDrive2 DirectUrl PR #4 | 56/56；file-local UA/no-leak、unsafe header/UA fallback、expiry reacquire、Abort/timeout/shared budget、fake frozen 完整链既有证据通过；重建 runtime 的 DirectUrl 请求与 UA isolation 通过，真实 DirectUrl + returned UA 的既有 embedded libmpv 分层证据有效；完整实服 PlaybackManager 仍受 resolver 前 timeout 阻塞 |
| Acceptance readiness harness | full runtime provenance 覆盖 818 个 `src/electronapp` 文件与 2 个 Start wrapper，package/PlaybackManager overlay 单独校验；terminal success/failure/timeout、terminal race、PID mismatch synthetic 均通过；历史较新 real artifact 已贯通至 resolver-result，runnerResult=completed/timedOut=false/residual=0，loadfile 保持 unavailable observability gap |
| External Player | 已禁用入口并测试；保留旧实现 |
| 环境诊断 | 实际 Electron/Chrome/Node、DLL API/version、ready/playing 已取得 |
| mpv.conf / GPU / HDR | 配置规则/隔离通过；真实样本 gpu-next、d3d11va 硬解及缓存 3221225472 字节已取得；HDR/画质效果不是本次样本覆盖范围 |

## 已确认环境

Electron **18.3.15**；Chromium **100.0.4896.160**；Node **16.13.2**；mpv **v0.41.0-920-gdd5d17d32**；libmpv client API **2.5**。package.json 中旧 Electron 依赖声明不代表实际版本。

## 已知问题与限制

1. 缓存负数根因已关闭：native 设置正确，bridge int32 回传截断；0.1.1 精确文本诊断已修复。未测实际内存占用峰值，不将配置值等同于内存分配量。
2. APPDATA 隔离问题已关闭：原生默认搜索 Windows Known Folder，测试改用 MPV_HOME 并验证配置标记。正式用户配置未修改。
3. 隐藏窗口媒体测试超时；原始并行 UI/host 测试也出现一次启动超时，后续串行通过。媒体测试使用可见窗口并顺序执行。内存 API fixture 只证明客户端逻辑，不具有真实服务器 Session/网络的证明力。
4. 815 个 E 类文件的精确官方来源，以及 Carnival EXE/bridge 的精确可复现构建来源仍不明；它们不在首次公开提交中。
5. 实际安装使用用户授权的独立 E 盘目录且当前进程已提权；安装/覆盖/启动/卸载均通过，但未展示 UAC 交互，也没有单独验证 Program Files ACL。尚未正式发布。
6. Mount Resolver 已完成静态、单元和隔离 runtime 验证；绝对 POSIX source candidate 在 Windows 上不会进入 `existsSync` Mount；真实 Emby native fallback 与控制链通过，但当前样本没有自然 Mount 命中；不同编码、字幕/音轨差异和长时间稳定性尚未验证。
7. CloudDrive2 PR #2 已完成 main-process 纯 JS gRPC、单条 Windows/UNC/POSIX mapping、750ms 总预算及 generation/late-response 防护。真实临时 mapping 命中，same-origin HEAD 200 / Range 206；有限候选中的普通 MKV 已实际 `core-playing` 并推进。Pepper bridge 不直接暴露 start-file/file-loaded/end-file/log-message；path 可直接观察，file-loaded 由 MKV format 与 13-track list 推断，未观察到 EOF/error。
8. 当前配置仅通过环境变量或 ignored local config 注入，不含设置 UI/credential storage。真实验收使用的 mapping 只存在于 ignored local acceptance 配置，未进入源码、文档或 Git。DirectUrl、User-Agent/additionalHeaders、expiresIn recovery、refresh/retry、多 mapping、provider 特判和 CD2 cache 管理均不在 PR #2。
9. PR #4 只支持受限 file-local User-Agent；`additionalHeaders` 任意非空即回退 same-origin。Pepper 不暴露可靠 HTTP 403/end-file error 分类，因此只实现 known-expiry 的一次 bounded reacquire，不声称运行中 403 自动恢复。既有真实 DirectUrl 分层 smoke 通过；本轮重建 runtime 的 DirectUrl fixture 在首个 source 请求后于 UI 切换阶段 timeout，真实 DirectSmoke 在 resolver 阶段 timeout，均未取得新的完整 Session/WebSocket/controls/reports 证据。
10. Acceptance runner 已改为单次 owned root PID 的 bounded runner：terminal report 出现后等待短 flush window 并只对该 root process tree 执行 `taskkill /PID ... /T /F`，无 terminal report 才使用 deadline timeout，最终始终写入 `runner-result.json`、stdout 和 stderr；success/failure/timeout、terminal race、`inspectProfile` integration race 与 PID CreationDate mismatch synthetic 均通过。CIM unavailable 会 fail closed 为 `cleanupStatus=unverified`、`ownershipVerified=false`、residual 未知，不报告完整 success，也不 kill 不确定 PID。后续 follow-up 的 full provenance manifest 覆盖全部 repo-owned `src/electronapp` 文件，并将 package metadata 与 PlaybackManager 作为显式 build overlay；vendor baseline、node_modules production closure、Electron runtime binaries 与 native mpv 均独立排除。历史较新的 real artifact 中 `inspect`/`select`/`play-called`/`resolver-result`/`manager-play-resolved` 通过，`loadfileObservation=unavailable`；runner 总耗时 15959ms、runnerResult=completed、timedOut=false、residual owned processes=0。

## 当前阻塞项与下一步

用户已登录非管理员账号，明确允许选择任意影视测试，并确认全库为 STRM、WatchTogether 以后台控制正常为准。2026-09-14 persistent profile inspect 返回 `logged-in`。两个不同 POSIX STRM 样本在同一条本地 ignored source-side mapping 下均由 resolver 返回 `cd2_hit`、source kind 为 `cd2-url`；真实 embedded libmpv 播放推进，Play/Pause/Seek/Resume/NextTrack/Stop 全部通过，Session/WebSocket 回读正常，10 条播放报告全部被服务器接受，停止后 NowPlayingItem 清空。测试会留下样本正常观看进度，未额外重置用户数据。

本轮复核 `mount-resolver.js` 的 POSIX 分支并补充回归：absolute POSIX candidate 仍交给 CD2，CD2 miss 后不调用 Windows `existsSync`；UNC source 仍可命中 Mount。persistent inspect 工具只返回 `{loggedIn,reason}` 安全枚举；通过两个样本的只读 mapLocalPath/CD2 验证后，仅在 ignored acceptance 配置中注入 mapping，完成真实 CD2 控制链。没有修改服务器配置、媒体库、权限、账号、CD2 mount/cache 或网盘数据。许可证、公开范围与模型策略见 `docs/LICENSING.md` 和 `docs/AI_MODEL_POLICY.md`。

历史 PR #4 收尾验证已完成：当时源码 `npm test` 为 56/56，修改/新增 JS 与 PowerShell 语法检查、`git diff --check` 均通过；按源码重建的 verification runtime 关键文件与 `src/` 一致，frozen transport、file-local UA/no-leak 和 Stop-before-player 通过。该历史记录中的 resolver-entry blocker 不代表当前 readiness harness 的终态状态；真实 acceptance 证据仍按各 run 分层保留。

较早的 acceptance-readiness follow-up：`tests/live-acceptance-browser.js` 改为 global API/Events + 单次 canonical PlaybackManager acquisition，并在报告中分开记录 source/result；runner 增加 runtime validation、terminal report detection，gate 更名为 `resolver-result`，loadfile 降级为 unavailable。observer、产品代码未做 instrumentation；相关 real artifact 已通过 resolver-result，后续 terminal lifecycle 与 provenance 边界在本分支独立加固。

PR #2 新增 `cd2-resolver.js` 与 main-process `cd2-service.js`/`cd2-ipc.js`，通过 build-time overlay 给未公开 PlaybackManager 增加 request id，libmpv 使用 monotonic generation、AbortController 和 gRPC cancel。43/43 Node tests 通过；独立 frozen Stop-before-player 断言旧请求未调用 `player.play`、未产生 Playing report。完整 frozen Electron 中 dependency require、fake gRPC、CD2 hit、Mount/Native fallback、Play/Pause/Seek/Resume/NextTrack/Stop、报告、双 NextTrack、active cancel 与 0 active leak 通过。真实 CD2 media 通过；两个真实 Emby POSIX STRM 样本均 `cd2_hit`，embedded libmpv/core-playing、Session/WebSocket/controls/reports 全部通过。未修改 CD2 配置、mount、cache、账号或网盘数据。

## 推荐继续入口

- `docs/TESTING.md`：验证命令和真实测试卡。
- `docs/LIBMPV_RUNTIME.md`：缓存负数、配置来源与 GPU 属性。
- `src/electronapp/plugins/libmpv.js`：self.play、playInternal、message、getProperty。
- `src/electronapp/resolvers/strm-resolver.js` / `mount-resolver.js`：STRM 判定、路径推导、native fallback。
- `src/electronapp/resolvers/cd2-resolver.js`：renderer 窄 IPC adapter。
- `src/electronapp/enhanced/cd2-service.js` / `cd2-ipc.js`：main-process transport、mapping、deadline、校验与 cancel。
- `docs/CD2_RESEARCH.md`：ETLP beta 调研、115 DirectUrl 真实验证、Sol High 架构结论、V1 范围、风险和测试方案。
- `src/electronapp/www/modules/common/playback/playbackmanager.js`：getPlaybackInfo、createStreamInfo、setSrcIntoPlayer、onPlaybackStarted。
- `src/electronapp/www/modules/common/input/api.js`：WebSocket 消息分派。
- `docs/DEVELOPMENT_LOG.md` / `docs/evidence/first-round-followup.json`：本次执行记录与可携带证据摘要；first-round.json 保留初次结果。
- `docs/LIVE_ACCEPTANCE.md`：已脱敏的真实服务器验收、用户确认口径及范围限制；原始细节证据仅保留在本地忽略目录。
