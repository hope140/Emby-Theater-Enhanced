# Daily-use Candidate 验收卡

日期：2026-09-15（UTC+8）

## 当前候选：direct app launch（待手工验收）

原候选 `4761a2440e9ab1df0b3c6d01765f26f9560d9bea` 的启动验收结论为 `NON-BLOCKING FAIL — launcher UX`，原因是 `PowerShell wrapper caused visible console flash and startup delay`。

本分支 `fix/direct-app-launch` 将安装器开始菜单、桌面快捷方式和安装完成 Launch 统一改为直接启动 `{app}\Emby.Theater.exe`。Electron main process 负责原 launcher 的幂等初始化，正式 runtime 不再携带 `Start-Enhanced.ps1/.cmd`。

新候选预留路径：

- Runtime：`dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch`
- Installer：`dist/EmbyTheaterEnhanced-0.1.1-direct-app-launch-setup.exe`

候选 artifact 必须绑定本分支最终 HEAD；runtime provenance、`package.ps1 -VerifyOnly`、Inno archive integrity 和 `{app}` payload comparison 均需以该 source commit 重新验证。artifact 数量、大小和 SHA256 以最终交付记录为准。

当前自动验证已覆盖 bootstrap seed/preserve、installer direct-entry、provenance scope、runtime bootstrap 和完整 Node 测试；新候选尚未完成安装后的四入口手工验收。最终状态保持 `PENDING MANUAL`，手工确认桌面、开始菜单、安装完成 Launch 与直接 exe 均通过后，才能标记最终 PASS。

本候选从最新 `origin/main` 构建，目标是用户手动日常使用验收。没有创建 release、tag、PR，也没有修改产品播放行为、服务器配置或用户客户端配置。

## 候选身份与打包结果

| 项目 | 结果 |
|---|---|
| Source commit | `4761a2440e9ab1df0b3c6d01765f26f9560d9bea` |
| Branch / upstream | `main` / `main == origin/main` |
| Runtime | `dist/EmbyTheaterEnhanced-0.1.1-daily-use-candidate-4761a24` |
| Runtime 文件数 | 2,124（其中 build manifest 的 payload entries 为 2,123） |
| Installer | `dist/EmbyTheaterEnhanced-0.1.1-daily-use-candidate-4761a24-setup.exe` |
| Installer 大小 | 125,175,083 bytes |
| Installer SHA256 | `f3088aa87a5fd78f6395b926ccbbf6e16b67bb8085f648625a7949c2b3d5a72a` |
| Provenance | PASS；product scope 785，build overlays 3/3，prepared artifact 1/1，errors 0 |
| Runtime payload verify | PASS；`package.ps1 -VerifyOnly`，2,123 entries |
| Installer archive integrity | PASS；Inno archive test通过 |
| Installer payload comparison | PASS；解包 `{app}` 2,124 文件，缺失 0、额外 0、SHA256 mismatch 0 |

安装包是在独立 staging 目录使用现有项目内 Inno compiler 编译，再复制到候选文件名；旧的 `EmbyTheaterEnhanced-0.1.1-win-x64-setup.exe` 未覆盖。

## 自动验证

| 检查 | 结果 | 证据 |
|---|---|---|
| `origin/main` 基线 | PASS | fetch 后 `main` 快进到 `4761a244…`；HEAD、`origin/main` 相同 |
| 工作树基线 | PASS | 快进前无 tracked/untracked patch，`main...origin/main` clean |
| STRM/settings targeted | PASS | 21/21 |
| Full `npm test` | PASS | 98/98 |
| JavaScript syntax | PASS | `src`、`tools`、`tests` 下 66 个 `.js/.cjs`，`node --check` |
| PowerShell syntax | PASS | `tools`、`tests` 下 11 个 `.ps1`，Windows PowerShell parser |
| `git diff --check` | PASS | 基线检查 |
| Source build | PASS | 当前 source commit，runtime 2,124 文件 |
| Runtime provenance | PASS | source commit 精确匹配，785 scope entries，overlay/prepared checks 全通过 |
| Package verify | PASS | `tools/package.ps1 -VerifyOnly` |
| Hidden Electron smoke | NOT COVERED | 按任务要求未重跑历史 `Final-head synthetic runtime smoke: NOT COMPLETED — hidden Electron smoke timeout` |

