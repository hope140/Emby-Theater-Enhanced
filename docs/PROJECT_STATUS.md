# 项目状态

## 2026-09-15 — Direct app launch Daily-use Candidate 修复（待手工验收）

原 `4761a2440e9ab1df0b3c6d01765f26f9560d9bea` 候选记录为 `NON-BLOCKING FAIL — launcher UX`，原因是 `PowerShell wrapper caused visible console flash and startup delay`。本分支 `fix/direct-app-launch` 将正式入口改为直接启动 `Emby.Theater.exe`，并把原 `Start-Enhanced` 的目录创建与缺失文件 seed 迁入 Electron main-process bootstrap；保留 `ProgramDataPath` 和用户已有配置语义，不修改 PlaybackManager、STRM resolver、CD2、Mount、libmpv、Session、WebSocket 或播放策略。

安装器的开始菜单、桌面快捷方式和安装完成 Launch 均直接指向 `{app}\Emby.Theater.exe`；`tools/build.ps1` 不再复制 `Start-Enhanced.ps1/.cmd`，source tool 文件暂保留。候选 runtime 固定为 `dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch`，installer 固定为 `dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch-setup.exe`；最终 artifact 已绑定本分支最终 HEAD，provenance、package verify、Inno archive integrity 和逐文件 payload comparison 均通过。

当前自动验证：bootstrap/installer targeted 3/3，相关 targeted 合并检查 5/5，`npm test` 101/101，JavaScript syntax 68/68，PowerShell syntax 11/11，`git diff --check` 通过；最终 HEAD 的 source build、provenance、package verify、archive integrity、payload comparison 和 packaged bootstrap 隔离检查均通过。新候选尚未进行安装后的四入口手工验收，不能标记最终 PASS；原候选失败原因保留为历史验收记录。

## 2026-09-15 — Daily-use Candidate prepared from latest origin/main

完成首个 Daily-use Candidate 的验证与打包准备。fetch 后 `main` 快进到 `origin/main@4761a2440e9ab1df0b3c6d01765f26f9560d9bea`，快进前工作树干净，没有未预期 local patch。当前候选 runtime 为 `dist/EmbyTheaterEnhanced-0.1.1-daily-use-candidate-4761a24`，实际 2,124 文件；安装包为 `dist/EmbyTheaterEnhanced-0.1.1-daily-use-candidate-4761a24-setup.exe`，125,175,083 bytes，SHA256 `f3088aa87a5fd78f6395b926ccbbf6e16b67bb8085f648625a7949c2b3d5a72a`。旧 0.1.1 setup 未覆盖。

自动验证全部通过：STRM/settings targeted 21/21、全量 `npm test` 98/98、66 个 JS/CJS syntax、11 个 PowerShell syntax、`git diff --check`、source build、runtime provenance（785 product scope，3/3 overlay，1/1 prepared artifact）和 `tools/package.ps1 -VerifyOnly`（2,123 payload entries）。Inno archive integrity 通过，解包 `{app}` 2,124 文件与 runtime 逐文件 SHA256 一致，缺失/额外/mismatch 均为 0。按用户要求没有重跑历史 hidden Electron smoke；该证据仍为 `NOT COMPLETED — hidden Electron smoke timeout`。验收矩阵和手动清单见 [DAILY_USE_CANDIDATE](DAILY_USE_CANDIDATE.md)。

本轮不创建 PR、release 或 tag，不修改产品代码。当前候选可交给用户执行手动日常使用验收；真实 settings UI、真实 Mount、当前 HEAD 的真实完整播放链、音视频轨道切换和 endurance 仍按文档留待手动覆盖。

## 2026-09-15 — STRM resolver settings candidate

基于 `main@ca9ca9de58c37b8f5f3782dd1e45e9efc2071495` 创建独立 worktree/branch `feat/strm-resolver-settings`。本轮将 STRM / Mount / CloudDrive2 / DirectUrl resolver 配置产品化：新增 schema version 1 的 main-process persistent config store、独立 secret 文件、trusted config IPC、最长前缀规则、cloud-first/mount-first/custom strategy、AUTO/USER/DISABLED 生命周期和 `mpvplayer/strm.html` 设置入口。PlaybackManager、Session、PlaySessionId、WebSocket、播放报告和 embedded libmpv ownership 未修改。

