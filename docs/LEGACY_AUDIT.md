# Legacy Audit

审计日期：2026-09-14（UTC+8）
审计基线：`main@65d97da975ea1ffc3505c099094086c33667931e`
执行分支：`cleanup/external-player-process-chain`
审计范围：Foundation Cleanup / Legacy Cleanup Batch 2；本文件同时保留 Batch 1 的历史执行记录。本批只处理 External Player process-control chain，不重构播放链、不升级 Electron/mpv、不运行 Carnival 或综合补丁安装/恢复脚本。

## 2026-09-14 — Cleanup Batch 2：External Player process-control chain

本轮重新检查了 `rg`、IPC registration、`electronapphost` protocol dispatch、动态 command string、preload exposure、shell consumer、main caller、tests 和 build/package 输入。结论是旧 External Player frontend/plugin 已在 Batch 1 从 fresh runtime 排除，以下 host/process consumer 均已消失，允许删除对应 producer 和 process-only contract。

| 候选 | producer | consumer / entry point | shared consumer | 当前可达性 | 结果 |
|---|---|---|---|---|---|
| `mpvPosEvent`、`mpvPos`、`mpv-socket` | `main.js` 的旧 `net.Socket`、timer、`ipcMain.handle` 和 `webContents.send` | 旧 vendor plugin 的 `window.ipc.invoke/on` 与外置 mpv pipe 参数；当前维护层无 entry | `window.ipc` 仍由 CD2 resolve/cancel 与 diagnostics 使用，但不依赖这些 channel | 无当前 producer/consumer | **REMOVED** |
| `shell.canExec`、`shell.exec`、`shell.close`、close-event helpers | `src/electronapp/shell.js` custom shell module | 旧 plugin 的 `getPlayer`、外置 exe 启动和关闭回调；当前 custom shell 无其它调用者 | 同一模块的 `shell.openUrl` 仍被 4 类 Web module 使用 | process-only slice 不可达；`openUrl` 保持可达 | **REMOVED** |
| `electronapphost://shellstart`、`shellclose` | `shell.exec/close` 生成的 protocol URL；`main.js` 的 command cases | 只进入旧 `startProcess/closeProcess` dispatch | 同一 host protocol 仍承载 openurl、窗口状态、sleep/shutdown、audio/video lock、loaded、CEC 等 active commands | 无当前 entry | **REMOVED** |
| `processes`、`startProcess`、`closeProcess`、`execFile` callback chain | `main.js` 的 process map/helper | 只被 `shellstart/shellclose` cases 调用 | Anime4K 使用独立的 `child_process.exec('notepad.exe …')`；CEC/refresh-rate 使用各自的 process path | 无当前 caller | **REMOVED** |

明确保留：`shell.openUrl`、generic `window.ipc` bridge、CD2/diagnostics IPC、CEC、Pepper/libmpv、PlaybackManager、Session/remote control、resolver 和 native fallback。`src/electronapp/www/modules/shell.js` 的浏览器 fallback 仍是独立的 `openUrl`/unsupported-exec implementation，不等于 Electron custom shell 的外置进程 contract；本轮未改动它。

vendor/carnival 中的旧 main/shell/plugin 文本仍作为只读来源保留，fresh Enhanced runtime 不复制 External Player frontend，维护产品代码和新 runtime 中上述 active process chain 为 0。settings/autoplay、PlaybackManager external-player guards、shared locale/CSS、`external/` 和 vendor helper 仍留在后续范围。

## Executive Summary

本轮覆盖任务书要求的 8 个主领域 A–H，并对 External Player、CEC、Shell/Exec、IPC/Named Pipe、Settings/Routes、Packaging、Platform Compatibility 及 Foundation 资产做了交叉引用审计。审计同时检查了当前可维护层 `src/electronapp`、本地忽略的离线 Web snapshot、只读 `vendor/carnival` / `vendor/patch`、构建/安装规则和现有验证文档。

主要结论：

- External Player 的默认注册已关闭，维护版模块此前提供的防护与 41 个本地 ignored frontend 文件均已处理；Batch 1 现在还由 tracked build-time patch 在 fresh runtime 中强制移除 Electron registration，source snapshot 存在与否结果一致。vendor 原件仍只读保留。
- `mpvPosEvent`、`mpv-socket` named pipe、`mpvPos` 回传及其 main-process producer 已在 Batch 2 删除；旧 vendor 文本只读保留，维护产品代码和 fresh runtime 不再有 active reference。
- `src/electronapp/shell.js` 仍保留 shared `openUrl`。`canExec`、`exec`、`close`、close-event helpers、`shellstart` / `shellclose` 以及 `startProcess` / `closeProcess` process chain 已确认只有旧 External Player consumer，现已删除。
- CEC 不是死代码。Electron 启动时动态加载 `plugins/cec.js`，插件构造时请求 `electroncec://start`，main process 会加载 `cec/cec.js` 并连接输入事件。CEC 应 KEEP；driver installer、重复二进制别名和普通启动时的可执行文件参数仍需额外证据。
- Pepper/PPAPI、内嵌 libmpv、Electron 18、PlaybackManager、Session/PlaySession、remoteplayer、resolver、CD2、Mount、DirectUrl、preload diagnostics、readiness harness 和 runtime provenance 均属于 KEEP 或 DEFER，不能按“历史代码”删除。
- `tools/build.ps1` 仍校验并复制全部 1009 个 Carnival 文件，但 Batch 1 已加入纯 External Player frontend exclusion；`installer/EmbyTheaterEnhanced.iss` 继续递归复制最终 runtime。其它 helper、CEC、external/ 和 main-process 残余仍未清理。

结论：**Batch 1 frontend/plugin layer REMOVED；Batch 2 External Player process-control chain REMOVED**。本轮保留 generic IPC、shared `shell.openUrl`、播放/Session/remote control、CEC 和 Anime4K helper；settings/autoplay/PlaybackManager residue 仍未处理。

### Provenance portability follow-up

