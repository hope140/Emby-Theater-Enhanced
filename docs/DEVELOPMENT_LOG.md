# 开发日志

## 2026-09-15 — Fix STRM rule-selection identity precedence

在 `feat/strm-resolver-settings@2956267` 上修复 `selectRule()`：可识别的绝对 `sourcePath` 现在独占 longest-prefix match；source 没有命中时直接返回 null，不再由更长的 `Item.Path` sidecar rule 接管。只有 HTTP/非绝对 source path 才使用 sidecar identity fallback。Windows/UNC case-insensitive、POSIX case-sensitive 和目录边界保持不变。

新增 A/B/C regression tests，分别覆盖 source 命中优先、有效 source 无命中禁止 sidecar 接管、HTTP source 允许 sidecar fallback。未修改 PlaybackManager、Session、libmpv ownership、CD2 service 架构或配置 schema。

验证：settings targeted 20/20；`npm test` 97/97；相关 JS syntax 与 `git diff --check` 通过。修复后按最终 HEAD 重建 runtime 的 provenance/package verify，并执行一次非可见 synthetic runtime pipeline；REAL settings UI 继续记录为 `NOT COVERED — native window automation unavailable`。

## 2026-09-15 — STRM resolver settings candidate

Model Tier：2。Reason：跨 main-process persistent config/secret IPC、resolver rule ordering、Mount prefix replacement、DirectUrl/same-origin deadline reuse 和现有 libmpv source-only boundary；没有改变 PlaybackManager、Session、WebSocket 或 player ownership。Escalated：no。

基于 `main@ca9ca9de58c37b8f5f3782dd1e45e9efc2071495` 创建 `feat/strm-resolver-settings` 独立 worktree。新增 `strm-config-store.js`、`strm-config-ipc.js`、`path-rules.js`、settings route/page/style/client 和 targeted tests。配置与 secret 分离，GET 只返回 tokenConfigured；legacy env 仅做首次 AUTO bootstrap。规则支持 source/mount/cloud 三种独立路径、最长前缀、Windows/UNC case-insensitive、POSIX case-sensitive、cloud-first、mount-first、custom order 以及 AUTO/USER/DISABLED 保护。

CD2 service 保留现有 DirectUrl 安全 contract，并以 `direct` / `same-origin` mode 在同一 service 中复用 Find 结果和 750ms absolute deadline。Mount stage 增加 deterministic sourcePrefix → mountPrefix replacement；Native、Transcode、Abort、superseded 和 late-response 语义保持原行为。

验证：`npm test` 94/94；settings targeted 17/17；JavaScript syntax、PowerShell syntax、`git diff --check`、prepare、build、runtime provenance 和 package verify 均按本分支执行。synthetic frozen runtime 的 DirectUrl、CD2 HTTP、CD2 miss fallback、PlaybackManager/Session/controls/reporting/cleanup 通过。native-window automation 不可用，真实 settings UI、真实服务器 cloud-first/mount-first playback 未宣称。

## 2026-09-15 — Clean-room / readiness foundation hardening

Model Tier：2。Reason：跨 prepare/build/provenance 与 embedded Pepper readiness observer、真实 Session/playback evidence 的边界审计；产品播放代码保持冻结。

基线 `main@56b2227324811b525cd73caed61e3399cd2875e5` 在独立 fresh worktree 中先按 `npm ci --ignore-scripts` 后执行 `npm test`，复现 62 PASS / 1 FAIL：`tests/external-player-process-chain.test.cjs` 模块加载阶段直接读取缺失的 ignored `src/electronapp/preload.js`。vendor 只有 214-byte Carnival preload；主开发工作区的 620-byte diagnostics preload 没有 Git source 或 prepare 生成 contract。

新增 `tools/prepare-preload.cjs`，以 vendor preload 为只读 base 生成 deterministic prepared workspace artifact，保留现有 IPC/fs/os/appdata bridge，加入非阻塞 diagnostics bridge 和带 runId 的 sticky readiness state。`prepare.ps1`、`build.ps1` 共用生成器；`runtime-provenance.cjs` 新增 prepared artifact contract，旧/手工/过期 preload 会 fail closed。其它 ignored inputs 审计为 SAFE/INTENTIONAL/UNKNOWN，没有把整个 Web snapshot 纳入 Git。

readiness observer 新增 raw ready、direct diagnostics、sticky state、core-playing 和 video-progress facts；live flow 只在 manager resolved、core-playing、视频推进、Session NowPlaying 与已接受 playback report 齐全时把缺少 direct marker 的 run 判为 class B alternate evidence。`tools/readiness-evidence.cjs` 和新增 synthetic tests 覆盖 A/B/C/D/E；不把 `play-called` 单独当作 ready，outgoing loadfile 仍保持 unavailable observability gap。

提交：`6c5cc9e05b7dbec6a01a2cf81cd19209deb0b319`，消息为 `fix: make clean-room inputs and readiness evidence reproducible`。验证：`npm test` 77/77；Node/PowerShell syntax PASS；acceptance readiness、terminal race/integration、PID reuse descendant synthetic PASS。两个独立 cleanroom worktree 的 prepare/npm test/build/provenance/package verify 全部 PASS，runtime payload 各 2116 且逐路径 hashes identical。

真实验证使用 cleanroom-1 validated runtime，串行 startup-only 10 次和 full-control 2 次。startup 10/10 class A、raw/direct/sticky readiness 10/10、resolver/core/video/Session/progress/stop 10/10、cleanup verified-clean、residual 0；full-control 2/2 的 pause/seek/resume/next/stop 和 10 条 reports 均通过。旧 vendor-only runtime 的对照 run 为 class B，direct marker 缺失但 manager/core/video/Session/progress 全部成功，证明 observer miss 被单独分类。详细脱敏证据见 `docs/CLEANROOM_REPRODUCIBILITY.md` 与 `docs/READINESS_OBSERVABILITY.md`。

## 2026-09-14 — External Player process-control cleanup Batch 2

基于 `main@65d97da975ea1ffc3505c099094086c33667931e` 创建 `cleanup/external-player-process-chain`，完成 Foundation Cleanup / Legacy Cleanup Batch 2。按任务书重新审计了 `rg`、IPC registration、`electronapphost` protocol dispatch、动态 command string、preload exposure、shell consumer、main caller、tests 和 build/package 输入。Batch 1 已将旧 External Player frontend/plugin 从 fresh runtime 排除，因此 `mpvPosEvent`/`mpvPos`/`mpv-socket`、Electron custom shell process methods、shell protocol process cases 和 main process helper chain 均确认没有其它当前 consumer。

产品变更：

- `src/electronapp/main.js` 删除旧 `net.Socket`、playback-time polling、`ipcMain.handle('mpvPosEvent')`、`webContents.send('mpvPos')`、`shellstart/shellclose` dispatch、`processes` map、`startProcess`、`closeProcess` 和旧 `execFile` callback chain。
- `src/electronapp/shell.js` 删除 `canExec`、`exec`、`close`、`getProcessClosePromise`、`onChildProcessClosed` 及其 event/argument helpers；保留 `shell.openUrl` 和原有 `electronapphost://openurl` request contract。
- Anime4K `child_process.exec('notepad.exe ...')`、CEC process execution、refresh-rate process、generic preload `window.ipc`、CD2/diagnostics IPC、CEC、Pepper/libmpv、PlaybackManager、resolver、Session/remote control 均保留。未修改 settings/playback、item autoplay、PlaybackManager external-player guards、shared locale/CSS、`external/`、vendor helper、用户配置或服务器数据。

新增 `tests/external-player-process-chain.test.cjs`，以 source-level contract 检查 dead registration/dispatch/helper 消失，以 VM 行为测试验证 `shell.openUrl` 发出 `GET electronapphost://openurl?url=...`，并以 fake trusted IPC 验证 CD2 resolve/cancel 与 Anime4K/CEC preservation。没有引入新测试框架。

验证结果：

- `npm test`：67/67 PASS；targeted process-chain tests：5/5 PASS。
- JavaScript syntax：455 files PASS；PowerShell syntax：11 files PASS；`git diff --check`：PASS。
- fresh runtime `EmbyTheaterEnhanced-0.1.1-batch2-process-chain-65d97da`：runtime provenance PASS（779 product-scope entries），`package.ps1 -VerifyOnly` PASS（2,116 payload files）。runtime `electronapp` 中本批 dead process references 为 0；`shell.js`、preload、CD2/diagnostics、CEC、libmpv、resolver、PlaybackManager、`sessionplayer.js` 均存在。
- 相对 Batch 1 after-cleanup runtime：实际文件数 2,117 → 2,117，减少 0；大小 389,008,884 → 389,005,881 bytes，减少 3,003 bytes。删除发生在保留的 `main.js`/`shell.js` 文件内部，未删除整个 shared 文件。
- 唯一一次 bounded real acceptance 使用 `inspect,select,play,pause,seek,resume,next,stop`，全部 PASS；`strm=true`，Pepper-ready、resolver-result、manager-play-resolved、Session/reporting、cleanup 均通过；runner `completed`、`timedOut=false`、`cleanup=verified-clean`、residual owned processes=0。`loadfileObservation=unavailable` 仍是既有 observability gap，不作为 gate。

同步更新 `docs/LEGACY_AUDIT.md`、`docs/EXTERNAL_PLAYER_REMOVAL.md`、`docs/PROJECT_STATUS.md` 和 `docs/TESTING.md`，明确 Batch 1 frontend/plugin layer 与 Batch 2 host/process-control chain 已移除，settings/autoplay/PlaybackManager/shared residue 仍保留。vendor 原件未修改；本轮不 push、不 merge、不开始下一批。

