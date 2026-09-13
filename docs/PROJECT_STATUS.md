# 项目状态

更新时间 2026-09-13（UTC+8）。**第一轮真实 STRM、Session、后台控制链已通过；`main` 包含 `6888780` 的 CloudDrive2 架构评审基线，当前 `feat/cd2-resolver` 已完成 PR #2 候选实现与自动/隔离验证。V1 链为 `CD2 same-origin HTTP → Mount → Native`，Transcode 永远 Native；DirectUrl 延后。真实 CD2 RPC、HEAD/Range 与最终 source replacement 已确认，但真实 CD2 media 在隔离 libmpv 中 45 秒未进入 `core-playing`，因此真实 Enhanced + CD2 播放、真实 Emby Session/控制仍待验收。**

## 接手摘要

- Baseline：用户提供的 Carnival 3.0（应用 3.0.20-3.0）+ 综合补丁最终 ZIP。
- Enhanced：0.1.1 开发候选；Windows host 文件版本保持 3.0.20.0，Electron 应用构建版本为 0.1.1。
- Git：本地 Git baseline 完成（`main` / `v0.1.1-baseline`）；架构文档提交 `6888780` 已推送 `origin/main`。当前工作分支为 `feat/cd2-resolver`，作为 PR #2 审核候选；未创建 Release。未知来源的完整 Web snapshot、vendor 输入、二进制与构建产物均排除。
- 源码：`src/electronapp`；原件在根目录，解包输入在 `vendor/carnival` 与 `vendor/patch`。
- 交付：`dist/EmbyTheaterEnhanced-0.1.1-final-win-x64/Start-Enhanced.cmd`；`dist/EmbyTheaterEnhanced-0.1.1-win-x64-setup.exe`。旧 0.1.0 产物保留。
- 工具：`tools/prepare.ps1`、`build.ps1`、`package.ps1`、`test-runtime.ps1`、`test-host.ps1`。

## 验收状态

| 项目 | 状态 |
|---|---|
| 工程目录和知识库 | 完成；公开 Git baseline 已推送，Mount Resolver 已合并到 `main` |
| Carnival 分类与 vendor 清单 | 完成；E 类 815 文件精确上游来源未确认 |
| 可重复 runtime 构建 | 通过；PR #2 最终 `pr2-k/l` 各 2156 个 manifest 载荷，逐文件 SHA256 0 差异 |
| 原 Windows host 启动 | 测试副本通过；host+4 Electron 进程、诊断日志 |
| Electron UI 与播放器注册 | 通过，已视觉查看；无 externalplayer |
| Inno 安装包 | PR #2 隔离编译/解包通过，2157 个 `{app}` 文件与 runtime 逐哈希一致；本轮未执行系统安装 |
| 合成媒体内嵌 libmpv | 可见测试通过播放推进/暂停/seek/恢复/stop |
| 原生普通媒体 / STRM | 真实 STRM 两集通过，走原生 DirectStream；普通文件仅本地/模拟验证，库内无样本 |
| Session / Remote Control | 非管理员账号下，真实服务器接受命令、WebSocket 送达、播放器响应及服务端状态回读全部通过 |
| WatchTogether | 按用户确认的后台控制正常口径通过；未宣称插件双客户端同步精度已测试 |
| STRM Mount Resolver | 已实现 Detection、Mount → Native contract、确定性优先级、媒体扩展 allowlist、Transcode protection 和安全诊断；Node 19/19、隔离 runtime 命中通过；真实 native fallback 通过，real Emby Mount hit pending |
| CloudDrive2 Resolver PR #2 | 候选实现完成；main-process grpc-js、窄 IPC、单条 mapping、750ms absolute budget、generation/cancel、CD2 → Mount → Native 和 Transcode protection 已通过 unit/fake/frozen runtime；真实 CD2 source 可解析但真实 media 起播待关闭 |
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
6. Mount Resolver 已完成静态、单元和隔离 runtime 验证；真实 Emby smoke 的 native fallback 与控制链通过，但当前路径条件没有自然 Mount 命中，real Emby Mount hit pending；不同编码、字幕/音轨差异和长时间稳定性尚未验证。
7. CloudDrive2 PR #2 已完成 main-process 纯 JS gRPC、单条 mapping、750ms 总预算及 generation/late-response 防护。真实临时 mapping 命中，same-origin HEAD 200 / Range 206；隔离播放器 `currentSrc` 已确认切到 CD2 origin，但选定真实媒体在 45 秒内未产生 `core-playing`。这不能记为真实 Enhanced 播放通过，也不能替代真实 Emby Session、WebSocket、报告和控制验收。
8. 当前配置仅通过环境变量或 ignored local config 注入，不含设置 UI/credential storage。DirectUrl、User-Agent/additionalHeaders、expiresIn recovery、refresh/retry、多 mapping、provider 特判和 CD2 cache 管理均不在 PR #2。

## 当前阻塞项与下一步

用户已登录非管理员账号，明确允许选择任意影视测试，并确认全库为 STRM、WatchTogether 以后台控制正常为准。两个不同 STRM 样本的真实 DirectStream 播放、进度、Pause/Seek/Unpause/NextTrack/Stop 全部通过。每个样本的 Item/MediaSource/PlaySession 关联一致，停止报告均被服务器接受；画面已实际检查。测试会留下样本正常观看进度，未额外重置用户数据。

本轮新增 `src/electronapp/resolvers/strm-resolver.js` 与 `mount-resolver.js`，在 `libmpv.playInternal` 的最终 `loadfile` 前执行 source replacement；PlaybackManager、Session、PlaySessionId、MediaSource、字幕/音轨索引和 offset 流程未改写。隔离 fixture 的普通媒体、无 Mount STRM fallback、Mount 命中、Pause/Seek/Unpause/Stop/NextTrack 和 20 条模拟上报均通过。真实 Emby smoke 选取 2 个 STRM 样本，当前 `MediaSource.Path` 为不可解析的 other 形态，实际 DirectStream 保持 URL native source；全控制链和 10 条报告通过，real Emby Mount hit pending。没有修改服务器配置或测试数据。许可证、公开范围与模型策略见 `docs/LICENSING.md` 和 `docs/AI_MODEL_POLICY.md`。

PR #2 新增 `cd2-resolver.js` 与 main-process `cd2-service.js`/`cd2-ipc.js`，通过 build-time overlay 给未公开 PlaybackManager 增加 request id，libmpv 使用 monotonic generation、AbortController 和 gRPC cancel。33/33 Node tests 通过；frozen Electron 中 dependency require、fake gRPC、CD2 hit、Mount/Native fallback、Play/Pause/Seek/Unpause/NextTrack/Stop、19 条报告、双 NextTrack、3 次 active cancel 与 0 active leak 通过。真实 CD2 仅执行只读 RPC/HEAD/Range；未修改 CD2、Emby、服务器、mount、cache、账号或网盘数据。

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
