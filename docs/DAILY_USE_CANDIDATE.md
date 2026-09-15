# Daily-use Candidate 验收卡

日期：2026-09-15（UTC+8）

## 当前候选：direct app launch（REAL PASS — direct app launch）

原候选 `4761a2440e9ab1df0b3c6d01765f26f9560d9bea` 的启动验收结论为 `NON-BLOCKING FAIL — launcher UX`，原因是 `PowerShell wrapper caused visible console flash and startup delay`。

本分支 `fix/direct-app-launch` 将安装器开始菜单、桌面快捷方式和安装完成 Launch 统一改为直接启动 `{app}\Emby.Theater.exe`。Electron main process 负责原 launcher 的幂等初始化，正式 runtime 不再携带 `Start-Enhanced.ps1/.cmd`。

新候选路径：

- Runtime：`dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch`
- Installer：`dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch-setup.exe`

候选 artifact 绑定 code/package HEAD `b16273c71de5e671f1c38e4b355edb72382ec137`；后续 `8bb79341490aaba3404db2a6411510d66a7b8bef` 及本轮文档修正均为 docs-only，不改变 artifact 内容，因此不需要重新 build/package/test。runtime provenance、`package.ps1 -VerifyOnly`、Inno archive integrity 和 `{app}` payload comparison 均通过。

真实手工验收（2026-09-15，UTC+8）：

- Installer post-install Launch：`REAL PASS`
- Desktop shortcut：`REAL PASS`
- Start Menu shortcut：`REAL PASS`
- 直接双击 `Emby.Theater.exe`：`REAL PASS`

四种入口均无 PowerShell/CMD 窗口闪烁，启动体验正常，既有 Emby 登录状态保留。因此本项结论为 `REAL PASS — direct app launch`。

当前自动验证已覆盖 bootstrap seed/preserve、installer direct-entry、provenance scope、runtime bootstrap 和完整 Node 测试。Daily-use Candidate 整体仍未达到最终 `READY`：其他 playback、STRM、audio、subtitle、NextTrack 和 endurance 项目继续保留原有 REAL/SYNTHETIC/NOT COVERED 边界，不因本轮 launcher 验收升级。

本候选由 code/package HEAD `b16273c71de5e671f1c38e4b355edb72382ec137` 构建，目标是用户手动日常使用验收。后续 docs-only commit 不改变 runtime/package；没有创建 release、tag，也没有修改产品播放行为、服务器配置或用户客户端配置。

## 当前 direct app launch 候选身份与打包结果

| 项目 | 结果 |
|---|---|
| Code/package source commit | `b16273c71de5e671f1c38e4b355edb72382ec137` |
| Branch | `fix/direct-app-launch` |
| Runtime | `dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch` |
| Runtime files | 2,123 |
| Build manifest payload entries | 2,122 |
| Installer | `dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch-setup.exe` |
| Installer size | 125,176,528 bytes |
| Installer SHA256 | `B1606F1C245FA8681834513013EF4FD1969F45D34E3AB79174D9AA6B6323D8C7` |
| Provenance | PASS；784 scope entries，build overlays 3/3，prepared artifact 1/1 |
| Package verify | PASS；`package.ps1 -VerifyOnly`，2,122 payload entries |
| Installer archive integrity | PASS；Inno archive test通过 |
| Installer payload comparison | PASS；解包 `{app}` 2,123 files，missing / extra / hash mismatch = 0 / 0 / 0 |

安装包是在独立 staging 目录使用现有项目内 Inno compiler 编译，再复制到候选文件名；旧的 `EmbyTheaterEnhanced-0.1.1-win-x64-setup.exe` 未覆盖。

### Historical candidate

原 `4761a2440e9ab1df0b3c6d01765f26f9560d9bea` / `main` 候选使用 `dist/EmbyTheaterEnhanced-0.1.1-daily-use-candidate-4761a24` 和对应旧 installer；其 launcher UX 结论为 `NON-BLOCKING FAIL — launcher UX`。该历史身份不代表当前 direct app launch artifact。