Model Tier: 2
Model: current Codex session
Reason: main-process IPC、custom shell、electronapphost protocol、真实 PlaybackManager/Session/remote-control acceptance 均在边界内，需要跨层删除后复核
Escalated: no

## 2026-09-14 — External Player registration portability fix

Batch 1 review 的最后 blocker 是 Electron External Player registration 只存在于 ignored Web snapshot 的本机修改。本轮新增 `tools/patch-external-player-registration.cjs`，以精确 registration pattern 做可重复、幂等且 fail-closed 的 patch；`tools/build.ps1` 在 source overlay 后执行它，再移除 `electronapp/www/modules/externalplayer`。Android `native/android/externalplayer` 和其它平台分支保持不变。

`runtime-provenance.cjs` 将 `electronapp/www/app.js` 登记为受控 overlay，记录 generator/runtime/source 状态；source app.js 存在时验证 source/runtime/generator hash，source app.js 缺失时验证 vendor fallback runtime overlay，且不降低其它产品 scope。新增 active/already-clean/platform-preservation/malformed-duplicate patch tests，以及 source sentinel/external-player exclusion 和 normal missing-runtime failure regression。未修改播放代码、Session、main IPC、shell、CEC、vendor 或用户数据，未重新执行真实 acceptance。

Model Tier: 1
Model: current Codex session
Reason: the change is a narrow tracked build/provenance contract with targeted fixtures; playback and Session behavior remain out of scope
Escalated: no

## 2026-09-14 — Provenance portability blocker fix

Batch 1 review 发现 External Player frontend 位于 ignored `src/electronapp/www/`，本机删除 41 个文件不会同步到其它构建机；若 provenance 继续枚举它们，而 build runtime 已排除目录，另一台机器会构建失败。本轮只修该 contract：`runtime-provenance.cjs` 以精确 `src/electronapp/www/modules/externalplayer/` 前缀做 intentional source exclusion，并在 `validatedProductScope.excludedSourcePrefixes` 中记录；同时将 `electronapp/www/app.js` 登记为由 `patch-external-player-registration.cjs` 控制的 build overlay，只关闭 Electron registration。write/validate 共用同一 exclusion/overlay contract，其他非排除 source file 的缺失仍 fail。

Local audit workspace：本机曾删除 41 个 ignored snapshot files。Durable repository/product behavior：provenance contract 与 `tools/build.ps1` exclusion 保证该 frontend 不进入 fresh Enhanced runtime，无论 ignored snapshot 是否存在。新增 targeted provenance regression，未修改播放代码、Session、main IPC、shell、CEC、vendor 或用户数据；未重新执行真实 acceptance。

## 2026-09-14 — External Player frontend cleanup Batch 1

从 Audit commit `fb434e57f2cca065c784e0551c651ef57d1a2634` 创建 `cleanup/external-player-frontend`，提交 `adc8758902a580cc3bc7fc33bfb10a6b422c828d`，消息为 `cleanup: remove dead external player frontend`。本轮按 contract 只清理前端/plugin 表层：物理删除本地 ignored Web snapshot 中 `www/modules/externalplayer/**` 的 41 个文件；在 `tools/build.ps1` 增加纯 External Player runtime exclusion，避免 vendor 全量复制把它重新带入新 runtime；删除直接读取该 plugin 文件的 obsolete 单测。持久化仓库行为是 exclusion，不是 41 个 tracked file deletion。没有修改 main.js、mpvPosEvent、named pipe、shell、shell.openUrl、CEC、Pepper/PPAPI、libmpv、PlaybackManager、remoteplayer、Session、resolver、CD2、DirectUrl、Mount、preload、external/、vendor helper 或用户设置。

删除前重新追踪了 registration、AMD require、route/controller、自引用和 package copy rule。删除后剩余 `externalplayer` 命中逐项归类为 Android 平台分支、Batch 2 settings/autoplay/PlaybackManager guard、负向 smoke 断言或合法 build exclusion，没有失效的 `www/modules/externalplayer` runtime path。vendor/carnival 原件仍保留 41 个文件且未修改。

验证 runtime 为 `dist/EmbyTheaterEnhanced-0.1.1-batch1-after-cleanup-adc8758`：provenance PASS（779 scope entries）、payload verify PASS（2,116 files）、删除路径 0 entries；npm test 56/56，451 个 JS syntax、11 个 PowerShell syntax、git diff --check 全部通过。对照 runtime 2,158 files / 389,112,766 bytes，清理后 2,117 files / 389,008,884 bytes，减少 41 files / 103,882 bytes；本地 source size 减少 77,725 bytes。

唯一一次 bounded real acceptance 使用 `inspect,select,play,pause,seek,resume,stop`，全部 PASS，`strm=true`，Pepper-ready/resolver-result/manager-play-resolved 均 observed，Session/reporting 正常，runner completed、cleanup verified-clean、residual=0。`loadfileObservation=unavailable` 保持既有 observability gap，不作为本轮 gate。

准确状态：External Player frontend/plugin layer removed；main-process/helper residue remains for Batch 2 audit/removal。未 push、未 merge、未开始 Batch 2。

Model Tier: 1
Model: current Codex session
Reason: the requested deletion was narrow and the cross-module contract was fixed; only frontend payload/build exclusion and an obsolete direct-load test were in scope
Escalated: no

## 2026-09-14 — Foundation legacy audit

本轮按任务书在 `main@c873913ea1a2716e048e785fa2fd83294dd091b5` 上执行 Foundation Cleanup / Legacy Audit。范围限定为审计、分类和可执行清单，不删除产品代码、不修改播放架构、不运行 Carnival 或综合补丁安装/恢复脚本、不执行真实 Emby acceptance、不提交或推送。

静态追踪确认：维护版 `www/app.js` 已以 `responses.electron && false` 禁止 External Player 默认注册，disabled plugin 构造函数返回空路由/不可播放；其 41 个 module/controller/HTML/locale 文件仍随全量 vendor copy 进入 runtime。旧 `mpvPosEvent`/`mpv-socket` producer 只有该不可达 plugin consumer；`shell.js` 的 `openUrl` 仍有四类活动调用者，只有 process-only `exec/canExec/close` 可作为拆分候选。CEC 由顶层 plugin 动态加载并通过 `electroncec` 初始化，判为 KEEP。动态 plugin、opaque managed host、CEC executable 参数、用户 settings/autoplay、Anime4K preset、CEC driver/alias 和平台分支按证据不足或共享风险列为 UNKNOWN/DEFER。

新增 `docs/LEGACY_AUDIT.md`，记录 8 个任务领域、依赖链、KEEP/DELETE CANDIDATE/DEFER/UNKNOWN、三个 cleanup batch、payload 统计和 Batch 1 回归条件。统计包括 External Player 41 文件约 77KB、CEC 15 文件约 1.47MB、`external/` 46 文件约 29.34MB、旧 root BAT 约 13.9KB；vendor 原件和 ignored runtime 均保持只读。

验证：`npm test` 57/57；本轮未运行安装器、真实播放或远控验收。产品代码 modified：NO。

Model Tier: 1
Model: current Codex session
Reason: task contract was audit-only; implementation scope was limited to documentation and static cross-module evidence
Escalated: no

## 2026-09-14 — Pepper ready listener race follow-up

本轮在 `fix/pepper-ready-listener-race` 上执行，基于 `main@e9e2ad221ed5059574f830e9ffd9ef0dd5c8a22c`。上一轮诊断 harness/doc 资产已先独立保留为 `ef34827378805e7a80ea0f73e1f5bbf2ddbf9314`；本轮不混入临时 instrumentation。

重新核对 `src/electronapp/plugins/libmpv.js` 后确认旧顺序为：创建 embed → 注册 embed `message` listener → attach 到 dialog → 设置 `libmpv` → 注册 window `ready` listener。由于 Pepper 可能在 attach 同步窗口发出 `{type:'ready'}`，旧顺序存在 listener-after-attach race。修复后顺序为：创建 embed → 注册 message listener → 设置 `libmpv` → 注册 window authoritative `ready` listener → attach 到 dialog。embed 属性、`application/x-mpvjs`、DOM parent、ready callback、`enhancedDiagnostics(libmpv, 'ready')`、player reuse、stop/destroy 和 message handling 均保持不变；listener 仍使用 `{once:true}`，没有新增 retry、sleep、timeout 或轮询。

新增 `tests/pepper-ready-listener-race.test.cjs`，使用实际 `libmpv.js` AMD factory、最小 fake DOM/event target，并让 fake Pepper 在 `insertBefore(embed)` 的同步调用内立即发 ready。旧顺序测试会超时，修复后证明 ready 被捕获、`play()` 收束、authoritative ready callback 只执行一次；npm 全量测试为 57/57。初始化区其它首次消息 listener 没有发现同类 attach 后注册风险：embed `message` listener 已在 attach 前，`core-playing` listener 在 `playInternal/loadfile` 前。

按本分支 HEAD 构建 `dist/EmbyTheaterEnhanced-0.1.1-pepper-ready-race-731dc2a`，full runtime provenance 820/820 通过。唯一一次真实 acceptance 使用 `inspect,select,play,stop`，结果为 inspect PASS、select PASS、isStrm=true、unique embed=1、Pepper ready observed、resolver-result observed、manager-play-resolved observed、classification success、cleanup verified-clean、residual=0。timing 为 `play→embed=4724ms`、`embed→Pepper ready=22ms`，仅作为回归证据，不宣称性能改善；`loadfileObservation=unavailable` 仍是既有 observability gap。

