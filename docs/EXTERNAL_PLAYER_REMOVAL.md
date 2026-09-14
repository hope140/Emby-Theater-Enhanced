# 外置播放器禁用与清理审计

## 当前状态

第一轮的入口禁用已经完成；Foundation Cleanup / Batch 1 又物理移除了 External Player 的前端与插件表层。当前状态是：

> External Player frontend/plugin layer removed; main-process/helper residue remains for Batch 2 audit/removal.

本轮基线与提交：

- Audit commit：`fb434e57f2cca065c784e0551c651ef57d1a2634`，`docs: record legacy runtime audit`
- Cleanup branch：`cleanup/external-player-frontend`
- Cleanup commit：`adc8758902a580cc3bc7fc33bfb10a6b422c828d`，`cleanup: remove dead external player frontend`

## Batch 1 已完成范围

| 位置 | 旧用途 | Batch 1 结果 |
|---|---|---|
| `www/modules/externalplayer/**` | 外置播放器 plugin、两个设置页、两个 controller、模块 locale | 本地 ignored Web snapshot 中 41 个文件已删除；fresh runtime 不再包含该目录 |
| `www/app.js` 的 Electron externalplayer registration | `responses.electron && list.push("modules/externalplayer/plugin")` | 当前本地 snapshot 的失效 registration remnant 已移除；Android 平台分支仍按平台兼容边界保留 |
| `tools/patch-external-player-registration.cjs` | stale/vendor `app.js` 的 Electron registration | tracked build-time patch 只关闭该 Electron registration；already-clean 状态幂等通过，Android branch 保留 |
| External Player route/controller surface | `externalplayer.html`、`externalplayers.html` 及 `getRoutes` | 随模块表层删除；无当前 route 或 controller consumer |
| `tools/build.ps1` | vendor 全量复制会带入旧前端 | 增加纯 External Player runtime exclusion；不修改 vendor 原件 |
| `tests/diagnostics.test.cjs` 的 disabled-plugin direct-load case | 直接读取已删除 plugin 文件 | 作为 obsolete test 删除；未引入新测试框架 |

这 41 个 Web 文件位于 `.gitignore` 的本地 snapshot，不作为公开 Git 文件提交。Git 提交记录的是生成 runtime 的排除规则和 obsolete test 删除；`vendor/carnival` 仍保留原始 41 文件，作为只读来源基线。

Local audit workspace：本机物理删除了 41 个 ignored snapshot files。
Durable repository/product behavior：`runtime-provenance.cjs` 的精确 source exclusion、`patch-external-player-registration.cjs` 的 app.js overlay 和 `tools/build.ps1` 的 runtime exclusion 共同保证 External Player frontend 及 Electron registration 不会进入 fresh Enhanced runtime，不依赖开发机是否手工删除 snapshot。

本轮 portability 修复已把该 exclusion 写入 provenance manifest，并用 source sentinel 验证存在/不存在两种机器状态的 scope 一致性。

## 仍然保留的共享能力

- `src/electronapp/shell.js` 保留。`shell.openUrl` 仍被 IAP、metadata editor、registration services 和通用 `emby-button` 使用。
- `shell.exec` 的 main-process 实现、`shellstart` / `shellclose`、`mpvPosEvent`、named pipe 和外置 helper 本轮没有删除。
- `src/electronapp/preload.js`、generic `window.ipc`、CD2 IPC 和 diagnostics IPC 保留。
- CEC、Pepper / PPAPI、libmpv、PlaybackManager、remoteplayer、Session、resolver、CD2、DirectUrl、Mount 和用户设置数据均未修改。

## Batch 1 后的残余

| 残余 | 当前状态 | 后续批次 |
|---|---|---|
| `src/electronapp/main.js` 的 `mpvPosEvent` / named pipe | 未修改；现在没有 External Player 前端 consumer | Batch 2，单独验证 IPC 删除 |
| `src/electronapp/shell.js` 的 `canExec` / `exec` / `close` | 未修改；`openUrl` shared | Batch 2，按 method 拆分 |
| main `shellstart` / `shellclose`、`startProcess` / `closeProcess` | 未修改 | Batch 2，核对 host protocol 边界 |
| `external/` preset、shader、font 与 Anime4K helper | 未修改，仍随 vendor payload 保留 | Batch 2/3，等待用户 workflow 决策 |
| `Emby.ConfigureAndUninstall.bat`、`Emby.Dialog.bat` | 未修改，仍随 vendor root 保留 | Batch 2/3，单独处理手工 helper payload |
| `settings/playback.js/html` external field 与 `enableSystemExternalPlayers` | 未修改；当前字段由 unsupported `externalplayerintent` 隐藏，但仍有读写代码 | Batch 2 |
| `item.js` 的 `externalplayers` autoplay gate、PlaybackManager external-player guards | 未修改 | Batch 2，需 UI/Session/report 回归 |
| CEC driver installer、重复 x64/non-x64 别名、opaque host executable 参数 | 未修改 | Batch 3 / UNKNOWN |