配置保存后立即持久化，当前 CD2 service 不做 hot reload，页面提示重启后播放链生效。legacy `ETE_CD2_*` 只在首次 bootstrap 时迁移为 AUTO；其中 `ETE_CD2_ENABLED` 只迁移为 `cd2.enabled`，bootstrap 时 top-level `config.enabled` 始终保持 `true`，不会关闭整个 STRM resolver。persistent USER/AUTO/DISABLED 状态优先，renderer GET 只得到 `tokenConfigured`，不得到 token、Bearer metadata、raw gRPC client 或完整 DirectUrl。

本轮 legacy migration 修复后的最终 HEAD 静态与自动化验证：settings suite 21/21；全量 `npm test` 98/98；覆盖 `ETE_CD2_ENABLED=0` 时 global resolver 保持启用、CD2 disabled 后继续 Mount 命中，以及既有 Windows/UNC/POSIX boundary、`..` 拒绝、source identity precedence、最长前缀、规则 ownership、strategy order、mount replacement、DirectUrl/same-origin mode、Native fallback、Abort 和 bounded authenticated connection probe。最终 HEAD 的 source build、runtime provenance 和 package payload verify 均通过。最终-head synthetic runtime smoke 保持记录为 `NOT COMPLETED — hidden Electron smoke timeout`；本轮未重新运行或重试。该 timeout 属于 runtime smoke 证据边界，不判定产品功能失败，也不宣称最终 HEAD 已重新通过 synthetic runtime。

较早候选 HEAD `295626753089de9f70c2cb28b5c5954be51b3843` 已有 synthetic runtime pipeline PASS 证据，包含 DirectUrl fake、CD2 HTTP fake、CD2 miss → Mount/Native fallback，以及 PlaybackManager / Session / controls / reporting / cleanup。上述证据继续保留，但不冒充最终 HEAD `628b3c4...` 的重新验证结果。

真实边界：当前 native-window automation surface 不可用，未继续启动播放器补齐手工点击证据，因此 `REAL SETTINGS UI: NOT COVERED — native window automation unavailable`。本分支未连接真实服务器，real cloud-first playback 与 real mount-first playback 均为 NOT COVERED；synthetic runtime/Node unit 不能替代真实验收。

## 2026-09-15 — Clean-room reproducibility / readiness observability hardening

基于正式基线 `main@56b2227324811b525cd73caed61e3399cd2875e5` 创建独立分支 `audit/cleanroom-readiness-hardening`，代码提交为 `6c5cc9e05b7dbec6a01a2cf81cd19209deb0b319`。本轮只修改 prepare/build/provenance、acceptance observer/runner、diagnostics tooling、tests 和 docs；没有修改 PlaybackManager、resolver、libmpv 播放逻辑、Session/remote control、settings/autoplay、UI、CEC、Electron 或 mpv 版本。

修复 clean-room blocker：`src/electronapp/preload.js` 原来被 `.gitignore` 忽略，测试直接读取但 `prepare.ps1` 没有生成来源。现在由 tracked `tools/prepare-preload.cjs` 从 vendor Carnival preload 生成 prepared workspace artifact，并由 `prepare.ps1`、`build.ps1` 共用；runtime provenance 单独校验 vendor base、generator、prepared source 和 runtime hash。旧 214-byte vendor preload 与 Enhanced diagnostics/sticky state 不再混淆。

两个独立 clean worktree 各自执行 `npm ci --ignore-scripts`、prepare、`npm test`、build、provenance 和 `package.ps1 -VerifyOnly`，均通过；`npm test` 为 77/77，runtime 各 2116 个 payload，scope 54，prepared artifact valid，两个 build manifest 逐路径 SHA256 identical。

readiness observer 现在记录 raw embed ready、direct diagnostics callback、sticky/current readiness、core-playing、视频 PositionTicks、Session/progress 和 Stop；带 runId/时间/bridge 关联，旧 run 不能污染新 run。完整 alternate evidence 缺少 direct marker 时归类为 class B observer-only-miss，不再当作 Pepper initialization failure。当前 10 次 startup real run 为 A 10/10、playback 10/10、raw/authoritative readiness 10/10、observer miss 0/10、actual player failure 0/10；2 次 full-control 通过，Stop 后 NowPlaying 清空、runner residual=0。结论详见 [CLEANROOM_REPRODUCIBILITY](CLEANROOM_REPRODUCIBILITY.md) 和 [READINESS_OBSERVABILITY](READINESS_OBSERVABILITY.md)。

