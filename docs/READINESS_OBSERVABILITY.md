# Readiness observability

日期：2026-09-15（UTC+8）

基线：`main@56b2227324811b525cd73caed61e3399cd2875e5`

验证提交：`6c5cc9e05b7dbec6a01a2cf81cd19209deb0b319`

## 最终结论

### READINESS INFRASTRUCTURE VERDICT

**RELIABLE**

在当前 frozen Electron 18.3.15 / embedded libmpv runtime 和已登录 acceptance profile 下，10/10 startup run 都观察到 raw Pepper ready、direct product diagnostics ready、sticky readiness state、core-playing、视频 PositionTicks 推进、Session/progress 和 Stop cleanup。observer-only miss 有明确 class B 结果，不能伪装成 ready，也不会再被写成 Pepper initialization failure。

### PRODUCT PLAYBACK OBSERVATION

**10/10 real playback succeeded**

上述结论单独描述真实播放器与 Session 观察，不把它与 readiness observer 的可靠性混成一个 gate。另有 2/2 full-control run 通过 `play → pause → seek → resume → next → stop`。

## authoritative evidence path

```text
Pepper embed message {type: "ready"}
  → frozen libmpv.js window ready listener
  → existing enhancedDiagnostics(libmpv, "ready") call
  → prepared preload diagnostics bridge
  → window.__etePepperReadiness sticky state
       + diagnostics.collect → ipcRenderer.send("enhanced-diagnostics")
  → main enhanced-diagnostics log
  → acceptance observer
       ├─ raw embed message listener
       ├─ direct enhancedDiagnostics wrapper
       ├─ sticky/current-state sync after attach and during poll
       └─ core-playing / property and video-progress observation
  → live acceptance evidence classifier
  → readiness recorder → acceptance.json
  → owned runner result / cleanup evidence
```

当前 authoritative Pepper-ready 产品来源是 `libmpv.js` 对 `enhancedDiagnostics(libmpv, 'ready')` 的调用。embed 的 `{type:'ready'}` 是 raw bootstrap event，不能单独替代产品 readiness。prepared preload 的 sticky state 是该产品诊断调用的非阻塞、可按 run 查询的当前状态；它不发送播放器命令、不等待 playback Promise、不改变 Pepper 创建或销毁时序。

## 原问题和根因

原问题在本轮被当前 main 的 clean runtime 复现：vendor-only 214-byte preload 运行时能产生 embed raw `ready`，并完成 `resolver-result`、`core-playing`、`manager-play-resolved`、真实视频进度、Session NowPlaying 和已接受的 start/progress report，但没有 `window.enhancedDiagnostics`。旧 flow 只等待 direct `pepper-ready` marker，于是把这次真实播放标成 `pepper-ready-timeout`。

用修复后的 acceptance observer 对同一个旧 runtime 做对照，结果为：

```text
direct pepper-ready: missing
raw embed ready: observed
manager-play-resolved: observed
core-playing: observed
video progress / frame-equivalent: observed
Session NowPlaying: observed
accepted progress report: observed
result: class B / observer-only-miss
stop: passed
cleanup: verified-clean
residual: 0
```

因此这里的明确根因是 readiness diagnostic input/observer contract 缺失，而不是 Pepper、resolver 或 PlaybackManager 的播放失败。旧 `libmpv.js` 的 listener ordering 已在此前独立回归，本轮没有重新调查或修改该产品链。

## 修复策略

1. `tools/prepare-preload.cjs` 从只读 vendor preload 生成 ignored prepared preload。生成内容保留原 IPC/fs/os/appdata bridge，增加已有 diagnostics bridge，并在 `window.__etePepperReadiness` 中保留带 `runId`、时间戳和 bridge identity 的 ready/playing sticky state。
2. `prepare.ps1`、`build.ps1` 共用该生成器；runtime provenance 单独记录并校验 vendor base、generator、prepared source 和 runtime hash，并强制 `runtime preload === deterministic prepared preload`，避免旧 dist 或手工 preload 混入。
3. acceptance observer 在 embed attach 后和每次 poll 查询 sticky/current state，同时观察 raw embed ready、direct diagnostics wrapper、window `core-playing`、`core-idle=false` 和视频 PositionTicks 推进。`beginRun(runId)` 会清理 run-scoped 状态；旧 run 的 `runId`、时间戳或 bridge 不匹配时不能污染新 run。
4. live flow 不再把 direct marker 缺失立即当作 Pepper failure。它先等待 bounded `manager.play` 结果，再收集 core-playing、视频进度、Session NowPlaying 和已接受 playback report。只有完整 alternate evidence 才进入 class B；单独的 `play-called` 绝不算 ready。
5. loadfile outgoing command 仍如实记为 `unavailable`，因为 Pepper 对象的 `postMessage` hook 在真实 runtime 不可可靠替换；没有用 manager resolved 或其它信号伪造 loadfile。