不要把上述残余写成“External Player 已全部清理完成”。准确结论仅为前端/plugin layer 已移除。

## 删除前引用证明

Batch 1 删除前重新检查了 `rg`、AMD `require`、plugin registration、route/controller、自引用和 build/package 规则：

- 维护版 `www/app.js` 已不再注册该 plugin。
- `main.js` 的默认动态 plugin 列表来自 `electronapp/plugins` 顶层 `.js`；External Player 在 `www/modules`，不在该目录。
- 已删除 plugin 的唯一 direct-load 测试是 `tests/diagnostics.test.cjs` 中的 disabled-capability case，随文件删除。
- 两个 HTML 和两个 controller 只由旧 plugin route/self-reference 使用。
- vendor 原件仍有同名文件，但它们不是当前可维护层 consumer；build exclusion 负责避免它们进入新 Enhanced runtime。

删除后残留的 `externalplayer` 文本逐项分类如下：

- Android 平台分支：DEFER，属于共享 Web runtime 的平台兼容代码。
- `item.js` / `settings/playback.js` / `appsettings.js`：UNKNOWN/Batch 2，涉及普通 autoplay UI 和历史设置值。
- `playbackmanager.js` / `playbackorientation.js`：DEFER，涉及 Session、report 和播放器生命周期。
- `tools/smoke-electron.cjs` 中的 `!state.players.some(...)`：合法的负向 runtime smoke 断言。
- `tools/build.ps1` 中的 exclusion path：合法的 packaging rule。
- 历史 docs、测试日志和 vendor 原件：历史/来源证据，保留。

## 验证结果

验证 runtime：`dist/EmbyTheaterEnhanced-0.1.1-batch1-after-cleanup-adc8758`。

- runtime provenance：PASS，产品 scope 779 entries；app.js 为受控 build overlay，generator/runtime/source 状态可验证
- app.js provenance relation：`electronapp/www/app.js` 为受控 build overlay；generator hash/runtime hash 已记录并验证，source app.js 缺失时允许 vendor fallback 并记录 `sourcePresent=false`
- deleted External Player entries：0
- `package.ps1 -VerifyOnly`：PASS，2,116 个 payload files
- Foundation 文件：embedded libmpv、PlaybackManager、STRM resolver、CD2 resolver/service、preload 均存在
- 自动测试：62/62 PASS
- JavaScript syntax：454 files PASS
- PowerShell syntax：11 files PASS
- `git diff --check`：PASS

唯一一次 bounded real acceptance 使用 `inspect,select,play,pause,seek,resume,stop`：

- inspect：PASS
- select：PASS，`strm=true`
- play：PASS
- Pepper-ready：observed
- resolver-result：observed
- manager-play-resolved：observed
- pause：PASS
- seek：PASS
- resume：PASS
- stop：PASS
- Session/reporting：PASS
- cleanup：`verified-clean`
- residual：0
- runner：`completed`，`timedOut=false`

`loadfileObservation=unavailable` 仍是既有 observability gap，不作为本轮硬 gate；本轮没有因此修改播放器或 acceptance observer。

## 清理效果

对照 runtime 为同一 Audit commit 上构建的 `dist/EmbyTheaterEnhanced-0.1.1-batch1-before-cleanup`：

- Files deleted：41 个本地 ignored frontend files
- Source size removed：77,725 bytes，约 77.7 KB
- Runtime file count：2,158 → 2,117，减少 41
- Runtime size：389,112,766 → 389,008,884 bytes，减少 103,882 bytes（包含 provenance/build metadata 变化）

体积不是本轮主要目标；主要收益是从新 runtime 移除无入口的 External Player frontend/plugin surface。