本轮仍保留 `ROOT CAUSE NOT YET CONFIRMED`。本修复只关闭静态极早 ready 丢失风险，不能宣称已经确认历史 20–30 秒 readiness 长尾的根因。

Model Tier: 2
Model: current Codex session
Reason: the change is small but touches libmpv/Pepper event ordering and requires a synchronous fake-plugin behavior test plus one real acceptance
Escalated: no

提交：`731dc2ad5ca4898475a5e641b6975563f9cf8c74`，消息为 `fix: register Pepper ready listener before attach`。未 push、未 merge。

## 2026-09-14 — Pepper readiness 抖动诊断

本轮按用户任务只做 Foundation / Pepper readiness diagnosis。基线为 `main@e9e2ad221ed5059574f830e9ffd9ef0dd5c8a22c`，产品 `src/electronapp`、PlaybackManager、libmpv、preload、main、resolver、CD2、DirectUrl、服务器和用户播放器配置均未修改；没有提交、推送或发布。

静态审计确认实际链路为 PlaybackManager `self.play()` → `playInternal()` → `showVideoOsd()` → `displaySync()` → `createMediaElement()` → `<embed type="application/x-mpvjs">` → embed `message` `{type:'ready'}` → `enhancedDiagnostics(libmpv, 'ready')` → resolver/loadfile/core-playing → `enhancedDiagnostics(..., 'playing')` → manager play Promise resolve。产品在 `libmpv.js:523` 插入 embed 后才在 `:526` 注册 window `ready` listener，存在静态 listener-after-event 风险；当前没有 ready timeout/retry。现有 `createMediaElement()` call、outgoing loadfile 和 DLL init 起点没有可靠 acceptance signal。

本轮只在 `tests/` 与 `tools/` 做最小 harness 增强：observer 用 MutationObserver 记录 embed creation observation、attached/disconnected、unique count、recreation/duplicate；recorder 输出 lifecycle/timing；profile inspect 兼容 Promise-style loader、global ConnectionManager 延迟初始化；runner 对 terminal report 后 root 自然退出按已验证 creation date 继续做安全 cleanup。没有加入产品 instrumentation、通用 AMD probe、event bus 或复杂状态机。

按当前 HEAD 新建 `dist/EmbyTheaterEnhanced-0.1.1-readiness-diagnosis-e9e2ad2`，runtime provenance 820/820 scope entries 通过。Run A/B/C 均使用相同 runtime、相同 harness 和 `inspect,select,play,stop`：

| Run | play→embed | embed→bootstrap | embed→authoritative ready | ready→manager resolved | result |
|---|---:|---:|---:|---:|---|
| A | 5996ms | 3ms | 2ms | 2657ms | success |
| B | 4565ms | 4ms | 3ms | 2117ms | success |
| C | 4535ms | 4ms | 3ms | 2268ms | success |

三次均 unique embed=1、无播放期间 recreation/duplicate；runner 均 `completed`、`timedOut=false`、`cleanup=verified-clean`、residual=0。`bootstrap→authoritative ready` 原始值三次为 -1ms，解释为同一 message dispatch 中产品 listener 先于 acceptance listener，业务间隔约 0ms。resolver-result 在 ready 后 4–5ms 出现，loadfile observation 仍 unavailable，不影响 gate。

诊断结论：`ROOT CAUSE NOT YET CONFIRMED`。本轮主要 jitter stage 是 `play-called→embed-created/attached`（4535–5996ms），不是 `embed→Pepper ready`。最可能层是 embed 创建前的 PlaybackManager/player 前置链，包括 API/码率/流选择、OSD 路由和 display-sync，但当前没有调用级时间戳，不能确认单一根因。三次没有证据支持 PPAPI/plugin ready 随机延迟、ready 丢失、embed recreation、harness 影响或 PR4/DirectUrl/resolver 因果关系。完整脱敏 evidence 见 `docs/PEPPER_READINESS_DIAGNOSIS.md`。

Model Tier: 2
Model: current Codex session
Reason: real Pepper/libmpv readiness timing spans PlaybackManager, Electron/Preload, embed lifecycle, bridge message ordering and bounded acceptance cleanup; product lifecycle was kept frozen
Escalated: no

结论：三次 readiness 样本已完成；root cause 未确认，不提出产品修复，不提交、不推送。

## 2026-09-14 — terminal writer 与 cleanup verification follow-up

本轮只处理 acceptance harness 的终态写入和 cleanup verification，产品代码、resolver、observer、PlaybackManager、libmpv、preload、CD2、Pepper bridge 与服务器配置均未修改。`inspectProfile()`、normal success/failure、operation failure 与 global timeout 现在都通过同一个 `createTerminalWriter()`，其内部复用 `OPEN → FINALIZING → COMPLETED` single-writer guard；losing path 在 await 返回后先检查 ownership，不再写入 shared `failure`、terminal classification 或 `report.completed`。cleanup 入口先用当前 root PID 与原始 CreationDate 完成 identity validation，再将同一已验证 snapshot 交给 tree observation；root missing、reuse 或 CIM unavailable 都不会登记或清理 descendants。

新增 integration synthetic 覆盖 `inspectProfile` failure 与 global timeout 的近同时竞争，以及 success claim 后 losing failure 的污染尝试；两项均只产生一次 terminal save，胜出的 classification 保持不变。CIM/WMI 查询失败现在 fail closed：不 kill 未确认 ownership 的 PID，`cleanupStatus=unverified`、`ownershipVerified=false`、`residualOwnedProcesses=null`，runnerResult=`cleanup-unverified` 且返回非零。新增 PID-reuse-with-descendant synthetic，确认复用 root 的 child 未被登记或终止。正常 success/failure/timeout 保持 `verified-clean`；CreationDate mismatch 保持 `pid-reused`/`ownership-mismatch` 并阻止完整 cleanup success。

`dist/EmbyTheaterEnhanced-0.1.1-provenance3-20260914` 在本 follow-up commit 前绑定 `8a3433e53a9c47bba0c25ff5b43e1b3281a4fe9e`，full provenance positive validation 820/820 通过；较早 `provenance2` runtime 因 sourceCommit stale 被 ValidationOnly negative 正确报告为 `runtime-validation-failed`，未启动 Electron。未运行真实 Emby acceptance。

Model Tier: 2
Model: current Codex session
Reason: terminal ownership race and cleanup-verification semantics cross the Electron writer and PowerShell runner, while product playback remains frozen
Escalated: no

结论：terminal writer、inspectProfile integration race、losing-writer protection、CIM unavailable fail-closed、root-before-tree ordering 和既有 PID mismatch 均有合成证据，已形成独立 follow-up commit，可进入 targeted review。

## 2026-09-14 — readiness harness boundary hardening

本轮是 readiness harness 的独立 follow-up 审计，产品代码、PlaybackManager、libmpv、preload、CD2、Pepper bridge、resolver 和服务器配置均保持不变。runtime provenance 从少量 sentinel 扩展为构建范围清单：覆盖 `src/electronapp` 的全部 818 个文件和两个 `Start-Enhanced` wrapper，共 820 个 scope entries；`package.json` 元数据与 PlaybackManager 改写分别记录为显式 build overlay。`sourceCommit`、`validatedProductScope` 与 `baselineIdentity` 分开保存，vendor baseline、node_modules production closure、Electron runtime binary 和 native mpv 不归入产品 scope。

`dist/EmbyTheaterEnhanced-0.1.1-provenance2-20260914` 在上一 follow-up commit 前绑定 baseline `3d1cc6d906131d2e7e1d0a10af5fd354b228a41d`，full provenance positive validation 与 package payload verification 通过；旧 partial-stale runtime 的 ValidationOnly negative 以 `runtime-validation-failed` fail-fast，未启动 Electron。runner 的 terminal guard 采用 `OPEN → FINALIZING → COMPLETED` 单写入语义，success/failure/timeout、terminal race 与 PID mismatch synthetic 均通过；后续本轮补充了 `inspectProfile` integration race、losing-writer protection 与 CIM fail-closed。PID cleanup 在 kill 前重新读取 root PID 的 CreationDate，synthetic mismatch 记录 `pid-reused`/`ownership-mismatch`，不执行不属于本次 run 的清理。CIM lookup unavailable synthetic 以 `cleanupStatus=unverified`、`ownershipVerified=false`、residual 未知结束，runner 不报告完整 success，也不 kill 不确定 PID。

历史 real artifact 分开保留：`readiness-main-20260914-070236533-48d1e60e` 是旧 runner lifecycle 下 acceptance success 但 `runnerResult=timeout`、总耗时 `242507ms`；`terminal-real-20260914-073146032-27837240` 是终态收尾修复后的 acceptance success、`runnerResult=completed`、`timedOut=false`、总耗时 `15959ms`、residual=0。两次均将 `loadfileObservation=unavailable` 作为 observability gap，不作为 gate。本轮 follow-up 没有运行真实 acceptance。

文档同步更正了 fixture 覆盖范围：可重复 fixture 覆盖 profile inspect 的 client lookup；global API、single PlaybackManager require 与 global fallback 不再被描述为已有独立 fixture 证明，而以 acceptance flow/real artifact 证据区分记录。旧 `guard()` helper 已移除。

Model Tier: 1
Model: current Codex session
Reason: bounded provenance, terminal lifecycle and process ownership review; product playback lifecycle remained frozen
Escalated: no

结论：readiness harness follow-up 的 provenance、terminal race 与 PID ownership 边界已完成静态/合成验证，已形成独立提交并可进入 review；不推送、不创建 PR、不运行真实 acceptance。