基础环境记录为 host Node `v24.18.1`、Windows PowerShell `5.1.26100.9444`、bundled Electron `18.3.15`，embedded Node `16.13.2`。本轮不 push、不 merge、不发布。

## 2026-09-14 — External Player process-control cleanup Batch 2

基于 `main@65d97da975ea1ffc3505c099094086c33667931e` 在 `cleanup/external-player-process-chain` 完成本批 host/process legacy cleanup。重新审计确认 Batch 1 已从 fresh runtime 排除 External Player frontend/plugin，`mpvPosEvent`、`mpvPos`、`mpv-socket`、Electron custom shell 的 `canExec/exec/close`、close-event helpers、`shellstart/shellclose`、`processes`、`startProcess`、`closeProcess` 和旧 `execFile` callback chain 均无其它当前 consumer，已从维护产品代码删除。

保留项：`shell.openUrl` 与 `electronapphost://openurl`、generic `window.ipc`、CD2/diagnostics IPC、其它 host protocol command、CEC、Anime4K `child_process.exec('notepad.exe ...')` helper、Pepper/libmpv、PlaybackManager、resolver、Session/remote control 和 `sessionplayer.js`。浏览器 fallback `www/modules/shell.js` 的 unsupported process API 未改动，vendor/carnival 原件未改动。

新 runtime `dist/EmbyTheaterEnhanced-0.1.1-batch2-process-chain-65d97da` provenance PASS（779 product-scope entries），package verify PASS（2,116 payload files）。runtime `electronapp` 下本批 dead reference 为 0；相对 Batch 1 after-cleanup runtime，实际文件数保持 2,117，大小由 389,008,884 降至 389,005,881 bytes，减少 3,003 bytes。文件数不变是因为删除发生在保留的 `main.js`/`shell.js` 文件内部。

新增 targeted process-chain tests 5/5；全量 `npm test` 67/67。唯一一次 bounded real acceptance 的 `inspect/select/play/pause/seek/resume/next/stop` 全部通过，`strm=true`，Pepper-ready、resolver-result、manager-play-resolved、Session/reporting、cleanup 均通过，runner `completed`、`timedOut=false`、residual owned processes=0。`loadfileObservation=unavailable` 仍是既有 observability gap，不作为 gate。

本批未处理 settings/playback、item autoplay、PlaybackManager external-player guards、shared locale/CSS、`external/`、vendor helper、CEC、Pepper/PPAPI、Electron upgrade 或用户配置迁移；当前不能写成 External Player 全部移除。Model Tier：2；Reason：跨 main-process IPC、custom shell、host protocol 和真实播放/Session 边界的删除与验收。

## 2026-09-14 — External Player registration portability fix

在 `cleanup/external-player-frontend` 上补齐 Batch 1 最后一个 portability blocker。新增 tracked `tools/patch-external-player-registration.cjs`，只处理 Electron 的 `responses.electron && list.push("modules/externalplayer/plugin")`；`tools/build.ps1` 在 source overlay 后执行 patch，再排除 External Player frontend directory。Android/其它平台分支不受影响，already-clean 状态幂等，重复/未知变体 fail closed。

`tools/runtime-provenance.cjs` 将 `electronapp/www/app.js` 纳入受控 build overlay，记录并校验 source/runtime/generator hash；source app.js 缺失时安全使用 vendor fallback，scope 不粗暴排除 app.js。新增 app-registration 与 provenance fallback 回归。未修改播放、Session、main IPC、shell、CEC、vendor 或用户数据；未重新执行真实 acceptance。

## 2026-09-14 — Provenance portability blocker fix

Batch 1 review 发现 External Player frontend 位于 ignored `src/electronapp/www/`，本机物理删除不具备 Git portability。当前修复在 `tools/runtime-provenance.cjs` 中加入精确 `src/electronapp/www/modules/externalplayer/` intentional source exclusion，并写入 `validatedProductScope.excludedSourcePrefixes`；同时将 `electronapp/www/app.js` 纳入 tracked build-time registration overlay，由 `tools/patch-external-player-registration.cjs` 只关闭 Electron registration。source subtree/app.js 存在或不存在时均可生成受控 provenance，普通 source file 缺 runtime 仍然失败。新增 targeted regression 与 sentinel portability 验证覆盖该边界。