## 自动验证

| 检查 | 结果 | 证据 |
|---|---|---|
| Code/package source | PASS | `b16273c71de5e671f1c38e4b355edb72382ec137`；后续 docs-only commit 不改变 artifact |
| Branch | PASS | `fix/direct-app-launch` |
| STRM/settings targeted | PASS | 21/21 |
| Full `npm test` | PASS | 101/101 |
| JavaScript syntax | PASS | `src`、`tools`、`tests` 下 68 个 `.js/.cjs`，`node --check` |
| PowerShell syntax | PASS | `tools`、`tests` 下 11 个 `.ps1`，Windows PowerShell parser |
| `git diff --check` | PASS | 基线检查 |
| Source build | PASS | code/package HEAD `b16273c...`，runtime 2,123 文件 |
| Runtime provenance | PASS | code/package HEAD 精确匹配，784 scope entries，overlay/prepared checks 全通过 |
| Package verify | PASS | `tools/package.ps1 -VerifyOnly` |
| Hidden Electron smoke | NOT COVERED | 按任务要求未重跑历史 `Final-head synthetic runtime smoke: NOT COMPLETED — hidden Electron smoke timeout` |

本轮没有为清除历史 timeout 重复启动 Electron。可见窗口、真实 settings UI、真实服务器播放和安装后启动也留给手动验收。

## Playback acceptance matrix

状态列只使用 `REAL PASS`、`SYNTHETIC PASS`、`NOT COVERED`、`FAIL`。这里的状态是当前可复用的最强证据，不表示旧 HEAD 的真实结果已经在本候选重新执行。

| ID | Playback route | Status | Evidence / source HEAD | Current-candidate boundary |
|---|---|---|---|---|
| A | Ordinary non-STRM → Native embedded libmpv | SYNTHETIC PASS | code/package HEAD `b16273c...` 的 `npm test` 保留 native source；冻结 runtime 的普通 video synthetic pipeline 在 `295626753089de9f70c2cb28b5c5954be51b3843` 通过 embedded libmpv、controls、reporting | 真实普通媒体库没有可用样本，未在 code/package HEAD `b16273c...` 重新跑真实播放 |
| B | STRM → Native fallback | REAL PASS | PR #2 follow-up 的真实 Emby run，历史 source context 为 `5f2a2e8e1dc3483b93b4d9b092a16fd87c3c1e15`（后并入 `ba3d7e9…`）；resolver 为 `cd2=mapping_miss → mount_missing → native URL`，Session/WebSocket、controls、10 条报告通过 | 这是旧 PR #2 HEAD 的真实证据；当前候选未重新执行 |
| C | STRM → Mount | SYNTHETIC PASS | code/package HEAD `b16273c...` targeted/full tests；`295626753089de9f70c2cb28b5c5954be51b3843` frozen synthetic 覆盖 CD2 miss → Mount | 真实 Emby Mount 命中仍没有自然样本，留待手动验收 |
| D | STRM → CloudDrive2 same-origin HTTP | REAL PASS | PR #2 merged baseline `ba3d7e9be2ae1a3015cf9077921dd29cd53412e8`；两个真实 POSIX STRM 均 `cd2_hit`、same-origin source、core-playing、controls、Session/reporting 通过 | 历史真实证据，不是 code/package HEAD `b16273c...` 当前候选实测 |
| E | STRM → DirectUrl | REAL PASS | PR #4 source `e6badf2f27836f232dc82552c946133872ace5f7`（merged as `c880b977…`）的真实分层 smoke：DirectUrl、required User-Agent/expiry、embedded path/format/core-playing/time-pos 通过 | 仅证明 acquisition/libmpv 分层路径；当前候选完整 PlaybackManager/Session 链未重新验收 |
| F | DirectUrl → CD2 HTTP → Mount → Native | SYNTHETIC PASS | code/package HEAD `b16273c...` resolver settings tests 加上 `295626753089de9f70c2cb28b5c5954be51b3843` frozen fake pipeline 覆盖 stage order、miss、Mount/Native fallback、Abort | 没有真实环境同时制造各级 miss 并验证完整级联 |