## 2026-09-14 — runner terminal lifecycle follow-up

本轮只修改 acceptance runner 的终态收尾与 synthetic child，产品代码、resolver、observer 事实采集和 loadfile 观测均未修改。`tests/readiness-acceptance.ps1` 现在以 `acceptance.json` 的 `completed=true` 且存在安全 terminal classification 作为唯一终态来源；检测后等待 300ms flush window，再只清理本次启动的 exact root process tree。240000ms deadline 仍保留给无 terminal report 的 hang，并以 `timedOut=true` / `runnerResult=timeout` 区分。

synthetic success 在约 2.5s 内返回 `runnerResult=completed`、`timedOut=false`、residual=0；synthetic terminal failure 同样提前结束并保留 runner exit code 1；无 terminal report 的 timeout case 返回 `runnerResult=timeout`、`timedOut=true`、residual=0。未使用全局进程名清理。

较新的 `terminal-real-20260914-073146032-27837240` acceptance artifact 使用已校验 runtime，terminal success 在约 14.2s 被识别，runner 总耗时 15.959s，`runnerResult=completed`、`timedOut=false`、acceptance report 存在、root PID 52620 的 exact cleanup 后 residual owned processes=0。`processExitCode=1` 是 taskkill 后的 child 状态，runner 根据 terminal classification 正确返回 `runnerExitCode=0`。本 follow-up 不运行真实 acceptance。

Model Tier: 1
Model: current Codex session
Reason: bounded runner terminal detection and owned process cleanup only
Escalated: no

结论：runner success/failure/timeout 三种生命周期均已验证；本轮不提交、不推送、不发布。

## 2026-09-14 — resolver-bearing runtime acceptance

基于当前 HEAD `c880b97757be422ae818fe30b3a335003e41227b` 使用既有 `tools/build.ps1` 新建 `dist/EmbyTheaterEnhanced-0.1.1-readiness-main-20260914`（2156 files），未覆盖已有 runtime、vendor 或产品源码。正式 runner 增加 runtime fail-fast：四个关键产品文件逐项 source/runtime SHA256 MATCH，`electronapp/resolvers/` 存在，`libmpv.js` 含 `strmResolver.resolveAsync` 与 resolver-result marker；旧 `final-win-x64` 负例被报告为 `runtime-validation-failed` 且未启动 Electron。acceptance report 记录 runtime name、source commit 和 validation status。

更正 gate 语义：`resolver-enter` 改为 `resolver-result`，因为现有产品日志在 `await strmResolver.resolveAsync(...)` 返回后才输出；observer 轮询中恢复被 app 覆盖的 console hook。loadfile 保持 observability gap：embed outgoing `postMessage` wrapper 仍失败并记录 `embed-command-hook-failed`，因此 loadfile 只报告 `unavailable`，不作为硬 gate。产品代码与 PlaybackManager/libmpv 实现未修改。

旧 runner lifecycle iteration 使用 `readiness-main-20260914-070236533-48d1e60e`。runtime validation=passed；`inspect=PASS`、`select=PASS`、`isStrm=true`、容器为 `mkv`/`mp4`、`play-called`、`embed-created`、Pepper authoritative-ready、`manager-play-resolved`、`resolver-result` 全部通过。`loadfileObservation=unavailable`，未作为失败条件；acceptance 主链结果为 `success`，没有新增完整控制链之外的额外结论。runner 达到 240000ms child deadline 后总耗时 242507ms，报告、stdout/stderr 存在，ownership inspection=ok，exact root process tree cleanup 后 residual owned processes=0。

Model Tier: 1
Model: current Codex session
Reason: runtime provenance gate and bounded resolver-result terminology correction; no product flow instrumentation
Escalated: no

结论：harness 已使用 current-main runtime 贯通至 resolver-result；loadfile 仍是明确的 observability gap，不据此判断产品失败。无需升级到产品 flow 调查，不提交、不推送、不发布。

## 2026-09-14 — resolver/loadfile missing static audit

本轮只读审查当前 acceptance harness 与实际 runtime provenance，没有新增 harness 代码、没有修改产品代码，也没有执行第二次真实 acceptance。当前 runner/observer 职责仍清晰：`tests/readiness-acceptance.ps1` 负责 owned root/deadline/cleanup，`tests/acceptance-readiness.js` 只记录产品事实，`tests/live-acceptance-browser.js` 负责 flow gates，`tools/acceptance-readiness.cjs` 负责结果汇总。未发现第二套 event bus 或重复 gate state machine；`tools/acceptance-electron.cjs` 的 `guard` helper 当前未使用，作为后续纯 cleanup 候选保留。

关键 provenance：`tests/readiness-acceptance.ps1` 默认启动 `dist/EmbyTheaterEnhanced-0.1.1-final-win-x64`，该目录时间早于当前 resolver runtime；其 `electronapp/plugins/libmpv.js` 不包含 `strmResolver.resolveAsync`、`STRM resolver: invoked` 或 file-local load option。当前 `src` 与 `dist/EmbyTheaterEnhanced-0.1.1-readiness-b-main-20260914` 的 `libmpv.js` hash 一致，并包含 resolver 调用与 marker。因此上一次真实 run 的 `resolver-enter=missing` 首要分类为 A：实际 acceptance runtime 没有进入 resolver 产品代码，不能据此判断 resolver regression。

当前源码实际链路为 `libmpv.js:647` 的 `await strmResolver.resolveAsync(...)`，resolver 完成后在 `libmpv.js:677` 调用 `logStrmResolverResult`。`tests/acceptance-readiness.js:85` 匹配该完成日志却标记 `resolver-enter`，所以该名称不准确，属于 D；它最多表示 resolver decision/result 已打印，不能证明 entry。`libmpv.js:788-790` 才是当前源码的 `loadfile` command，`sendCommand` 位于 `:1399-1405`。observer 在 `acceptance-readiness.js:33` 依赖收到 command，并在 `:51-58` 尝试覆盖 embed 的 `postMessage`；本次真实报告的 `lastError=embed-command-hook-failed` 证明该 outgoing loadfile 观测不具权威性，形成 OBSERVABILITY GAP。

本次 timeline 显示 observer installed 约 283ms、`play-called` 约 2770ms，因此 C（observer 晚于 resolver）不成立；但 app 的 `data-appmode=standalone` 会在 `www/app.js:1650` 改写 `console.log`，现有 hook 仍有生命周期 race。当前真实样本由 `select` 的 `.strm` 后缀过滤，`strm=true`，容器为 `mkv`/`mp4`，resolver 入口条件成立。PlaybackManager 的 `self.play()` 返回 `playWithIntros` 链；视频 local player 的 `player.play()` 继续等待 libmpv `playForRequest`，后者等待 `playInternal`、core-playing、OSD 与 playing diagnostic，因此 manager-play-resolved 对当前源码可确认是播放 promise 完成，但在 stale runtime 中只证明旧 native play 已完成，不能反推 resolver 曾执行。

本轮不修改产品 instrumentation，不尝试修复 loadfile 的不可靠 outgoing hook，不执行第二次真实 run。下一步最小 harness 修复应先固定/校验 resolver-bearing runtime，再把 resolver gate 改成准确的 result/decision 语义；loadfile 若没有现有可靠 acceptance-only source，继续保持 OBSERVABILITY GAP。

## 2026-09-14 — inspect module acquisition follow-up

保持 `fix/acceptance-readiness`，产品代码继续冻结在 `main@c880b97`；本轮只修改 acceptance flow/report 分类，没有修改 `src/electronapp`、PlaybackManager、libmpv、preload、CD2、Pepper bridge、服务器或配置。对比 PR #2/#4 的历史 flow 后确认，当前 frozen Alameda runtime 已暴露 `window.ConnectionManager`、`window.ApiClient`、`window.Events`；`playbackManager` 没有对应可靠 global。之前的三模块 batch require 与过早注入共同使 inspect 卡在 module resolution。

`tests/live-acceptance-browser.js` 现按最小路径获取对象：有界等待并调用 `window.ConnectionManager.currentApiClient()`（必要时使用 `window.ApiClient`），只对已确认的 `playbackManager` 做一次 `require(['playbackManager'])`，事件对象直接使用 `window.Events`。没有新增通用 AMD resolver、自动扫描、relative-path probe 或 batch require；`tools/acceptance-electron.cjs` 只将 inspect acquisition 摘要提升到报告顶层，`tools/acceptance-readiness.cjs` 增加 API/PlaybackManager/Events 前置分类。observer 保持未改。

实际 acquisition 路径已在 real acceptance artifact 中观察到 `window.ConnectionManager.currentApiClient`、canonical `playbackManager` require 与 `window.Events`；现有可重复 fixture 只覆盖 profile inspect 的 client lookup，没有独立 fixture 证明上述三条 live acquisition 路径。JS/PowerShell syntax、observer self-test、runner synthetic（exact root cleanup/residual 0）、`npm test` 56/56 和 `git diff --check` 通过。

旧 `module-acq-20260914-061651157-ec84996` iteration 中，`inspect=PASS`、`select=PASS`、`play-called=seen`；acquisition 为 `currentApiClient=window.ConnectionManager.currentApiClient/available`、`PlaybackManager=amd-require:playbackManager/available`、`Events=window.Events/available`。随后 `embed-created`、Pepper authoritative-ready 与 `manager-play-resolved` 均被观察到，但 `resolver-enter` 未观察到，flow 以 `resolver-entry-timeout` 停止，`loadfile` 未观察到；没有新增完整 resolver/Session/remote-control/DirectUrl 全链通过结论。runner 最终达到 240000ms bounded deadline，报告存在，ownership inspection=ok，residual owned processes=0，并按 exact root process tree 清理。