## 结果分类

| 分类 | 条件 | 解释 |
|---|---|---|
| A | direct Pepper/product ready observed，且 playback succeeds | 正常 authoritative ready + 播放成功 |
| B | direct ready 未观察到，但 manager resolved、core-playing、视频真实推进、Session/progress 全部成立 | observer miss；显式 alternate evidence，不等同 runtime failure |
| C | direct/sticky ready 未确认，且 playback 未开始/不可证明 | potential runtime readiness failure |
| D | runner、module acquisition、harness 或 cleanup ownership 自身失败 | 单独的 runner/harness failure，不能归给播放器 |

`pepperReadiness.status` 采用以下值：`observed-ready`、`inferred-ready-from-authoritative-state`、`not-ready`、`observer-missing`、`unavailable`。最终 report 同时保留 raw event、normalized observation、evidence rows、acceptance class 和 runner cleanup 状态。

## synthetic coverage

`npm test` 当前为 77/77，并包含：

| Case | 覆盖 |
|---|---|
| A | ready event 在 observer attach 后发生，得到 class A |
| B | ready 在 observer attach 前已发生，由 sticky/current state 恢复 |
| C | 没有 ready evidence 且没有 playable state，得到 class C |
| D | runner/harness failure 得到 class D，并与 player facts 分离 |
| E | 上一个 run 的 ready state 或过期时间戳不能满足新 run |

相关测试：`tests/readiness-evidence.test.cjs`、`tests/readiness-observer-race.test.cjs`、`tests/preload-preparation.test.cjs`。既有 `acceptance-readiness-selftest.cjs`、terminal race/integration selftest 和 PID-reuse descendant selftest 也通过。

## 真实 run matrix

### Startup-only：10 次

每次方法为 `inspect,select,play,stop`。`video` 是播放器 PositionTicks 推进这一可用的 first-frame equivalent；`reports` 是该 run 收到的 playback report 行数。

| Run ID | raw | direct | sticky | resolver | manager | core | video | Session | progress | stop | cleanup | residual | timing play→embed / embed→ready / ready→manager |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `cleanroom10-01-20260914-173434698-82cd8f12` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4712 / 22 / 1421 ms |
| `cleanroom10-02-20260914-173446962-03837da7` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4520 / 2 / 1317 ms |
| `cleanroom10-03-20260914-173458958-5f9cfdfb` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4523 / 3 / 1743 ms |
| `cleanroom10-04-20260914-173511295-fa8ec385` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4562 / 1 / 1490 ms |
| `cleanroom10-05-20260914-173523623-b459a2e2` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4609 / 35 / 1329 ms |
| `cleanroom10-06-20260914-173535737-96dc9aea` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4581 / 2 / 1639 ms |
| `cleanroom10-07-20260914-173548044-4203318b` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4595 / 2 / 1537 ms |
| `cleanroom10-08-20260914-173559460-1343b8b8` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4540 / 2 / 1734 ms |
| `cleanroom10-09-20260914-173610977-d86e22ff` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4591 / 1 / 1652 ms |
| `cleanroom10-10-20260914-173622432-7ceec332` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | verified-clean | 0 | 4579 / 2 / 1407 ms |

统计：

```text
raw Pepper-ready: 10/10
authoritative readiness confirmed: 10/10
real playback succeeded: 10/10
observer-only misses: 0/10
actual player failures: 0/10
```

每次 stop 的 NowPlayingItem 都清空，startup run 每次有 3 条 playback report，包含开始/过程/停止路径。每次 resolver result、manager play resolved、core-playing 和视频进度均出现。

### Full-control：2 次

| Run ID | methods | class | readiness | resolver | playback | Session/reporting | stop/NowPlaying | cleanup | residual | reports |
|---|---|---|---|---|---|---|---|---|---:|---:|
| `control2-01-20260914-173656573-5f91bd0d` | play/pause/seek/resume/next/stop | A | class-a | PASS | PASS | PASS | PASS/cleared | verified-clean | 0 | 10 |
| `control2-02-20260914-173718160-c800c3d7` | play/pause/seek/resume/next/stop | A | class-a | PASS | PASS | PASS | PASS/cleared | verified-clean | 0 | 10 |

## known remaining gaps

- 真实 runtime 的 outgoing `loadfile` command 仍为 `loadfileObservation=unavailable`，这是观测缺口，不是播放失败。
- `createMediaElement()` 的精确函数调用时间没有独立产品 marker；`embed-created` 仍明确命名为 DOM creation observation。
- 本轮没有重新做音轨、字幕、HDR、codec、UI、settings/autoplay 或双客户端同步矩阵。
- 本轮没有修改 `PlaybackManager`、resolver、`src/electronapp/plugins/libmpv.js`、Session/remote control、CEC、Electron 或 mpv 版本；准备的 preload block 只做非阻塞 diagnostics/sticky observation。