Local audit workspace：41 个 ignored snapshot files 曾在本机删除。Durable repository/product behavior：provenance contract 和 `tools/build.ps1` runtime exclusion 保证 fresh Enhanced runtime 不包含该 frontend，不依赖本机 ignored snapshot 状态。未修改播放、Session、main IPC、shell、CEC 或用户数据，未重新执行真实 acceptance。

## 2026-09-14 — External Player frontend cleanup Batch 1

基于 Audit commit `fb434e57f2cca065c784e0551c651ef57d1a2634` 创建分支 `cleanup/external-player-frontend`，完成 cleanup commit `adc8758902a580cc3bc7fc33bfb10a6b422c828d`。本轮只移除 External Player frontend/plugin layer：本地 ignored Web snapshot 的 41 个文件已物理删除，`tools/build.ps1` 增加纯 frontend runtime exclusion，并移除直接读取已删除 plugin 的 obsolete 单测。vendor 原件、main IPC、shell、CEC、external helper、PlaybackManager、Session、libmpv、resolver、CD2、DirectUrl、Mount、preload 和用户数据均未修改。持久化到仓库的行为是精确 runtime exclusion，而不是 41 个 tracked file deletion。

新 runtime `dist/EmbyTheaterEnhanced-0.1.1-batch1-after-cleanup-adc8758` provenance 通过，删除路径 0 entries，`package.ps1 -VerifyOnly` 通过（2,116 payload files）。对照 runtime 为 2,158 files / 389,112,766 bytes，清理后为 2,117 files / 389,008,884 bytes，净减少 41 files / 103,882 bytes；本地 source 删除 77,725 bytes。`npm test` 56/56、451 个 JS syntax、11 个 PowerShell syntax 和 `git diff --check` 均通过。

唯一一次 bounded real acceptance 的 `inspect/select/play/pause/seek/resume/stop` 全部通过；`strm=true`、Pepper-ready、resolver-result、manager-play-resolved 均观察到，Session/reporting 正常，runner completed、cleanup verified-clean、residual=0。`loadfileObservation=unavailable` 仍为 observability gap。External Player frontend/plugin layer 已标记 REMOVED；`mpvPosEvent`、named pipe、main-process external-player IPC、shell external-process branch、`external/` 和 vendor helper 明确保留到后续 Batch 2/3。

## 2026-09-14 — Legacy cleanup audit

基于当前 `main@c873913ea1a2716e048e785fa2fd83294dd091b5` 完成 Foundation Cleanup / Legacy Audit。本轮只做静态引用追踪、分类和 packaging inventory，没有修改 `src/` 产品行为、PlaybackManager、Session、libmpv、resolver、CD2、CEC 或用户数据，没有删除代码、运行 Carnival/补丁脚本、执行真实 Emby 播放、提交或推送。

新增 `docs/LEGACY_AUDIT.md`，覆盖 External Player、shell/exec、CEC、旧 IPC/named pipe、settings/routes、打包残留和平台兼容代码。结论为：External Player 41 文件及其旧 mpv pipe 具备高置信度删除候选条件；shared `shell.openUrl`、CEC、preload generic IPC 和 Foundation 播放/Session 链必须保留；Pepper/PPAPI/Electron 18、平台分支、CEC driver/alias、Anime4K preset 和 settings/autoplay 语义继续 DEFER/UNKNOWN。当前推荐进入 Cleanup Batch 1 规划，尚未执行 cleanup PR。

本轮静态证据包含 vendor manifest/build/installer 全量复制关系、当前 ignored Web snapshot 和实际 runtime payload 统计。验证：`npm test` 57/57；未执行真实 acceptance 或安装验收。产品代码 modified：NO。

## 2026-09-14 — Pepper ready listener race follow-up

分支 `fix/pepper-ready-listener-race` 基于 `main@e9e2ad221ed5059574f830e9ffd9ef0dd5c8a22c`，上一轮诊断 harness/doc 资产已由 `ef34827378805e7a80ea0f73e1f5bbf2ddbf9314` 独立保留。本轮产品修复 commit 为 `731dc2ad5ca4898475a5e641b6975563f9cf8c74`，仅将 authoritative window `ready` listener 和 `libmpv=embed` 初始化移到 DOM attach 前，并新增行为型同步 ready 回归。新 runtime provenance 通过；一次真实 acceptance 的 inspect/select/isStrm/Pepper-ready/resolver-result/manager-resolved/cleanup 全部通过。历史 readiness 根因仍未确认，本修复只处理静态 listener-after-attach 风险；未 push、未 merge。