Batch 1 review 发现 ignored Web snapshot 会造成 provenance 随开发机状态变化。修复方案是让 `tools/runtime-provenance.cjs` 对精确前缀 `src/electronapp/www/modules/externalplayer/` 做 intentional source exclusion，并将该 contract 写入 `validatedProductScope.excludedSourcePrefixes`；source subtree 存在或不存在时产品 scope 相同，其他 source file 仍保持 full provenance 校验。

Local audit workspace：本机曾删除 41 个 ignored snapshot files。
Durable repository/product behavior：`runtime-provenance.cjs` 与 `build.ps1` 共同保证该 frontend 无论本地 ignored snapshot 是否存在，都不会进入 fresh Enhanced runtime；vendor 原件仍只读保留。

本轮最后的 portability 修复新增 `tools/patch-external-player-registration.cjs`，只处理 `responses.electron && list.push("modules/externalplayer/plugin")` 这一 Electron registration；`tools/build.ps1` 在 source overlay 后执行它，再排除 frontend directory。`electronapp/www/app.js` 在 source scope 中按受控 build overlay 记录 generator/runtime hash；source app.js 缺失时以 vendor fallback runtime overlay 记录 `sourcePresent=false`，不把整个 app.js 排除出 provenance。

## Audit Basis and Evidence Rules