Model Tier: 1
Model: current Codex session
Reason: acceptance-only single-module acquisition and report classification; product playback lifecycle remained frozen
Escalated: no

历史结论：该 iteration 的 inspect module acquisition 目标完成并可进入 harness review；完整实服播放验收当时仍停在后续 `resolver-entry-timeout`。

## 2026-09-14 — acceptance readiness runner 与 observer 收敛

保持 `fix/acceptance-readiness`，产品代码冻结在 `main@c880b97`，没有修改 `src/`、PlaybackManager、Session/WebSocket、libmpv、服务器或 CD2 配置。本轮先复用 `.work/run-accept-once.ps1` 已证明的 `ProcessStartInfo` 形状，将 `tests/readiness-acceptance.ps1` 收敛为单次 runner：保存 exact root PID，使用 wall-clock deadline，超时只对该 root 的 owned process tree 执行精确 `taskkill /PID ... /T /F`，始终写入 `runner-result.json`、stdout 和 stderr，并记录 residual owned PID 数；没有按进程名全局清理。

`tests/acceptance-readiness.js` 从 383 LOC 降至 124 LOC。observer 只记录安装时间、`enhancedDiagnostics` wrapper、`ready`/`playing`、mpv embed、bridge message summary、resolver console marker 和可观察到的 loadfile；Pepper authoritative ready 只认 `enhancedDiagnostics(..., 'ready')`，native bootstrap ready 单独记录。AMD module probe 与自建 event bus 已移出/删除，模块解析和六个播放 gate 回到 `tests/live-acceptance-browser.js`；删除了不再需要的 `tests/acceptance-modules.js` 与 `tools/readiness-timeline.cjs`。新增 `tests/acceptance-readiness-selftest.cjs`，不引入测试框架。

静态与合成验证：`npm test` 56/56；修改/新增 JS 与 `tests/readiness-acceptance.ps1` PowerShell syntax PASS；`git diff --check` PASS；observer synthetic self-test PASS；runner synthetic child 写入 stdout/stderr 后在 1.2 秒 deadline 被精确终止，`runner-result=timeout`、runner exit code 124、stdout/stderr 文件存在、ownership inspection=ok、residual owned processes=0。synthetic 的 child process exit code 1 是 taskkill 终止结果，不作为 runner failure 误报。

旧 `single-real` iteration 的 runner 在 47.2 秒内完成，`acceptance.json`、stdout/stderr 均存在，ownership inspection=ok、residual=0；Electron 子进程因 acceptance 失败返回 1，runner 如实返回 1。flow 在 `inspect` 阶段以 `module-resolution-timeout` 结束，没有 `play-called`、embed、Pepper-ready、manager-play-resolved、resolver-enter 或 loadfile 事实，因此没有真实播放/Session/远控通过证据。该次真实运行后仅补充了 flow 的 bare/window AMD loader 兼容尝试，当前代码的该补充只经过静态语法验证。

Model Tier: 2
Model: current Codex session
Reason: Electron process ownership/timeout cleanup and acceptance gate responsibility cross the runner, renderer observer and browser flow; product playback code remains frozen
Escalated: no

结论：runner lifecycle 与 observer synthetic gate 通过，但真实 acceptance 在 harness inspect 前置阶段阻塞；当前为 `NEEDS MORE HARNESS WORK`，不提交、不推送、不发布。

## 2026-09-14 — PR #4 DirectUrl 收尾验证

按已冻结的 PR #4 contract 完成机械回归与分层收尾，没有重做 Sol High review、没有重构 DirectUrl，也没有修改 PlaybackManager ownership、Session/WebSocket、libmpv 生命周期或服务器/CD2 配置。先发现既有 `cd2-direct-url-c` runtime 的 `cd2-service.js` 未包含 same-origin reserve 与显式空 UA fail-closed 修复，未覆盖原目录，改由 `tools/build.ps1` 生成独立 verification runtime（2156 files）；四个关键生产文件与 `src/` 逐 SHA256 一致。

验证结果：`npm test` 56/56；4 条 blocker targeted tests 通过，覆盖 fallback budget、near-expiry reacquire 保留 same-origin 时间窗、reacquire failure fallback 和显式空 UA/非空 header fail-closed；13 个修改/新增 JS、3 个 PowerShell 脚本语法通过，`git diff --check` 通过。新 frozen runtime 的 gRPC/direct response smoke 通过（Electron 18.3.15、Node 16.13.2、grpc-js 1.14.4、proto-loader 0.8.1、0 native addon）；exact Pepper UA-A → UA-B → same-origin C 全部 path/format/core-idle=false/time-pos advancing 且无泄漏；Stop-before-player 通过。

新 runtime 的完整 DirectUrl pipeline 进入 resolver 并观察到 DirectUrl 请求、UA 精确匹配与 no-leak，但在切换第二个 fixture source 时发生 UI smoke timeout，整体 fixture 不记为全链通过。一次有界真实 DirectSmoke 的 inspect/select 通过，但 resolver 阶段 timeout，未进入 bridge；既有成功的真实 DirectUrl + returned UA/expiry + embedded libmpv 播放推进证据保留。上述 readiness/前置 timeout 未证明 DirectUrl 或 same-origin fallback 失败，也未取得新的完整实服 Session/WebSocket/controls/reports 证据。敏感信息扫描仅发现合成 example/localhost fixture，未发现真实凭据、URL/query token、Cookie、路径或 UA。

Model Tier: 1
Model: current Codex session / Luna Max
Reason: contract、验收边界与修改范围已冻结，本轮为测试、frozen runtime、敏感信息审计和文档收尾
Escalated: no

结论：原三个 Sol code blocker 均有当前源码 targeted evidence；acceptance infrastructure blocker 仍存在。PR #4 product code `READY FOR TARGETED FINAL REVIEW`，不 merge、不提交、不发布。

## 2026-09-14 — PR #4 DirectUrl 安全实现与分层验收

从 `main@ba3d7e9` 创建 `feat/cd2-direct-url`。Sol High contract review 先冻结 file-local header、expiry、generation 与 fallback 边界；Luna Max worker 按明确 contract 实现，主线程复核 diff 与验收。DirectUrl 只改变最终 source，PlaybackManager、MediaSource/Item/PlaySessionId、Session/WebSocket、libmpv ownership 与报告链均未改。

exact frozen Pepper 使用字符串 argv 调用 `mpv_command`。隔离 fake HTTP 验证 `loadfile <url> replace -1 user-agent=<value>` 的 UA-A → UA-B → same-origin C 三段均推进且无泄漏。产品实现只允许受限可打印 ASCII UA；任意 additionalHeaders、unsafe UA、malformed URL、invalid/near expiry 与 transport failure 优先 same-origin。DirectUrl 与 fallback 共用 750ms absolute budget，known-expiry 最多重取一次，Abort/Stop/NextTrack 继续取消旧 request 并丢弃 late response；未实现全局 header、provider 特判、后台刷新或 HTTP-error retry。

验证：55/55 unit/fake、修改 JS/PS 语法与 `git diff --check` 通过；frozen fake DirectUrl 一次完整运行覆盖 UA isolation、Pause/Seek/Resume/NextTrack/Stop、generation/cancel 与 19 条报告。真实 persistent profile 的分层 smoke 选取既有 STRM，取得 `sourceKind=direct-url`、returned UA/expiry present、path/format/core-playing/time advancing。完整 PlaybackManager 实服复测连续在 resolver 前 45 秒超时，same-origin 强制 smoke 两次停在 embed `bridge-not-ready`；这些失败没有发送旧 DirectUrl 或证明 fallback 错误，但使 PR #4 保持 NOT READY。未改服务器、CD2 config/mount/cache、账号或网盘数据。

Model Tier: 2
Model: GPT-5.6 Sol High contract/review + GPT-5.6 Luna Max implementation
Reason: file-local header isolation、expiry、generation 与 fallback correctness 跨播放器/main/renderer
Escalated: yes；按项目模型分级执行

## 2026-09-14 — single-prefix mapping 与真实 Emby CD2 验收完成

继续 `feat/cd2-resolver`，没有改产品 resolver、PlaybackManager、Session/WebSocket 或 libmpv。使用同一个 persistent acceptance profile，先对两个有限 STRM 样本做脱敏只读诊断：两个 `Item.Path`/`MediaSource.Path` 关系可由同一条 source-side POSIX prefix → cloud prefix 表示，relative suffix 保持；`mapLocalPath` 的边界、`..` 拒绝和 POSIX case sensitivity 通过。两个候选 CD2 target 均为 regular file，`FindFileByPath` 与 `GetDownloadUrlPath(get_direct_url=false)` 成功，HEAD 200、Range 206、无重定向。实际 mapping 只写入 ignored local acceptance 配置，未进入源码、文档、fixture、acceptance report 或 Git。

使用该 ignored mapping 重跑真实 Emby acceptance。两个样本 resolver 均返回 `type=url`、`reason=cd2_hit`、`source kind=cd2-url`；embedded libmpv/core-playing 与 playback advancing 通过。真实 inspect 为 `logged-in`、非管理员、Session 可见、WebSocket 在线、远控有效；Play、Pause、Seek、Resume、NextTrack、Stop 全部通过，两个 Item/MediaSource/PlaySession identity 由实际开始/停止报告保持，10 条报告全部接受，Stop 后 NowPlayingItem 清空。一次首请求 cold timeout 在重复运行中未复现，最终验收以两个样本均 `cd2_hit` 的重复结果为准。