## 2026-09-14 — Pepper readiness 抖动诊断

当前 `main@e9e2ad221ed5059574f830e9ffd9ef0dd5c8a22c` 的产品代码保持冻结。基于新建且通过 full runtime provenance 的 `dist/EmbyTheaterEnhanced-0.1.1-readiness-diagnosis-e9e2ad2` 完成 3 次有界 real acceptance，均 `acceptance=success`、`runner=completed`、`timedOut=false`、`cleanup=verified-clean`、residual=0。三次均观察到唯一 embed，播放期间无重建；`play-called→embed` 为 4535–5996ms，`embed→authoritative enhancedDiagnostics(libmpv, 'ready')` 为 2–3ms。当前诊断为 `ROOT CAUSE NOT YET CONFIRMED`，主要抖动位于 embed 创建前的 PlaybackManager/player 前置链，精确 sub-stage 仍待观测；没有证据支持 Pepper/plugin 初始化、ready 丢失、embed recreation 或 PR4/DirectUrl/resolver 是本轮 ready 抖动原因。详见 `docs/PEPPER_READINESS_DIAGNOSIS.md`。本轮只增强 acceptance harness 与文档，未修改产品代码，不提交、不推送。

更新时间 2026-09-14（UTC+8）。**当前产品代码保持冻结。readiness harness baseline 已由 `3d1cc6d906131d2e7e1d0a10af5fd354b228a41d` 提交；本轮独立 follow-up 加固了 runtime provenance、终态单写入和 PID ownership 边界。历史 real acceptance artifact 已分开记录：旧 `readiness-main-20260914-070236533-48d1e60e` 是 acceptance success 但 runner 在旧生命周期下以 242507ms timeout 收尾；较新的 `terminal-real-20260914-073146032-27837240` 是 acceptance success、runnerResult=`completed`、timedOut=`false`、elapsed=`15959ms`、residual=0。两次均保持 `loadfile` unavailable observability gap，不作为 gate。**

## 接手摘要

- Baseline：用户提供的 Carnival 3.0（应用 3.0.20-3.0）+ 综合补丁最终 ZIP。
- Enhanced：0.1.1 开发候选；Windows host 文件版本保持 3.0.20.0，Electron 应用构建版本为 0.1.1。
- Git：本轮基于 `main@65d97da975ea1ffc3505c099094086c33667931e` 在 `cleanup/external-player-process-chain` 完成 Batch 2；技术基线与验证结果记录于本节，具体合并状态以仓库 Git/PR 历史为准。未知来源的完整 Web snapshot、vendor 输入、二进制与构建产物均排除。
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
| External Player | frontend/plugin 与 host/process-control chain 已移除；settings/autoplay/PlaybackManager/shared residue 仍保留 |
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
10. Acceptance runner 已改为单次 owned root PID 的 bounded runner：terminal report 出现后等待短 flush window；cleanup 先验证 root PID CreationDate，只有匹配后才观察并登记 descendants，随后只对该 root process tree 执行 `taskkill /PID ... /T /F`；无 terminal report 才使用 deadline timeout，最终始终写入 `runner-result.json`、stdout 和 stderr。success/failure/timeout、terminal race、`inspectProfile` integration race、PID-reuse-with-descendant 与 PID CreationDate mismatch synthetic 均通过。CIM unavailable 会 fail closed 为 `cleanupStatus=unverified`、`ownershipVerified=false`、residual 未知，不报告完整 success，也不观察/登记/kill 不确定 descendants。后续 follow-up 的 full provenance manifest 覆盖全部 repo-owned `src/electronapp` 文件，并将 package metadata 与 PlaybackManager 作为显式 build overlay；vendor baseline、node_modules production closure、Electron runtime binaries 与 native mpv 均独立排除。历史较新的 real artifact 中 `inspect`/`select`/`play-called`/`resolver-result`/`manager-play-resolved` 通过，`loadfileObservation=unavailable`；runner 总耗时 15959ms、runnerResult=completed、timedOut=false、residual owned processes=0。

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