已核对的项目文档包括：

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATUS.md`
- `docs/PLAYBACK_PIPELINE.md`
- `docs/EXTERNAL_PLAYER_REMOVAL.md`
- `docs/LIBMPV_RUNTIME.md`
- `docs/MODIFIED_UPSTREAM_FILES.md`
- `docs/PACKAGING.md`
- `docs/LESSONS_LEARNED.md`
- 相关边界文档 `docs/DECISIONS.md`、`docs/CARNIVAL_BASELINE.md`、`docs/TESTING.md`

证据分层：

1. **静态事实**：当前 `main` 源码、当前本地 Web snapshot、vendor manifest、build/package/installer 规则中的实际引用和入口。
2. **隔离 runtime 事实**：项目既有测试与文档中记录的 frozen Electron / plugin list / resolver / fallback 证据。本轮不把它们升级为真实 Emby 验收。
3. **真实 Emby / 远控事实**：本轮按 Batch 1 contract 执行了一次有界 inspect/select/play/pause/seek/resume/stop 回归；没有设置迁移或服务器配置变更。

需要特别注意：`src/electronapp/www/`、`src/electronapp/preload.js`、`src/electronapp/package.json`、`vendor/carnival/`、`vendor/patch/` 和 `dist/` 由 `.gitignore` 排除，但它们确实是当前本地构建输入或验证产物。只检查 Git tracked 文件会漏掉本轮要求审计的 Web、preload 和 vendor 内容；本清单明确把 ignored input 纳入证据，同时不把它们改写为公开源码事实。

## KEEP

| 区域 | 当前证据 | 结论 |
|---|---|---|
| PlaybackManager、Item、MediaSource、PlaySession、进度、队列和远控生命周期 | `docs/ARCHITECTURE.md`、`docs/PLAYBACK_PIPELINE.md`；当前 PlaybackManager 仍处理普通媒体、STRM、换集和上报 | KEEP。删除外置分支时也必须保留身份链和 native fallback |
| 内嵌 libmpv、Pepper bridge、`libmpv.js` | `src/electronapp/main.js:837-883` 注册 Pepper；`src/electronapp/plugins/libmpv.js` 通过 PlaybackManager 播放并接入 resolver | KEEP。它是当前正式视频路径，也是未来 Player Adapter / Runtime Modernization 的边界 |
| `src/electronapp/preload.js` 的通用 IPC 暴露 | `preload.js:1-14` 暴露 `window.ipc`、`window.fs` 和 diagnostics；`resolvers/cd2-resolver.js` 使用 `window.ipc.invoke/send` 进行 CD2 | KEEP。Batch 2 只删除 dead channel，generic `window.ipc` 继续保留 |
| CD2、DirectUrl、Mount、STRM resolver | `src/electronapp/resolvers/*`、`src/electronapp/enhanced/*`；当前文档记录了 fallback、generation、mapping 和 header 隔离 | KEEP。属于当前 Foundation，不能与 External Player 一起清理 |
| Session / `remoteplayer` / WebSocket / input API / reports | `www/modules/sessionplayer.js`、`www/modules/common/input/api.js` 以及 `docs/SESSION_CONTROL.md`；现有真实控制证据通过 | KEEP。remoteplayer 是 Emby Session 控制，不是旧 mpv named pipe |
| `electronapphost` 总协议和 `apphost.js` | `src/electronapp/apphost.js:17-23,99-117`；`main.js` 仍承载 window state、sleep、shutdown、openurl、video/audio lock、loaded 和 CEC | KEEP。Batch 2 只删除已证明无调用者的 shell process cases |
| `shell.openUrl` | `src/electronapp/shell.js:69-71`；IAP、metadata editor、registration services、通用 `emby-button` 均调用 | KEEP。它是 shared shell 能力 |
| CEC 插件和输入映射 | `src/electronapp/plugins/cec.js:1-44`、`src/electronapp/cec/cec.js`、`command-map.js`；默认插件目录加载会触发启动 | KEEP。CEC 可以另行设计独立开关，但本轮无删除依据 |
| 构建 provenance、readiness harness、诊断和测试工具 | `tools/runtime-provenance.cjs`、`tests/readiness-acceptance.ps1`、`src/electronapp/enhanced/diagnostics.js` | KEEP。它们是验证边界和回归证据，不是产品死代码 |
| vendor manifest、原始归档和相对目录布局 | `vendor/README.md`、`docs/PACKAGING.md`；构建依赖完整 manifest 和相对路径 | KEEP as read-only input。清理应在生成 runtime / packaging 层表达 |

明确保留清单：`PlaybackManager`、embedded libmpv、Pepper bridge、Session / PlaySession / reports、`remoteplayer`、resolver、CD2、DirectUrl、Mount、preload diagnostics、readiness harness、runtime provenance、`electronapphost`、shared `shell.openUrl`。

## REMOVED

以下项目已在 Batch 1 完成物理删除或生成 runtime 排除。vendor 原件仍按项目规则只读保留。

### REMOVED-01 — External Player 模块 payload

- 路径：`src/electronapp/www/modules/externalplayer/**`，本地 ignored snapshot 中 41 个文件、77,725 bytes，已逐文件删除。
- vendor 原始版本为 41 个文件、约 77,251 bytes；其中包含 plugin、两个 HTML、两个 controller 和 36 个 locale 文件。
- `src/electronapp/www/app.js` 中失效的 Electron registration remnant 已从当前本地 snapshot 移除；tracked `patch-external-player-registration.cjs` 负责跨工作区重复关闭该 registration。
- `pluginManager` 只有在插件实际加载后才调用 `getRoutes`；当前 plugin 文件已不存在，旧 route/controller 也随目录删除。
- `src/electronapp/main.js:628-655` 只从 `electronapp/plugins` 顶层枚举 `.js` 形成 `startInfo.plugins`；External Player 位于 `www/modules`，不在默认动态插件目录。当前顶层插件是 CEC 和 libmpv。
- fresh runtime 的 `electronapp/www/modules/externalplayer/**` entries 为 0，`electronapp/www/app.js` 的 registration 由受控 overlay 生成并验证。

判定：**REMOVED**。`tools/build.ps1` 的 exclusion 防止 vendor 全量复制重新带回该目录；vendor 原件未修改。

### REMOVED-02 — External Player route/controller surface

- `externalplayer.html`、`externalplayers.html`、`externalplayer.js`、`externalplayers.js` 和 module locale 已随 `REMOVED-01` 删除。
- 旧 plugin 的 `getRoutes`、controller path 和 `pluginManager.mapRoute("externalplayer", ...)` 只存在于已删除模块的自引用中。
- shared `www/strings` locale、settings/playback、item autoplay 和 PlaybackManager guard 未在 Batch 1 删除，继续保留到后续 UI/shared cleanup。

判定：**REMOVED**。剩余同名文本不形成指向已删除模块的可解析 runtime path。

## REMOVED — Cleanup Batch 2

### REMOVED-03 — `mpvPosEvent` / named pipe 进度辅助

- 原 producer/entry 是 `src/electronapp/main.js` 的 `net.Socket`、`ipcMain.handle('mpvPosEvent')`、Windows/POSIX named pipe、playback-time timer 和 `webContents.send('mpvPos', ...)`。
- 唯一旧 consumer 是已从 fresh runtime 排除的 External Player plugin；当前维护产品代码没有该 channel、socket path 或回传 consumer。
- 删除只移除了 specific dead channel；`preload.js` 的 `window.ipc`、CD2 resolve/cancel 和 diagnostics IPC 保持不变。

判定：**REMOVED**。vendor 原件中的旧文本仍按只读来源保留。

### REMOVED-04 — Shell 的外置进程切片

- `src/electronapp/shell.js` 现在只保留 `shell.openUrl` 与 `electronapphost://openurl` request contract。
- `shell.canExec`、`shell.exec`、`shell.close`、`getProcessClosePromise`、`onChildProcessClosed`、`shellstart`、`shellclose`、`processes`、`startProcess`、`closeProcess` 和旧 `execFile` callback chain 已删除。
- 同一 `electronapphost` dispatcher 的 window state、sleep/shutdown、audio/video lock、loaded 和 CEC command cases 保持不变。
- `main.js` 的 `child_process.exec('notepad.exe ...')` 仍是 Anime4K 配置辅助，不属于本批删除的 external process chain。

判定：**REMOVED**。`shell.openUrl` 的 4 类活动 Web consumer 和浏览器 fallback 未被改动。

## REMAINING DELETE CANDIDATE（Batch 2 后）

以下是本批之后仍存在、但按任务边界没有删除的候选。

### DC-04 — Shared settings/locale residue（保留）

具备候选条件的子范围：

- External Player 专属 HTML、controller 和 module locale 已在 `REMOVED-02` 处理，不在本项重复计入。
- `src/electronapp/www/modules/emby-elements/emby-checkbox/emby-checkbox.css:167-182` 的 `ExternalPlayerSwitch` selector 只在该 CSS 中找到，没有当前 HTML class consumer。
- 50 个 `www/strings` locale 文件仍有 `HeaderSelectExternalPlayer` / `HeaderExternalPlayerPlayback`；43 个文件仍有 `EnableExternalVideoPlayers` / `EnableExternalVideoPlayersHelp`。这些是共享 locale bundle 中的 key，不应在没有 key-level 回归前按整个文件删除。

判定：模块专属 route/controller/locale **REMOVED**；共享 locale key 与 CSS 仍是 **REMAINS / 条件候选**，放后续 UI/shared cleanup，先完成 settings/autoplay 回归。

### DC-05 — 旧 root helper 的 packaging exclusion（保留）

- `vendor/carnival/Emby.ConfigureAndUninstall.bat`：11,504 bytes。
- `vendor/carnival/Emby.Dialog.bat`：2,365 bytes。
- 两者都位于 Carnival root，`tools/build.ps1:27` 全量复制，因此会进入 runtime；`installer/EmbyTheaterEnhanced.iss:32-33` 又递归打包。
- 当前 Electron/Enhanced 源码没有调用者；脚本内容是旧配置/权限/缓存/Anime4K/SVP/卸载菜单，其中 Configure 脚本还包含递归删除用户目录和旧应用目录的动作。

判定：**REMAINS / DELETE CANDIDATE，保留到后续批次**。由于脚本可能被旧用户手工使用，本轮不改变 payload；未来若排除，仍应只改 Enhanced packaging，不修改或运行 vendor 原件。

## DEFER

### D-01 — Pepper / PPAPI / Electron 18 / Player Adapter 边界

- `src/electronapp/main.js:837-883` 注册 Pepper plugin，`plugins/libmpv.js` 依赖 `application/x-mpvjs`，`preload.js` 与 frozen Electron 18.3.15 共同组成当前播放入口。
- 当前实际运行环境是 Electron 18.3.15 / Chromium 100 / Node 16.13.2；`src/electronapp/package.json` 的 Electron `^9.4.0` 只是历史开发依赖声明，不能据此升级或删除 runtime。
- 未来处理边界应是 Player Adapter、Pepper bridge 和 runtime modernization；本轮不能把任何 PPAPI、libmpv 或 Electron compatibility 文件标 DELETE CANDIDATE。

### D-02 — 共享平台分支

- `www/app.js:2075-2099` 保留 Android、iOS、Windows、Tizen、WinJS 等分支；它是共享 Web runtime，不能因为 near-term 是 Windows only 就整段删除。
- `src/electronapp/main.js:837-858`、`getPluginEntry` 的 Linux/Windows 分支与 `is-linux`、`is-windows`、`detect-rpi` 仍参与启动和 Pepper path 选择。
- `power-off` / `sleep-mode` 使用 `is-osx`、`is-linux`、`is-windows` 作为 shared dependency；`is-osx` 不能仅按 Windows 当前场景移除。

判定：DEFER 到 Electron/runtime modernization，并以独立平台 smoke 作为前置证据。

### D-03 — PlaybackManager 中的 external player guards

`www/modules/common/playback/playbackmanager.js:912-914` 跳过 externalplayer 的停止上报，`:1413-1414` 跳过 externalplayer 的进度 timer；`modules/playback/playbackorientation.js` 也检查 `isExternalPlayer`。这些条件在外置播放器真正删除后可能变成可清理分支，但它们位于 PlaybackManager 的 Session、报告和控制路径，不能放入“只删 payload”的低风险操作。

判定：DELETE CANDIDATE 的后续子项，但 **DEFER 到后续 UI/shared cleanup**，继续完成普通播放、STRM、NextTrack、Stop、Session/report 和远控回归后再改。

### D-04 — CEC 的独立禁用设计

CEC 当前应 KEEP，但将来可以独立增加 feature gate：同时控制 `plugins/cec.js` 的默认动态加载、`main.js:552-573` 的 protocol registration 和 CEC payload。该决策必须单独确认，不由 External Player cleanup 顺带改变。

## UNKNOWN

### U-01 — 普通 Enhanced wrapper 的 CEC executable 参数

- `src/electronapp/main.js:932-952` 在 Windows 取第一个参数为 user data、第二个参数为 `cecExePath`，没有第二个参数时默认使用 `cec-client`。
- `tools/accept-live.ps1:45-46` 的 acceptance runner 会显式传入 `cec/cec-client.x64.exe`，但 `tools/Start-Enhanced.ps1:10` 启动 `Emby.Theater.exe` 时没有显式传入 CEC path。
- `Emby.Theater.exe` 是 vendor managed host，当前静态源码没有证明它是否会继续向 Electron 转发 bundled CEC path。不能把该差异当成“CEC 不加载”，也不能以此删除 CEC 文件。

需要的证据：一次不修改用户数据的 host command-line/child-process 参数观察，或明确的 host 源码/文档；验证后再决定 wrapper 是否需要补路径或把 CEC path 标为可选。

### U-02 — `p8-usbcec-driver-installer.exe`

`vendor/carnival/cec/p8-usbcec-driver-installer.exe` 约 619,536 bytes，当前文本源码没有调用者；但它可能是用户手工安装 CEC adapter driver 的历史工作流。当前不能仅按“无 rg 引用”删除。

需要的证据：确认 Enhanced 是否支持首次 CEC driver setup、发布说明是否承诺该手工入口，以及 CEC 设备在没有该 installer 时的实际行为。建议 Batch 3 再处理。

### U-03 — CEC x64/non-x64 duplicate names

下列文件已做 SHA256/size 交叉核对：

| 文件 | size | SHA256 结论 |
|---|---:|---|
| `cec/cec-client.exe` / `cec/cec-client.x64.exe` | 各 89,536 bytes | 完全相同 |
| `cec/cec.dll` / `cec/cec.x64.dll` | 各 325,568 bytes | 完全相同 |

main 只接受一个 `cecExePath`，但 opaque host、测试 runner 和手工脚本可能依赖文件名。先不要合并/删除别名；需要 host 参数和安装包 payload 回归。

### U-04 — `vendor/carnival/external/**` optional preset payload

- 46 个文件、约 29,339,316 bytes；主要为 Anime4K shader、一个约 26.8MB 字体和两个 mpv preset。
- `main.js:311-375` 的快捷键逻辑操作 `%APPDATA%\mpv\Anime4K.conf` / `Anime4K-off.conf`，并不是直接读取 runtime 的 `external/`；`Emby.ConfigureAndUninstall.bat` / `Emby.Dialog.bat` 会把其中一部分复制到用户 mpv 目录。
- `tools/build.ps1:34` 明确不自动应用 legacy mpv preset，但全量 Carnival copy 仍会把 `external/` 放进 runtime。

当前证据不能区分“仅历史手工包”与“仍需保留的可选用户工作流”。需要用户确认 preset/Anime4K/SVP 支持边界和一次 payload-only smoke 后再分类。

### U-05 — `externalplayers` 对普通 Item autoplay UI 的残留耦合

- `www/item/item.js:707-718` 读取 `externalplayers`，决定 `.btnAutoPlay` 是否显示。
- `www/item/item.js:2299-2312` 点击后实际切换的是 `autoplay`；该设置如何参与后续连播由其它代码承担。目前没有证据证明这整段都仍代表 External Player，或它已经完全成为普通连播 UI。
- `www/settings/playback.js:131-152,198-206` 仍包含 `externalplayerintent`、`chkExternalVideoPlayer` 和 `enableSystemExternalPlayers`；`apphost.js` 的 supported feature 列表没有 `externalplayerintent`，所以字段当前被隐藏，但保存逻辑仍读写历史值。

需要的证据：普通 Item 页 UI smoke、settings playback 保存前后 local storage 对比、用户对旧 `externalplayers` / `enableSystemExternalPlayers` 值的迁移口径。不能在 Batch 1 直接删除这些引用，也不能清理用户已有设置数据。

### U-06 — 动态 plugin injection 的边界

`app.js:2056-2062` 接受 `startInfo.plugins`，`main.js:648-655` 当前由本地 `plugins` 目录生成 file URL；默认目录只有 CEC/libmpv 顶层脚本，没有 externalplayer。这个事实足以证明默认注册已关闭，但不能证明任意未来 host 或手工调用不会注入 `www/modules/externalplayer/plugin.js`。

需要的证据：维护后的 plugin allowlist 或针对当前 host 的启动快照。当前 cleanup runtime 已无该文件；后续仍应保留“当前默认无入口”的测试，并明确动态 plugin contract。

### U-07 — managed host debug/document payload

`Emby.Theater.pdb`、`ServiceStack.Text.xml`、`SimpleInjector.xml`、`System.Configuration.xml` 等随 vendor root 全量复制；它们没有被 Electron JS 直接 require，但 managed host 的运行/诊断是否依赖某些旁车文件没有在本轮源码中证明。它们不属于低风险删除范围。

## External Player Chain

### 当前链路与状态

```text
默认 Electron app.js registration
    └─ tracked build-time patch removes it in fresh runtime

vendor 中的旧 plugin（只读基线；fresh Enhanced runtime 排除）
    ├─ externalplayer/plugin.js
    │    ├─ shell.exec
    │    │    └─ electronapphost://shellstart
    │    │         └─ main.startProcess → child_process.execFile → external exe
    │    └─ window.ipc.invoke('mpvPosEvent', true/false)
    │         └─ main named pipe → webContents.send('mpvPos')
    └─ getRoutes → externalplayer.html / externalplayers.html + controllers
```

Batch 1 后，当前可维护 snapshot 和 fresh runtime 都没有该 plugin 文件或 route；Electron registration 由 tracked build-time patch 在 source/vendor 两种输入上统一关闭。Batch 2 又删除了维护产品代码中的 main-process/helper process chain；vendor 中的旧文本仅作为只读来源保留。

### 共享依赖拆分

| 能力 | External Player 旧用途 | 当前其它用途 | 分类 |
|---|---|---|---|
| `shell.exec/canExec/close` | 启动/跟踪外部 exe | 未发现其它当前 consumer；旧 plugin 已删除 | REMOVED，Batch 2 |
| `shell.openUrl` | 旧 shell module 的一部分 | IAP、metadata、registration、通用链接按钮 | KEEP |
| `window.ipc` | 旧 mpvPosEvent、mpvPos channel | CD2 resolve/cancel、diagnostics preload | KEEP；只删 dead channel |
| `window.fs` / filesystem abstraction | 外置字幕与播放器路径检查 | 其它 web/runtime 文件能力和 Mount 边界 | KEEP/UNKNOWN；不随外置模块整体删除 |
| `PlaybackManager` external id 分支 | 外置 player 上报/进度例外 | 正常 Session/报告链仍使用同一文件 | DEFER，后续 UI/shared cleanup |

## CEC

### 当前状态

CEC 当前是实际可到达的 optional feature：

1. `main.js:615-665` 构造 `startInfo` 时扫描 `electronapp/plugins` 顶层 `.js`。
2. 当前目录中 `plugins/cec.js` 与 `plugins/libmpv.js` 均属于这个列表。
3. `plugins/cec.js:15-22` 定义 CEC input plugin；`startClient()` 在构造过程中调用 `electroncec://start`。
4. `main.js:552-573` 在 window 创建阶段注册 `electroncec` protocol；`main.js:986-1001` require `./cec/cec`，传入 executable、emitter、HDMI port，并把事件转给 `inputmanager`。
5. `main.js:1122-1128` 每次创建 window 时注册 CEC protocol；`main.js:926-928` 在窗口关闭时 kill CEC process。
6. `cec/cec.js` spawn `cec-client`，解析 stdout remote command；`command-map.js` 映射到 play/pause/stop/next/settings 等 Emby input command。

结论：

- 是否默认加载：**是，按当前动态 plugin 目录逻辑默认加载 CEC plugin**；是否总能成功 spawn bundled executable 受 U-01 影响。
- Windows desktop 意义：**仍有 HDMI-CEC remote/input 运行时用途**，不是无引用的静态文件。
- 能否独立禁用：架构上可以，但当前没有单独的 feature gate；需要同时处理 plugin list、protocol、settings route、binary packaging 和 close lifecycle。
- 建议：**KEEP**。CEC driver installer、重复别名和普通 wrapper 参数归 UNKNOWN/Batch 3。

## Shell / Exec

### Consumer table

| Method/入口 | 当前 consumer | 结论 |
|---|---|---|
| `shell.openUrl` | `www/modules/iap.js`、`metadataeditor/metadataeditor.js`、`registrationservices/registrationservices.js`、`emby-elements/emby-button/emby-button.js` | KEEP |
| `shell.exec` | 仅已删除的旧 `www/modules/externalplayer/plugin.js` 使用 | REMOVED，Batch 2 |
| `shell.canExec` | 仅已删除的旧 plugin `getPlayer()` 使用 | REMOVED，Batch 2 |
| `shell.close` | 当前文本 consumer 为 0 | REMOVED，Batch 2 |
| `electronapphost://shellstart` / `shellclose` | 只被上述已删除 process slice 生成的 URL 使用 | REMOVED，保留协议其它 command |
| main `child_process.exec` | Anime4K 配置弹窗打开 notepad；`main.js:348-375` | 独立 optional legacy，UNKNOWN/DEFER，不与 `shell.exec` 合并判死 |

不要使用“发现 `exec` 就全部删除”的规则：本批删除的是 Electron custom shell 的 process-only contract；main process 的 `child_process.exec('notepad.exe ...')` 仍是 Anime4K helper，CEC/refresh-rate 也各自保留独立的 process path。vendor 中的旧 `execFile` 文本仅是只读来源。

## IPC / Named Pipe

| 角色 | 当前事实 | 分类 |
|---|---|---|
| Legacy producer | 原 `main.js` 的 socket data → `mpvPos`、`mpvPosEvent` handler/timer | REMOVED，Batch 2 |
| Legacy consumer | 原 consumer 随 External Player frontend/plugin 一起删除；当前 consumer 为 0 | REMOVED |
| IPC bridge | `preload.js:1-2` exposes `ipcRenderer` as `window.ipc` | KEEP, CD2 shared |
| Active IPC | `enhanced/cd2-ipc.js` handles `enhanced-cd2-resolve` and cancel; diagnostics uses `enhanced-diagnostics` | KEEP |
| Remote player | `sessionplayer.js` + Emby SessionEvents/WebSocket | KEEP, not named pipe |

`mpvPosEvent`、`mpvPos` 和 named pipe entry point 已从维护产品代码和 fresh runtime 删除。generic preload IPC 仍由 CD2/diagnostics 使用，不能整体删除。

## Settings / Routes

| 位置 | 当前状态 | 分类/下一步 |
|---|---|---|
| `externalplayer/plugin.js:getRoutes` | plugin 文件已物理删除；旧 route 不再进入 fresh runtime | REMOVED |
| `externalplayer.html` / `externalplayers.html` + controllers | 文件已随 frontend/plugin layer 删除 | REMOVED |
| `settings/playback.html:92-100` | `.fldExternalPlayer` 字段仍在，但默认隐藏 | 后续 UI/shared 条件候选 |
| `settings/playback.js:131-152,198-206` | `externalplayerintent` 不在 apphost feature list；get/set 仍读写历史值 | UNKNOWN，后续 UI/shared |
| `modules/common/appsettings.js:102-105` | `enableSystemExternalPlayers` API 仍存在 | UNKNOWN，先处理 item/settings contract |
| `item/item.js:707-718` | `externalplayers` 参与 `.btnAutoPlay` 显示 | UNKNOWN，不能只按文件名删除 |
| `item/item.js:2299-2312,2904` | autoplay button 会切换 `autoplay`；文案仍带旧外置播放器字样 | DEFER，需 UI/产品语义确认 |
| `playbackmanager.js:912-914,1413-1414` | external player id 的报告/进度例外 | DEFER，后续 UI/shared cleanup |
| `emby-checkbox.css:167-182` | ExternalPlayerSwitch selector 未找到当前 markup consumer | DELETE CANDIDATE，视觉回归后处理 |
| shared locale JSON | 外置播放器 key 分散在语言包 | 后续 key-level cleanup，不删除整个 locale 文件 |

不要删除或迁移用户现有 `externalplayers` / `enableSystemExternalPlayers` storage 值作为本轮副作用。它们是否需要数据迁移必须单独确认。

## Packaging Residue

### 当前复制关系

- `tools/build.ps1:11-24` 校验 `vendor/carnival` 的 1009 个文件和 `vendor/patch` 的 51 个文件。
- `tools/build.ps1:27` 仍将 `vendor/carnival` 根目录整体复制到 runtime。
- `tools/build.ps1:28` 再将 `src/electronapp` 整体覆盖到 `electronapp`，包括本地 ignored Web snapshot、preload 和 package metadata。
- `tools/build.ps1:29-43` 在 source overlay 后先执行 `patch-external-player-registration.cjs`，再排除 `electronapp/www/modules/externalplayer`，随后复制 production dependency closure、应用 PlaybackManager overlay，并只从 patch payload 选取 `libmpv/mpv-1.dll`。
- `installer/EmbyTheaterEnhanced.iss:32-33` 递归复制 runtime 全部内容。

因此当前 packaging residue 不是“代码是否被 require”就能消失的；每项必须在新的 runtime allowlist/exclusion policy 中明确表达。

### 统计与用途

| 路径/组 | 文件数 | 约大小 | 当前是否进入 runtime | 分类 |
|---|---:|---:|---|---|
| `electronapp/www/modules/externalplayer/**` | 41（vendor 基线） | 77,725 bytes（本地 source） | 否，fresh runtime 为 0 | REMOVED，REMOVED-01 |
| `cec/**`（JS + binaries） | 15 | 1,467,952 bytes | 是 | CEC core KEEP；p8/aliases UNKNOWN |
| `external/**` | 46 | 29,339,316 bytes | 是 | UNKNOWN，U-04 |
| `Emby.ConfigureAndUninstall.bat` + `Emby.Dialog.bat` | 2 | 13,869 bytes | 是 | DELETE CANDIDATE，payload exclusion |
| `Emby.Theater.pdb`、managed XML docs | 多个 | 约 0.8MB 级别 | 是 | UNKNOWN，U-07 |
| `vendor/patch` scripts (`install-all.bat`、`patch.ps1`、`restore-all.bat`) | 3 个脚本 | 约 20KB | 否；只选 patch payload DLL 等 | 保持 vendor read-only，不运行 |

当前 `vendor/carnival` 总计 1009 个文件、约 358,819,214 bytes；`vendor/patch` 总计 51 个文件、约 150,867,901 bytes。一个较新的 ignored readiness runtime 为 2,158 个文件、约 389,112,764 bytes；该数字包含当前测试 runtime 及构建 metadata，不应与公开 Git tracked 文件数混淆。

### 打包残留结论

1. External Player 41 文件已从本地 source snapshot 和 fresh runtime 移除；vendor 原件保留只读。
2. `external/` 有明确的手工 helper 关系和用户配置关系，暂不能直接归死。
3. CEC 5 个 root binary 仍处于 active/unknown 混合状态，不能整目录排除。
4. `vendor/patch` 的安装/恢复脚本没有进入 runtime，本轮不需要也不允许执行它们。
5. 历史 `dist/` 是 ignored 证据/产物集合，不作为清理目标；cleanup PR 只应改变 fresh build 的 payload。

## Platform Compatibility

| 代码/资产 | 现状 | 分类 |
|---|---|---|
| `app.js` Android/iOS/Tizen/WinJS branches | shared offline Web runtime 的平台分支；部分 native path 当前未在本地目录中提供 | DEFER |
| main Linux/Windows plugin path | Pepper registration 和 path handling 的 shared bootstrap | DEFER |
| `is-linux` / `is-windows` / `detect-rpi` | main 启动和 fullscreen/path 选择使用 | KEEP/DEFER |
| `is-osx` | 由 `power-off` / `sleep-mode` 间接使用 | KEEP as dependency |
| `www/modules/shell.js` | web fallback `openUrl`/`canExec=false`；Electron 通过 custom path 使用 `src/electronapp/shell.js` | KEEP/DEFER，不等于 external process shell |
| `src/electronapp/package.json` Electron `^9.4.0` | 与实际 bundled Electron 18.3.15 不同 | DEFER，禁止本轮升级/删除 |

Windows only 是 near-term product priority，不是删除所有非 Windows 分支的证据。平台清理应等 runtime modernization，并以各平台启动/播放器 smoke 覆盖。

## Cleanup Batch 1 — Completed

目标：低风险、可单独 PR、只清理已禁用且无 consumer 的 External Player frontend/plugin layer，不改变 PlaybackManager/Session/playback semantics。

实际完成：

1. 从本地 ignored snapshot 删除 `www/modules/externalplayer/**` 的 41 个文件。
2. 从 `tools/build.ps1` 增加纯 frontend runtime exclusion，避免 vendor 全量 copy 恢复该目录。
3. 移除当前只读取该 plugin 文件的 obsolete 单测；未修改测试框架。
4. 增加 tracked build-time registration patch，并从当前 snapshot 移除失效的 Electron External Player registration remnant。
5. 保留 shared settings/locale、PlaybackManager guard、main IPC、shell process branch、CEC、external/、vendor helper 和所有 Foundation 资产。

结果：41 个本地 source 文件删除，fresh runtime 0 个对应 entries；不修改 `vendor/carnival` 原件。

Batch 1 不包含：`mpvPosEvent`、named pipe、main-process external-player IPC、shell external-process branch、`external/`、vendor helper、CEC core、`preload.js`、`electronapphost` 总协议、PlaybackManager、Session/remoteplayer、resolver/CD2/Mount/DirectUrl、Pepper/libmpv、平台分支和用户配置迁移。

## Cleanup Batch 2 — Completed

目标：在不改变 PlaybackManager、Session、remote control、CEC 和 generic IPC contract 的前提下，移除已无 consumer 的 External Player host/process surface。

实际完成：

1. 删除 `main.js` 的 `mpvPosEvent` handler、`mpvPos` 回传、named pipe socket、polling timer 和 cleanup chain。
2. 删除 `shell.js` 的 `canExec`、`exec`、`close`、process-close event helpers 及其 `shellstart/shellclose` URL 生成。
3. 删除 `main.js` 的 `shellstart/shellclose` protocol cases、`processes` map、`startProcess/closeProcess` 和旧 `execFile` callback chain。
4. 保留 `shell.openUrl`、`electronapphost://openurl`、其它 active host commands、generic `window.ipc`、CD2/diagnostics、CEC、Anime4K helper、libmpv、resolver、PlaybackManager、Session 和 remote control。
5. 新增 `tests/external-player-process-chain.test.cjs`，覆盖 dead channel/helper absence、`shell.openUrl` protocol request、CD2 trusted IPC 和 Anime4K/CEC preservation；未引入新测试框架。

Batch 2 后，`settings/playback`、item autoplay、PlaybackManager external-player guards、shared locale/CSS、`external/` 和 vendor helper 仍未处理。它们留给后续独立批次，并需要各自的 UI/Session/配置回归。

必须覆盖并已执行：普通/STRM bounded playback 主链、Pause/Seek/Resume/NextTrack/Stop、Session/reporting、remote control、`shell.openUrl` targeted smoke 和 CEC/Anime4K preservation check。

## Cleanup Batch 3

目标：以后再做的 runtime/platform modernization。

- Pepper / PPAPI bridge、Electron 18 compatibility、旧 package metadata、Player Adapter 和 runtime replacement。
- CEC p8 driver installer、duplicate binary names、opaque host 参数和 CEC payload 精简。
- Android/iOS/Tizen/WinJS/Linux/OSX compatibility branches 和 transitive platform packages。
- `external/` optional preset/font/shader、managed debug/document payload，以及任何需要用户配置迁移的内容。

Batch 3 需要独立的许可/来源、host、安装包和跨平台证据，不应借 Cleanup Batch 1 顺带完成。

## Risks / Required Regression

### 主要风险

- **Build residue risk**：只删 source snapshot 不足以从 runtime 删除 vendor 文件；Batch 1 已加入 fresh build exclusion/assertion，后续残余仍需沿用同一 payload gate。
- **Dynamic-load risk**：`startInfo.plugins`、AMD `require`、plugin route 和 preload exposure 都是字符串/文件 URL 关系，不能仅凭文件名判断。
- **Shared shell risk**：`openUrl` 与 external process methods 位于同一模块；必须按 method/consumer 拆分。
- **Session/report risk**：PlaybackManager external id guards 邻近停止报告和 progress timer；不能与 payload removal 混成无测试重构。
- **CEC host risk**：CEC JS 有静态入口，但普通 wrapper 的 executable 参数来源仍不透明；删除或重命名 binary 可能只在真实 host 启动时失败。
- **User storage risk**：旧 external player JSON 和 enable flag 可能仍在 local storage；本轮不删除、不重置、不迁移。
- **Vendor/provenance risk**：vendor 和 Web snapshot 被忽略且来源边界已在文档中固定；cleanup 必须保持 runtime provenance 可解释。

### Batch 1 Verification Record

1. `npm test`：62/62 PASS；obsolete direct-load test 已删除，新增 provenance/registration tests。
2. fresh runtime provenance：PASS，scope 仍覆盖全部非排除产品文件；app.js build overlay 的 generator/runtime/source 状态已记录并验证；`package.ps1 -VerifyOnly`：PASS。
3. deleted path entries：0；CEC、libmpv、preload、resolver、CD2 和 PlaybackManager 文件存在。
4. app-registration targeted tests：active/already-clean/platform-preservation/malformed-duplicate 全部 PASS；source app.js fallback provenance PASS。
5. stale ignored app.js portability build：registration 关闭、frontend directory 不存在、Android branch 保留、provenance/package verify PASS，source sentinel/app state 已恢复。
6. JavaScript syntax：454 files PASS；PowerShell syntax：11 files PASS；`git diff --check` PASS。main IPC、shell process slice、CEC、external/、vendor helper 和历史文档未在 Batch 1 改动。

### Batch 2 Verification Record

1. `npm test`：67/67 PASS；其中 `tests/external-player-process-chain.test.cjs` 5/5 PASS。
2. JavaScript syntax：455 files PASS；PowerShell syntax：11 files PASS；`git diff --check`：PASS。
3. fresh runtime `EmbyTheaterEnhanced-0.1.1-batch2-process-chain-65d97da`：runtime provenance PASS（779 product-scope entries），`package.ps1 -VerifyOnly` PASS（2,116 payload files）。
4. runtime `electronapp` 下 `mpvPosEvent`、`mpvPos`、`mpv-socket`、`shellstart`、`shellclose`、`startProcess`、`closeProcess` 和 `onChildProcessClosed` active references：0。
5. `shell.openUrl` targeted smoke：PASS，仍生成 `GET electronapphost://openurl?url=...`；main `openurl` dispatch 与其它 active host commands 保持。
6. generic IPC/CD2、diagnostics、CEC、Anime4K helper、libmpv、resolver、PlaybackManager 和 `sessionplayer.js` 均存在；vendor 原件未修改。
7. 唯一一次 bounded real acceptance：inspect/select/play/pause/seek/resume/next/stop、Pepper-ready、resolver-result、manager-play-resolved、Session/reporting、cleanup 和 residual gates 全部通过；runner `completed`、`timedOut=false`、`cleanup=verified-clean`、residual owned processes=0。`loadfileObservation=unavailable` 仍是既有 observability gap。

## Final Audit Summary

```text
LEGACY AUDIT SUMMARY

Total legacy areas reviewed:
8 requested domains (A-H) + focused External Player/CEC/Shell/IPC/Routes/Packaging cross-checks

KEEP:
- PlaybackManager / Session / PlaySession / reports / remoteplayer / input API
- Embedded libmpv / Pepper bridge / preload diagnostics
- STRM resolver / CD2 / DirectUrl / Mount / native fallback
- CEC runtime and settings path
- electronapphost and shared shell.openUrl
- readiness harness / runtime provenance / vendor manifest

REMOVED:
- External Player frontend/plugin module, route/controllers and module locales (41 files)
- Disabled Electron registration remnant in current ignored Web snapshot; tracked build-time patch now enforces the same result on stale/vendor fallback input
- `mpvPosEvent` / `mpvPos` / `mpv-socket` main-process chain
- Electron custom shell process-only methods and close-event helpers
- `electronapphost://shellstart` / `shellclose` dispatch plus `startProcess` / `closeProcess` process map/helper chain

DELETE CANDIDATE:
- shared external-player settings/locale residue and unused CSS selector
- old root BAT helpers as Enhanced payload exclusion, pending manual workflow confirmation

DEFER:
- Pepper / PPAPI / Electron 18 / Player Adapter / runtime modernization
- PlaybackManager external-player guards and settings/autoplay coupling
- shared platform branches and transitive platform dependencies
- CEC independent gate and optional Anime4K/SVP preset policy

UNKNOWN:
- normal wrapper CEC executable argument
- p8 CEC driver installer and duplicate CEC aliases
- vendor external preset/font/shader user workflow
- externalplayers/autoplay/settings migration semantics
- dynamic plugin injection and managed host sidecar payload

External Player:
- current registration: tracked build-time patch disables the Electron registration; fresh runtime contains no External Player frontend path regardless of ignored snapshot state
- remaining product residue: settings/autoplay, PlaybackManager guards, shared locale/CSS and `external/`; vendor baseline remains read-only
- preserved shared dependencies: shell.openUrl, generic preload IPC, filesystem, PlaybackManager/session chain and CEC
- deletion readiness: frontend/plugin layer and host/process-control chain REMOVED; shared semantic residue remains

CEC:
- current status: default top-level plugin load attempts electroncec initialization; runtime path is real
- recommendation: KEEP; investigate executable argument and driver payload separately

Shell / Exec:
- shared consumers: shell.openUrl in four active Web modules; electronapphost has broader consumers
- status: shell process-only contract REMOVED; retain shell module/openUrl and active host protocol commands

IPC / Named Pipe:
- active: CD2 IPC, diagnostics IPC, Session/WebSocket control
- status: mpvPosEvent, mpvPos and mpv-socket chain REMOVED

Settings / Routes:
- removed: external player module routes/controllers; remaining: hidden external-only field/style/key after semantics check

Packaging residue:
- externalplayer 41 vendor baseline files / 0 fresh runtime entries
- CEC 15 files / about 1.47 MB
- external presets 46 files / about 29.34 MB
- old root BAT 2 files / about 13.9 KB

Top low-risk cleanup targets:
1. Resolve shared external-player settings/autoplay semantics
2. Audit old root BAT helpers and external/ payload policy
3. Review CEC aliases and driver payload with host evidence

Items explicitly NOT safe to delete:
PlaybackManager, embedded libmpv/Pepper bridge, Session/remoteplayer, resolver/CD2/DirectUrl/Mount,
preload diagnostics, readiness/provenance tooling, CEC core, electronapphost, shared shell.openUrl,
vendor originals and user settings data

Recommended Cleanup Batch 1:
Completed: External Player frontend/plugin payload and current registration remnant removed; at that time main/helper residue remained and was handled by the completed Batch 2 process-control cleanup

Cleanup Batch 2 process-control chain:
Completed: `mpvPosEvent`/named-pipe, Electron custom shell process methods, `shellstart`/`shellclose` and `startProcess`/`closeProcess` removed; `shell.openUrl` and active IPC/host commands preserved

Recommended regression for Batch 1:
npm test, static channel/reference scan, fresh runtime provenance/payload check, isolated Electron plugin/playback/session/control smoke

Product code modified:
NO playback/product behavior code; build exclusion and obsolete test changed

Audit doc:
docs/LEGACY_AUDIT.md

Working tree:
clean after Audit commit, cleanup commit and documentation update; ignored vendor/dist/.work/runtime inputs preserved

Recommendation:
READY FOR BATCH 2 PLANNING
```