没有修改服务器、CD2 配置、mount、cache、账号、媒体库或网盘数据；没有新增 multi-mapping、retry、refresh、DirectUrl、headers、音轨或设置 UI。未发现新的跨层生命周期、Session identity 或 PlaybackManager/libmpv correctness 问题，没有升级到 Sol High。

Model Tier: 1
Model: current Codex session
Reason: explicit single-prefix mapping contract and bounded real acceptance rerun
Escalated: no

## 2026-09-14 — persistent profile inspect 修正与 PR #2 真实验收复核

保持 `feat/cd2-resolver`，先复核 worker 未提交 diff，再补充 persistent profile inspect 的 targeted test 和 POSIX Mount 边界回归。`inspectAcceptanceProfile` 现在必须同时取得 API client 并成功解析 `getCurrentUser()` 用户对象才报告 `loggedIn=true`；拒绝、超时、空用户、缺少 API、loader/client 异常统一收敛为安全枚举，结果字段仅有 `loggedIn` 与 `reason`。`accept-live.ps1` 使用 LocalApplicationData 下的固定 acceptance profile，profile 不存在、inspect 失败和手动登录入口均不回显 profile 路径或认证材料。

POSIX 回归确认 absolute `MediaSource.Path` 仍作为 CD2 candidate 发送；CD2 miss 后不会进入 Windows `existsSync` Mount flow。UNC source 仍可在存在时命中 Mount。Node tests 为 43/43，JS/PowerShell 语法和 `git diff --check` 通过；当前工作区源码构建的隔离 runtime 为 2156 个 manifest payload（含 `build-manifest.json` 共 2157 个文件），runtime `mount-resolver.js` 与 source hash 一致并包含 POSIX guard。

同一个 persistent profile 的真实 inspect 返回 `logged-in`。随后真实 Emby acceptance 选择两个 POSIX STRM 样本，inspect、Session/WebSocket、Play、Pause、Seek、Resume、NextTrack、Stop 和 10 条真实播放报告全部通过；resolver 两次记录 `cd2=mapping_miss` → `mount_missing` → native URL。脱敏 select 复核显示两个 `Item.Path` 命中当前 sidecar 前缀，但两个 `MediaSource.Path` 未命中当前 source-side mapping，因此没有把 native fallback 记为真实 CD2 source hit。

当前剩余 blocker 是与实际 `MediaSource.Path` 匹配的 POSIX→CD2 source mapping 未确认。没有修改服务器、CD2、mount、cache、账号、媒体库或网盘数据；没有发现新的跨层生命周期、Session identity 或 PlaybackManager/libmpv correctness 问题，没有升级到 Sol High。

Model Tier: 2
Model: current Codex session
Reason: persistent acceptance, real Emby Session/WebSocket/control evidence, and resolver source-identity boundary
Escalated: no

## 2026-09-13 — PR #2 merge-blocker 修正与真实媒体诊断

保持 `feat/cd2-resolver`，没有同步 `origin/main`，也没有修改另一会话正在维护的 `AGENTS.md` 或 `docs/AI_MODEL_POLICY.md`。本轮关闭三个代码 blocker：仅 terminal `PlaybackManager.prototype.stop()` 增加 request invalidation，新 Play 内部 previous-player stop 不受影响；非 Abort 的 IPC/transport reject 转为安全 `transport_error` miss 后继续 Mount → Native，Abort 仍向上终止；空/缺失 cloudPrefix 为 `missing_mapping`，显式 `/` 保持合法。

真实 Emby 只读选择新增证据：两个 STRM 样本的 Item.Path 与 MediaSource.Path 都是 absolute POSIX，而不是 Windows drive/UNC。现有 ETLP `src→dst` 与 `dst→cloud` 两段单规则可安全折叠。因此单条 mapping 扩展为 Windows drive/UNC 或 absolute POSIX local prefix；Windows/UNC 大小写不敏感，POSIX 大小写敏感，边界与 `..` 检查一致。带 allowlisted 媒体后缀的 absolute POSIX MediaSource.Path 成为确定性 CD2 candidate，在 Windows Mount 中仍自然 miss；未增加第二条 mapping、regex、扫描或自动学习。

targeted tests 为 38/38。独立 frozen Stop-before-player 测试使 PlaybackInfo pending，执行真实 PlaybackManager Stop 后再释放响应，断言 Promise 收束、`player.play` 未调用、无 Playing report。transport reject 分别验证 Mount 与 Native，Abort 不 fallback；cloudPrefix 空/显式 root 与 POSIX 边界均覆盖。完整 CD2 hit、Mount、Native、generation/cancel、双 NextTrack 和报告回归串行通过；其中一次可见 Electron 在 STRM 阶段偶发超时，同参数串行复跑通过并保留失败证据。

真实 CD2 media 诊断使用有限 80 目录/2000 entry 范围内的普通 `mkv-medium`。final frozen runtime 观察到 resolved path 被 mpv 接受、file-format=MKV、13 tracks（1 video/1 audio）、`core-playing` event、`core-idle=false`、cache state/time 与 time-pos 推进，未观察到 EOF/error。Pepper bridge 不暴露 start-file/file-loaded/end-file/log-message，所以 start/end 标记为不可直接观察，file-loaded 由 format+track list 推断。默认音视频轨存在，本轮未处理用户另报的手动音轨问题。

真实 Emby 全链只在独立 media 成功后尝试。两次均在 inspect 阶段返回 `not-logged-in`，未选择播放、未触发 CD2、未产生新 Playing/Progress/Stopped；0 残留进程。因此真实 Emby CD2 hit、Session、WebSocket、controls、reports 保持未验收，原因是当前登录态不可用，不是 media/core-playing 失败。

最终候选与 repeat 各 2156 个 manifest 载荷、0 SHA256 差异、0 runtime native addon。隔离 installer SHA256 与 payload 结果见最新 Packaging/Testing 记录。本轮未修改 CD2 配置、mount、cache、账号、媒体、Emby metadata、权限或服务器配置。

Model Tier: 2
Model: GPT-5.6 Sol
Reason: merge-blocking PlaybackManager race, resolver fallback correctness, real mpv event diagnosis and real Emby acceptance
Escalated: no

## 2026-09-13 — CloudDrive2 Resolver PR #2 实现与验证

从已推送的 `main` 文档基线 `6888780` 创建 `feat/cd2-resolver`。本轮实现 `CD2 same-origin HTTP → Mount → Native`，Transcode 永远 Native；没有实现 DirectUrl、User-Agent/additionalHeaders、expiresIn recovery、115 Open API、refresh/retry、复杂 mapping、设置 UI、自动发现或 cache 管理。

产品实现：精确锁定 `@grpc/grpc-js@1.14.4` 与 `@grpc/proto-loader@0.8.1`；Electron main process 持有 token、proto、channel、metadata 与 active calls，renderer 只通过可信 sender 的 `resolve/cancel` IPC。main 完成同步读取/预加载后立即删除 `process.env` 中全部 `ETE_CD2_*` 输入，防止 renderer 继承 token、origin 或 mapping。V1 使用 Apache-2.0 ETLP beta 快照中的最小 CloudDrive2 1.0.13 wire schema，SHA256 固定；官方下载的 1.0.14 proto 已做 diff，两个 V1 RPC 与关键 field numbers 未变化。单条 mapping 支持 drive/UNC、大小写不敏感、严格边界、拒绝 `..`，cloud path 使用 POSIX normalize。只调用 `FindFileByPath` 与 `GetDownloadUrlPath(get_direct_url=false)`，只接受同 scheme/host/port HTTP(S) URL。

异步生命周期：PlaybackManager build overlay 为每次播放生成 request id，并在异步阶段和 `player.play` 前拒绝 stale request；libmpv 在 `self.play` 开头同步建立 monotonic generation/AbortController。新 Play、NextTrack、Stop、destroy 会 invalidate 旧 generation、取消 active unary call并移除旧 `core-playing` listener；每个 await、fallback、`currentSrc` 与 `loadfile` 前复核。readiness 200ms、Find 350ms、download 300ms 共用 750ms absolute budget；grpc/proto 在 CD2 enabled 时于 main 启动预加载，connection-refused 的 playback 阶段断言在 500ms 内 fallback，冷 require/parse 时间不计入起播 budget。

自动验证：Node 33/33；修改 JS 与 build overlay 输出语法通过。fake HTTP 覆盖 200/206/404/500/timeout/307；fake gRPC 覆盖 found/missing/directory/UNAVAILABLE/deadline/slow/late/malformed/cancel。frozen Electron 18.3.15 / Node 16.13.2 中 grpc-js/proto-loader require、Bearer metadata、两个 unary RPC、same-origin result 和 0 native addon 通过。CD2 hit fixture 验证 7 resolve、3 active cancel、0 active leak，A→B、Stop、旧 core listener、双 NextTrack 只允许最新 source；Play/Pause/Seek/Unpause/NextTrack/Stop、Item/MediaSource/MediaSourceId/PlaySessionId 与 19 条模拟报告保持。CD2 miss → Mount 与 CD2 miss → Native 分别通过。

构建与 installer：最终 `pr2-k/l` 各 2156 个 manifest 载荷，逐文件 SHA256 0 差异；连 build-manifest 共 2157 文件，production closure 为 33 个纯 JS package、0 `.node` addon。隔离 Inno setup 编译成功，SHA256 `7db35eb258a4c245e04c55fc3fa04d34ee18724be650330fdb581ecbf76cd515`；innounp 解包的 2157 个 `{app}` 文件与 `pr2-k` runtime 全部逐哈希一致。本轮未运行 installer 或修改系统安装。