本轮没有为清除历史 timeout 重复启动 Electron。可见窗口、真实 settings UI、真实服务器播放和安装后启动也留给手动验收。

## Playback acceptance matrix

状态列只使用 `REAL PASS`、`SYNTHETIC PASS`、`NOT COVERED`、`FAIL`。这里的状态是当前可复用的最强证据，不表示旧 HEAD 的真实结果已经在本候选重新执行。

| ID | Playback route | Status | Evidence / source HEAD | Current-candidate boundary |
|---|---|---|---|---|
| A | Ordinary non-STRM → Native embedded libmpv | SYNTHETIC PASS | 当前 HEAD `npm test` 保留 native source；冻结 runtime 的普通 video synthetic pipeline 在 `295626753089de9f70c2cb28b5c5954be51b3843` 通过 embedded libmpv、controls、reporting | 真实普通媒体库没有可用样本，未在 `4761…` 重新跑真实播放 |
| B | STRM → Native fallback | REAL PASS | PR #2 follow-up 的真实 Emby run，历史 source context 为 `5f2a2e8e1dc3483b93b4d9b092a16fd87c3c1e15`（后并入 `ba3d7e9…`）；resolver 为 `cd2=mapping_miss → mount_missing → native URL`，Session/WebSocket、controls、10 条报告通过 | 这是旧 PR #2 HEAD 的真实证据；当前候选未重新执行 |
| C | STRM → Mount | SYNTHETIC PASS | 当前 HEAD targeted/full tests；`295626753089de9f70c2cb28b5c5954be51b3843` frozen synthetic 覆盖 CD2 miss → Mount | 真实 Emby Mount 命中仍没有自然样本，留待手动验收 |
| D | STRM → CloudDrive2 same-origin HTTP | REAL PASS | PR #2 merged baseline `ba3d7e9be2ae1a3015cf9077921dd29cd53412e8`；两个真实 POSIX STRM 均 `cd2_hit`、same-origin source、core-playing、controls、Session/reporting 通过 | 历史真实证据，不是 `4761…` 当前候选实测 |
| E | STRM → DirectUrl | REAL PASS | PR #4 source `e6badf2f27836f232dc82552c946133872ace5f7`（merged as `c880b977…`）的真实分层 smoke：DirectUrl、required User-Agent/expiry、embedded path/format/core-playing/time-pos 通过 | 仅证明 acquisition/libmpv 分层路径；当前候选完整 PlaybackManager/Session 链未重新验收 |
| F | DirectUrl → CD2 HTTP → Mount → Native | SYNTHETIC PASS | 当前 HEAD resolver settings tests 加上 `295626753089de9f70c2cb28b5c5954be51b3843` frozen fake pipeline 覆盖 stage order、miss、Mount/Native fallback、Abort | 没有真实环境同时制造各级 miss 并验证完整级联 |

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

- 当前 `4761…` 没有新的真实 Electron/Emby playback run；历史 hidden Electron smoke timeout 按要求保留且未重试。
- 真实 settings UI 的 native-window automation 当前不可用。
- 真实 Mount 命中没有自然样本；C 目前只有 synthetic evidence。
- E 的真实证据是旧 PR #4 的 DirectUrl acquisition/libmpv 分层结果，当前候选完整 PlaybackManager/Session/remote-control chain 未覆盖。
- 当前候选的 5 次 launch、安装后启动/退出、audio/subtitle、NextTrack endurance 和约 30 分钟连续播放仍待手动执行。
- 真实普通非-STRM 媒体库样本缺失，A 只有 synthetic evidence。