对于 D/E，真实结果只记录可观察到的 source kind 和播放器/Session 事实；不能把旧 HEAD 的证据迁移为当前候选的完整 real acceptance。

## 手动验收清单

手动验收只使用候选安装包和用户自己的已登录环境。每个失败先记录，再评审，暂不直接修复产品代码。

### Startup

- [ ] 安装候选包到独立目录
- [ ] 启动并退出一次
- [ ] 完成 5 次 cold-ish launch
- [ ] 无 white screen，无 unrecovered Pepper failure
- [ ] 退出后无非预期残留 Electron/player process

### STRM settings

- [ ] 设置页可打开
- [ ] 修改并保存后，重新打开仍持久化
- [ ] 设置 token
- [ ] 页面、日志和返回对象不回显 token
- [ ] 重启后设置仍保留
- [ ] 用重叠规则确认 longest-prefix selection
- [ ] 用 cloud-first 规则完成真实播放
- [ ] 用 mount-first 规则完成真实播放

### Session / controls

分别选择代表性的 Native 和 STRM 播放，逐项检查：

- [ ] Play
- [ ] Pause
- [ ] Seek
- [ ] Resume
- [ ] Stop
- [ ] NextTrack / 下一集
- [ ] Emby server Now Playing
- [ ] 进度上报持续推进且 Item/MediaSource/PlaySession identity 一致
- [ ] 从 Emby server/client 发起 remote control 后客户端响应

### Media controls

- [ ] audio A → B → A
- [ ] subtitle enable
- [ ] subtitle switch
- [ ] subtitle disable
- [ ] STRM 至少重复一次上述相关操作（条件允许时）

### Endurance

- [ ] 下一集自动/手动 transition 后仍可播放、上报和控制
- [ ] 连续播放约 30 分钟，无崩溃、卡死、Session 丢失或进度停止

## Failure record policy

每个失败至少记录以下字段：

| 字段 | 内容 |
|---|---|
| Acceptance case | 具体清单项 |
| Playback route | A–F |
| Expected | 预期行为 |
| Actual | 实际行为 |
| Resolver | result / reason / source kind（若可得） |
| Session | Session、PlaySession、Now Playing、progress、remote-control 状态（相关时） |
| Logs | 有用的脱敏日志和时间点 |
| Reproducibility | 首次、重复次数和是否稳定复现 |

分类规则：

- `BLOCKER`：无法开始播放、错误 source selection、Session/progress/remote-control 断裂、NextTrack lifecycle 断裂、必需 fallback 失败，或阻止正常使用的 crash/hang。
- `NON-BLOCKING`：设置页外观、focus/label、小型 UX、无法自动化的 surface，或未使用的历史 legacy residue。

未完成失败记录和评审前，不修改产品代码，不把失败改写成 `NOT COVERED`，也不把 synthetic 结果升级为 `REAL`。

## Known evidence gaps

- code/package HEAD `b16273c...` 没有新的真实 Electron/Emby playback run；历史 hidden Electron smoke timeout 按要求保留且未重试。
- 真实 settings UI 的 native-window automation 当前不可用。
- 真实 Mount 命中没有自然样本；C 目前只有 synthetic evidence。
- E 的真实证据是旧 PR #4 的 DirectUrl acquisition/libmpv 分层结果，当前候选完整 PlaybackManager/Session/remote-control chain 未覆盖。
- 当前候选的 5 次 launch、安装后启动/退出、audio/subtitle、NextTrack endurance 和约 30 分钟连续播放仍待手动执行。
- 真实普通非-STRM 媒体库样本缺失，A 只有 synthetic evidence。