真实 CD2：仅在内存读取既有 token，临时 mapping 命中；最终 frozen runtime 的 `FindFileByPath`、`GetDownloadUrlPath(false)`、same-origin HEAD 200、Range 206、无重定向通过。没有修改 CD2 设置、mount、cache、账号或网盘数据。真实 CD2 source 已在隔离播放器中成为 `currentSrc`，但同一样本在 45 秒内未产生 `core-playing`；因此 real Enhanced CD2 playback 未通过，真实 Emby Session/WebSocket/controls/reports 未执行。两次此类超时均保留在 ignored `.work`，不写入公开敏感细节。

曾有一次并行启动两个可见 Electron fixture 导致 Mount suite 超时；按既有规则清理确认 0 残留进程后串行重跑通过。另有测试编排的 drive-root 与拼写错误在发出媒体请求前安全失败，修正后真实只读 smoke 通过，均未当作产品成功证据。

Model Tier: 2
Model: GPT-5.6 Sol
Reason: main-process gRPC, renderer/main IPC, PlaybackManager and libmpv generation, native fallback and frozen runtime packaging span multiple layers
Escalated: no; this task started at the approved Tier 2 level

## 2026-09-13 — CloudDrive2 Resolver Sol High 架构评审

在 `main == origin/main == 7670d42`、工作区仅有既有调研文档改动的基线上完成 Tier 2 / Sol High 评审。本轮没有修改 `src/`、`package.json`、CD2 配置/mount/cache、Emby/服务器配置或网盘数据，没有执行 refresh、真实 Enhanced 播放、分支、commit、PR、发布或安装。

复用一个现有 115 媒体样本，对同一文件分别执行 `GetDownloadUrlPath(get_direct_url=false/true)`。`false` 返回同源 `downloadUrlPath`，HEAD=200、单字节 Range=206，无重定向和额外 header。`true` 额外返回 provider/external HTTPS DirectUrl、专用 User-Agent 和分钟级 expiresIn，additionalHeaders 为空；裸 URL 的 HEAD/Range 均为 403，携带返回 User-Agent 后 HEAD 仍为 403、Range 为 206，交叉顺序复测两次一致。所有 token、完整 URL/query、媒体名、账号和私人路径只在内存中使用且未输出或落盘。

Transport 结论：固定 `@grpc/grpc-js@1.14.4` + `@grpc/proto-loader@0.8.1`，放在 Electron main process，通过窄 IPC 服务 renderer。临时隔离 smoke 使用随包 Electron 18.3.15 / Node 16.13.2、repo proto 1.0.13 调用 runtime 1.0.15，Bearer metadata、unary RPC、deadline 和 insecure localhost HTTP/2 成功，无 native addon。`grpc-web` 因 wire protocol 不同且需要代理而不采用。临时依赖只位于 ignored `.work`，完成后清理。

架构结论：115 DirectUrl 分类为 Level B，但因专用 User-Agent、分钟级有效期及当前 Pepper bridge 只能把 command 参数转成字符串，DirectUrl 不进入 V1。PR #2 建议实现 `CD2 same-origin HTTP → Mount → Native`；Transcode 永远 Native。异步接入必须在 PlaybackManager 与 libmpv 之间共享单调 generation/request id，Stop/NextTrack/新播放立即取消旧请求，并在每个 await 后和最终 `loadfile` 前拒绝 stale response。建议总 lookup budget 750ms，不 retry、不 refresh、不持久或跨播放缓存 URL。

Model Tier: 2
Model: GPT-5.6 Sol
Reason: gRPC packaging, proto/runtime drift, provider HTTP headers/expiry, PlaybackManager/libmpv asynchronous lifecycle and native fallback span multiple layers
Escalated: yes, from the prior Tier 1 research

## 2026-09-13 — CloudDrive2 Resolver 调研完成

按当前主线任务书优先审计 `hope140/embyToLocalPlayer` 的 `beta` 分支，研究快照为 `54b2abae0537f1b4c65752edaac059d3cda4790e`。本轮只做设计和只读验证，没有修改 Enhanced 产品源码，没有执行 CD2 refresh，没有进行 Enhanced + CD2 实际播放集成，也没有修改本机 CD2 配置、挂载、账号或媒体数据。

新增 `docs/CD2_RESEARCH.md`，记录 ETLP 的完整 STRM → local path → path_map → gRPC → HTTP download URL → 外置播放器调用链，以及路径推导、mapping、refresh、headers/Range/auth、fallback、禁止迁移逻辑、Enhanced V1/V2 边界和 fake/real 测试方案。

本机只读结果：CloudDrive2 service 为 Running/Automatic，运行时 RPC 版本为 1.0.15；19798 的 HTTP 与 gRPC 可用，配置中的 19799 在探测时未监听；存在一个已挂载的 Windows drive-letter mount。使用运行 ETLP 配置的现有 token 仅在内存中查询一个媒体样本，`FindFileByPath`、`GetDownloadUrlPath` 成功，返回同源 HTTP URL；HEAD=200，单字节 Range=206，支持 `Accept-Ranges: bytes`，本次没有额外 HTTP headers 和重定向。当前 ETLP 一条 path_map 对该样本没有命中，因此 mapping 是后续实机命中的前置条件。敏感 token、URL、路径、账号和媒体名未写入文档。

ETLP beta 的 CD2 client/gateway 测试使用 fake/stub，`test_strm_media_path`、`test_clouddrive2_client`、`test_clouddrive2_gateway` 通过。当前结论为 **Need Sol High review**，原因是 Python cp39-win32 `grpcio` 与 Enhanced Node/Electron 不兼容，以及 proto/runtime 漂移、Range/临时 URL、可选动态 headers、refresh stream 和 PlaybackManager source-only 接入存在跨层风险。调研完成后按任务要求停止，等待主线程审核。

Model Tier: 1
Model: GPT-5（当前 Codex 会话）
Reason: research contract and evidence boundary were explicit; implementation was intentionally out of scope
Escalated: no

## 2026-09-13 — PR #1 边界修正与真实 native smoke

根据主线程复核修正当前 PR 的两个边界：Mount 规则改为按优先级逐条生成并立即执行 `existsSync`，高优先级 sidecar 命中不会被后续 sourcePath 解析失败推翻；候选扩展改为明确音视频 allowlist，`.txt`、`.nfo` 等文件即使存在也不作为 Mount source。

新增回归覆盖 malformed/unsupported sourcePath 的优先级短路和非媒体扩展误命中。Node 单元测试 19/19 通过；包含修正的隔离 frozen Electron runtime native fallback 与 Mount-hit 两套测试通过，PlaybackManager、Session/control 和 20 条模拟报告保持通过。

随后使用现有 Enhanced 登录态进行最小真实 Emby smoke。只读检查确认非管理员、WebSocket 在线，选取 2 个 STRM 样本；样本 `Container=mp4`，`MediaSource.Path` 为当前规则不可解析的 other 形态。实际播放为 DirectStream，最终 source 类型为 URL，证明本次真实播放走 native fallback；Play、Pause、Seek、Unpause、NextTrack、Stop 全部通过，10 条播放报告被接受，停止后状态清理通过。当前条件没有自然 Mount 映射，real Emby Mount hit pending；未修改服务器配置、媒体库、权限、元数据或用户认证材料，未写入公开 evidence。

Model Tier: 1
Model: GPT-5.6 Luna Max
Reason: boundary corrections were explicit and the real smoke reused the existing acceptance harness
Escalated: no

## 2026-09-13 — STRM Mount Resolver 第一版

按用户确认的 `feat/strm-mount-resolver` 规格，在 repo-local Git identity `hope140 <hope140y@outlook.com>` 下实现最小确定性 STRM Mount Resolver。Resolver 只在 `libmpv.playInternal(options)` 的最终 `loadfile` 前替换 source，继续沿用 PlaybackManager、Item、MediaSource、PlaySessionId、字幕/音轨、offset、播放上报和远控链路。

完成内容：

- 新增 `src/electronapp/resolvers/strm-resolver.js`，按 `Item.Path` `.strm` 后缀或 `MediaSource.Container=strm` 判定 STRM，并统一 native fallback。
- 新增 `src/electronapp/resolvers/mount-resolver.js`，依次支持 sidecar stem、明确 Windows/UNC `sourcePath`、URL pathname 文件名及 `name`/`filename`/`file_name`，仅 `existsSync` 命中才返回 local。
- Transcode、缺字段、非法 URL、解码异常、文件不存在和 Resolver 异常均保留 `options.url`；诊断只记录脱敏的类型、reason、存在性和 fallback 状态。
- 扩展 Node 单元测试和隔离 PlaybackManager runtime 夹具，覆盖普通媒体、STRM native fallback、Mount 命中、Session/control 状态保持和 20 条模拟上报。

验证：Node 单元测试 17/17 通过；修改 JS 与 PowerShell 语法检查通过；隔离 frozen Electron 的普通视频、STRM Mount、PlaybackManager 上报、Pause/Seek/Unpause/Stop/NextTrack 通过。隔离 runtime 不是真实 Emby 服务器 Mount 验收，真实 Mount 样本、字幕/音轨差异、换流重入和长时间稳定性仍待实机验证。没有实现 CD2、外部播放器、Session 模拟或服务器改动。

Model Tier: 1
Model: GPT-5.6 Luna Max
Reason: task contract and acceptance criteria were already explicit
Escalated: no

## 2026-09-13 — 开源基线与模型策略

