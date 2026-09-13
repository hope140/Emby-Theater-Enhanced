# 项目状态

更新时间 2026-09-13（UTC+8）。**第一轮真实 STRM、Session、后台控制链已通过；`main` 当前包含 `7670d42` 的 STRM Mount Resolver 合并基线。CloudDrive2 Resolver 的前置调研与 Sol High 架构评审均已完成并记录在 `docs/CD2_RESEARCH.md`；V1 建议先使用 CD2 same-origin HTTP，DirectUrl 延后验证。本轮没有修改产品源码、没有接入 CD2 播放；真实 Emby 服务器上的 Mount 命中仍待实机验收，当前真实播放证据仍以 `docs/LIVE_ACCEPTANCE.md` 为唯一真相。**

## 接手摘要

- Baseline：用户提供的 Carnival 3.0（应用 3.0.20-3.0）+ 综合补丁最终 ZIP。
- Enhanced：0.1.1 开发候选；Windows host 文件版本保持 3.0.20.0，Electron 应用构建版本为 0.1.1。
- Git：本地 Git baseline 完成（`main` / `v0.1.1-baseline`）；首次公开审核清理已完成并同步到 GitHub `origin/main` 与同名标签；未创建 Release。当前工作分支为 `main`，本轮基线合并提交为 `7670d42`；本轮仅更新调研/状态文档，未创建功能分支、PR 或产品源码改动。未知来源的完整 Web snapshot、vendor 输入、二进制与构建产物均排除。
- 源码：`src/electronapp`；原件在根目录，解包输入在 `vendor/carnival` 与 `vendor/patch`。
- 交付：`dist/EmbyTheaterEnhanced-0.1.1-final-win-x64/Start-Enhanced.cmd`；`dist/EmbyTheaterEnhanced-0.1.1-win-x64-setup.exe`。旧 0.1.0 产物保留。
- 工具：`tools/prepare.ps1`、`build.ps1`、`package.ps1`、`test-runtime.ps1`、`test-host.ps1`。

## 验收状态

| 项目 | 状态 |
|---|---|
| 工程目录和知识库 | 完成；公开 Git baseline 已推送，Mount Resolver 已合并到 `main` |
| Carnival 分类与 vendor 清单 | 完成；E 类 815 文件精确上游来源未确认 |
| 可重复 runtime 构建 | 通过，重复输出 1013 文件 SHA256 一致 |
| 原 Windows host 启动 | 测试副本通过；host+4 Electron 进程、诊断日志 |
| Electron UI 与播放器注册 | 通过，已视觉查看；无 externalplayer |
| Inno 安装包 | 编译/解包哈希通过；授权独立目录安装 0.1.0→覆盖 0.1.1、快捷方式启动和卸载全部通过 |
| 合成媒体内嵌 libmpv | 可见测试通过播放推进/暂停/seek/恢复/stop |
| 原生普通媒体 / STRM | 真实 STRM 两集通过，走原生 DirectStream；普通文件仅本地/模拟验证，库内无样本 |
| Session / Remote Control | 非管理员账号下，真实服务器接受命令、WebSocket 送达、播放器响应及服务端状态回读全部通过 |
| WatchTogether | 按用户确认的后台控制正常口径通过；未宣称插件双客户端同步精度已测试 |
| STRM Mount Resolver | 已实现 Detection、Mount → Native contract、确定性优先级、媒体扩展 allowlist、Transcode protection 和安全诊断；Node 19/19、隔离 runtime 命中通过；真实 native fallback 通过，real Emby Mount hit pending |
| CloudDrive2 Resolver 架构评审 | 完成；115 DirectUrl 为 Level B，需专用 User-Agent 且为分钟级临时 URL；V1 建议 `CD2 same-origin HTTP → Mount → Native`，gRPC 采用 main-process `@grpc/grpc-js`，本轮未实现产品代码 |
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
7. CloudDrive2 Sol High 评审已完成：当前 115 DirectUrl 需要专用 User-Agent，Range 可用但 URL 为分钟级；同源 CD2 HTTP 的 HEAD/Range 可用且无额外 header。V1 延后 DirectUrl 与 refresh，先实现 main-process 纯 JS gRPC、单条 mapping、750ms 总预算及 generation/late-response 防护。当前运行 ETLP 配置的一条 `path_map` 对上一轮样本没有命中，真实 Emby mapping 仍需实现前确认；本轮没有接入 CD2 播放。

## 当前阻塞项与下一步

用户已登录非管理员账号，明确允许选择任意影视测试，并确认全库为 STRM、WatchTogether 以后台控制正常为准。两个不同 STRM 样本的真实 DirectStream 播放、进度、Pause/Seek/Unpause/NextTrack/Stop 全部通过。每个样本的 Item/MediaSource/PlaySession 关联一致，停止报告均被服务器接受；画面已实际检查。测试会留下样本正常观看进度，未额外重置用户数据。

本轮新增 `src/electronapp/resolvers/strm-resolver.js` 与 `mount-resolver.js`，在 `libmpv.playInternal` 的最终 `loadfile` 前执行 source replacement；PlaybackManager、Session、PlaySessionId、MediaSource、字幕/音轨索引和 offset 流程未改写。隔离 fixture 的普通媒体、无 Mount STRM fallback、Mount 命中、Pause/Seek/Unpause/Stop/NextTrack 和 20 条模拟上报均通过。真实 Emby smoke 选取 2 个 STRM 样本，当前 `MediaSource.Path` 为不可解析的 other 形态，实际 DirectStream 保持 URL native source；全控制链和 10 条报告通过，real Emby Mount hit pending。没有修改服务器配置或测试数据。许可证、公开范围与模型策略见 `docs/LICENSING.md` 和 `docs/AI_MODEL_POLICY.md`。

## 推荐继续入口

- `docs/TESTING.md`：验证命令和真实测试卡。
- `docs/LIBMPV_RUNTIME.md`：缓存负数、配置来源与 GPU 属性。
- `src/electronapp/plugins/libmpv.js`：self.play、playInternal、message、getProperty。
- `src/electronapp/resolvers/strm-resolver.js` / `mount-resolver.js`：STRM 判定、路径推导、native fallback。
- `docs/CD2_RESEARCH.md`：ETLP beta 调研、115 DirectUrl 真实验证、Sol High 架构结论、V1 范围、风险和测试方案。
- `src/electronapp/www/modules/common/playback/playbackmanager.js`：getPlaybackInfo、createStreamInfo、setSrcIntoPlayer、onPlaybackStarted。
- `src/electronapp/www/modules/common/input/api.js`：WebSocket 消息分派。
- `docs/DEVELOPMENT_LOG.md` / `docs/evidence/first-round-followup.json`：本次执行记录与可携带证据摘要；first-round.json 保留初次结果。
- `docs/LIVE_ACCEPTANCE.md`：已脱敏的真实服务器验收、用户确认口径及范围限制；原始细节证据仅保留在本地忽略目录。