建立公开源代码基线的许可证和公开范围：官方 Windows/Electron 对照仓库均为 GPL v2，维护源码未证明 `or later` 授权，故新增根 `LICENSE` 并采用 GPL-2.0-only。新增 `THIRD_PARTY_NOTICES.md`、`docs/LICENSING.md`，将 vendor 输入、二进制、构建产物和 E 类完整离线 Web snapshot 排除在首个公开提交外。更新 README 的非官方声明、`.gitignore`、测试输出路径与真实验收文档表述；没有修改播放、Session、libmpv 或 Resolver。

新增 `docs/AI_MODEL_POLICY.md`，并在 AGENTS/DECISIONS 中固定 Tier 1 默认、Tier 2/3 升降级规则与重要任务留痕字段。敏感信息扫描未发现待公开文件中的实际认证材料；测试中仅有刻意构造的脱敏样例。

Model Tier: policy
Model: current Codex session
Reason: licensing evidence, public-boundary audit, and acceptance-document reconciliation
Escalated: no

本轮建立本地 `main` 的公开源代码基线并创建带注释的 `v0.1.1-baseline` 标签；没有配置 remote、推送或创建 GitHub Release。提交只包含已审计范围，提交署名使用项目中性 noreply 地址而非本机个人 Git 身份。

公开审核清理后，确认用户提供的 GitHub remote 无既有 branch/tag，再以普通 fast-forward 初次推送 `main` 和 `v0.1.1-baseline`。没有 force push，也没有创建 GitHub Release。公开版本移除了真实媒体样本名称、内部 Item/MediaSource/PlaySession 标识及其原始 JSON evidence；补充 source-governance baseline 的不可独立构建说明，并审计公开 B 类文本代码的 GPL 修改声明。

## 2026-09-13 — 真实 STRM 与后台控制验收完成

用户登录非管理员账号，授权任意库内影视并说明全库 STRM；WatchTogether 按后台控制正常验收。只查有限候选并使用两个不同 STRM 样本。真实 DirectStream 播放、服务端进度、Pause/Seek 60 秒/Unpause/NextTrack/Stop 均通过；10 条真实播放报告全部被接受，逐 Item 的 MediaSource/PlaySession 一致。另做可见画面检查，确认 gpu-next、d3d11va 与正确 3GiB 缓存诊断。

新增 live 验收工具，凭据仅由原客户端读取，不输出、不复制。初次工具 app name 错用 package.name，导致 HTTP/WS Session 分裂；改用 productName 后完整通过，没有改产品源码或服务器权限。通过报告按白名单沉淀为 docs/evidence/live-acceptance.json。保留用户播放进度，停止测试播放并恢复普通启动。0.1.1 构建哈希不变，无需重建。第一轮按最新用户确认口径关闭；普通文件库内无样本、HDR和插件双端同步精度未覆盖，Git提交发布未授权。

## 2026-09-13 — 最终证据整理

补齐 `docs/evidence/first-round-followup.json`，记录实际媒体测试、客户端 fixture 上报、诊断、安装/覆盖/卸载和最终安装包 SHA256。复核测试安装目录与注册表记录已移除、无测试 host 残留、个人 mpv.conf 哈希未变。0.1.1 最终 runtime 与重复构建 1013 文件一致；安装包实际解包 1012 载荷全匹配。继续入口是用户登录并指定真实样本，无需重复已通过的本地测试。

## 2026-09-12 — 第一轮继续收尾，0.1.1

用户指出仍有本地工作可推进，要求继续完成第一轮。先修正上一轮“本地可做的工作全部完成”的过满表述，继续处理已知问题。随后用户表示会自行登录 Enhanced 并指定真实样本，并明确授权独立测试目录安装/覆盖/卸载。

完成：

- 同一个实际 embed 上核对 900/2048/3072/4096/8192MiB，证明 native 缓存属性正确，bridge 回传 int32 截断。诊断改为自有瞬态 user-data 文本快照，安全整数验证后记录精确值及 legacyValue；读取前清空元数据槽，防止失败后误读旧值。
- 回复直接限定到目标 embed，同 embed 的 ready/playing 采集串行；unsupported、超时仍不阻塞播放。空 shader 数组正确记录 configured=false。
- 依据该 mpv revision 的源码确认 Windows Known Folder 默认路径，测试改用子进程 MPV_HOME；bilinear 与配置标记已实测通过。正式启动未改画质或个人配置。
- 新增真实 PlaybackManager、ApiClient 播放报告序列化及 input/api.js 消息分派的 fixture 集成测试。普通视频和 STRM 两项均 DirectPlay；source 与 Item.Path 保留；开始/进度/停止报告的 ItemId/MediaSourceId/PlaySessionId 一致；Pause/Seek/Unpause/Stop 和 NextTrack 全部通过，共收集 20 条模拟上报。
- 单元测试 8/8 通过；最终修改 JS 语法检查通过。新版独立合成视频与配置/容量测试通过。原 Windows host 启动检查通过，1 host + 4 Electron 进程与诊断日志存在。
- 0.1.1 runtime 重复构建 1013 文件 SHA256 全一致；安装包 123972095 bytes，SHA256 `84bfd2970d6d31277fe43fffdd9f1b20f608458d070986a62d318181d3bd5701`；解包与实际安装均核对 1012 个载荷文件。
- 在授权独立目录先安装 0.1.0，再覆盖到 0.1.1；注册表版本/路径、桌面与开始菜单快捷方式通过。实际执行已安装快捷方式，launcher exit=0，Windows host/Electron/诊断日志通过。卸载 exit=0，目录/注册表/快捷方式均清理；新建的 Enhanced profile 保留供后续登录，个人 mpv.conf SHA256 未变。

测试期间发现的夹具问题及边界：未提供 Windows host 的 Electron-only fixture 不能依赖 localhost:8154 文件探测，因此使用随机 localhost HTTP 媒体源；HTTP endpoint 标记错误时走 DirectStream 请求不存在的 fixture API，修正输入后通过。未登录场景的 OSD 导航单独替换，其他产品播放链未改。一次 UI 与 host 测试并行后启动超时，后续媒体验证顺序执行成功。保留失败证据，不把它们写成产品功能验收成功。

尚待真实 Emby 普通视频/STRM、实际 Session/WebSocket、后台远控与 WatchTogether；用户将登录并指定样本。没有创建 Git 仓库、commit、PR 或远端发布。所有真实服务器操作仍等待样本范围。

## 2026-09-12 — 第一轮本地准备与开发

任务输入为第一阶段任务书及本地两个归档。开始时目录只有 SFX 与综合补丁 ZIP，没有 Git 仓库、分支或提交。按本地开发范围执行，未将任务书的 commit 示例视为授权。

完成工作：

1. 保存原件并核对 SHA256，Carnival 解包 1234 条目/1009 文件、补丁 51 文件；未执行原安装/恢复脚本。
2. 下载固定官方参考，逐文件分类，22 A / 29 B / 126 C / 17 D / 815 E；导入可维护 src/electronapp，vendor 只读及忽略规则。
3. 吸收已核验 toast、apiclient、3072MiB 选项和新版 libmpv；建立 prepare/build/package/installer/启动入口。
4. 禁用外置自动注册和模块实例调用；保留旧代码、Remote Control 与 shared shell。
5. 建立运行时版本与 ready/playing 容错诊断、日志脱敏和 4 项单元测试。
6. 完成播放链、Session/WebSocket、外置禁用、libmpv 与未来 Resolver 插入点文档。

实际验证：

- PowerShell 5.1 构建成功；重复构建载荷 1013 文件全哈希一致。
- Inno Setup 6.7.3 编译成功，setup 123990793 bytes，SHA256 `f120c2b0f4ba46e8153bcb451e9cb0a06fee1a2987753c303965c0177a2dfb66`。
- 安装包解包后 1012 个载荷文件全哈希匹配。未运行安装器。
- Electron 启动、离线 Web UI、插件列表检查通过，启动截图已查看。版本 18.3.15 / Chromium 100.0.4896.160 / Node 16.13.2。
- 独立 libmpv 插件合成媒体播放推进、pause、seek、resume、stop 5 项通过；取得实际 GPU 与视频输出属性。
- 原 .NET host 在唯一测试副本运行，10 秒后 host 存活、4 个 Electron 进程、诊断日志存在；退出时只终止该副本内的进程。
- DLL probe 得到 API 2.5、mpv v0.41.0-920-gdd5d17d32；unsupported 版本属性如实返回 unavailable。
- 诊断与外置禁用测试 4/4 通过；修改 JS 语法检查通过。

处理中发现并保留的证据：

- PowerShell 5.1 默认编码误读中文 manifest 文件名，构建改为显式 UTF8 后成功。
- 隐藏窗口合成媒体超时；可见窗口成功。
- 首次可见媒体测试使用已注册插件，停止事件进入需要 API client 的 PlaybackManager，未登录上下文抛 getSavedEndpointInfo；测试改为独立实例后全部动作通过。产品 PlaybackManager 未因此修改。
- 临时 APPDATA 不能证明 native mpv 配置隔离；ready 值与现有用户配置对应。个人 mpv.conf 未修改。
- demuxer-max-bytes 回报 -1073741824，疑似 bridge 32 位数值回报问题，实际缓存影响待查。

尚未完成：系统安装/升级/卸载、真实 Emby 普通视频和 STRM、真实后台 Session 与远控、EmbyWatchTogether、完整 mpv.conf 路径追踪和画质效果验收。第一轮处于本地开发完成、真实验收待关闭的状态。

Commit 列表：空。未初始化 Git，未提交、推送、创建 PR、发布或修改服务器。
