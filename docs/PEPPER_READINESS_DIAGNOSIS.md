# Pepper/libmpv readiness 抖动诊断

日期：2026-09-14（UTC+8）。本轮基线为 `main@e9e2ad221ed5059574f830e9ffd9ef0dd5c8a22c`，产品源码保持冻结。验证 runtime 为 `EmbyTheaterEnhanced-0.1.1-readiness-diagnosis-e9e2ad2`，启动前 full provenance 校验通过，覆盖 820 个产品 scope entries，未使用旧 runtime。

结论先行：三次有效 real acceptance 都显示主要波动发生在 `play-called → embed`，而不是 `embed → authoritative Pepper ready`。三次的 embed 到 authoritative ready 只有 2–3ms，历史 20–30 秒长尾没有在相同 commit/runtime 下复现。

## STATIC LIFECYCLE

实际产品链路如下：

```text
PlaybackManager.play()
  → playbackmanager.js:814 playInternal()
  → playbackmanager.js:884 playAfterBitrateDetect()
  → playbackmanager.js:1149/1184 player.play()
  → libmpv.js:602 playForRequest()
  → libmpv.js:608 showVideoOsd()
  → libmpv.js:611 displaySync()
  → libmpv.js:492 createMediaElement()
  → libmpv.js:518 create <embed>
  → libmpv.js:523 attach to DOM
  → libmpv.js:546 receive {type:'ready'}
  → libmpv.js:527 enhancedDiagnostics(libmpv, 'ready')
  → libmpv.js:636 playInternal()
  → libmpv.js:788 loadfile
  → libmpv.js:1100 core-playing
  → libmpv.js:629 enhancedDiagnostics(libmpv, 'playing')
  → PlaybackManager player.play() resolve
```

| 事件 | 来源 | 权威性 | acceptance 可观察性 | 漏事件风险 |
|---|---|---|---|---|
| app load | `tools/acceptance-electron.cjs` 的 `did-finish-load` | 否 | 是，harness-only | 页面加载失败时无 flow |
| observer installed | `tests/acceptance-readiness.js` | 否 | 是，harness-only | 注入失败会缺失 |
| play-called | `tests/live-acceptance-browser.js` 调用 manager 前 | 否 | 是，harness-only | flow 未进入时缺失 |
| createMediaElement called | 产品 `libmpv.js:492` | 产品内部事实 | 当前不可直接观察 | 有明确 observability gap |
| embed-created | acceptance `MutationObserver` 观察到匹配节点加入 DOM | 否；是 DOM creation observation | 是 | observer 晚于节点加入时可能只看到已有节点 |
| embed-attached | acceptance `MutationObserver`/DOM connected 状态 | 否 | 是 | observer 不可用时退化为轮询 |
| native bootstrap ready | `libmpv.js:546-547` 的 embed `message` 类型 `ready` | 否 | 是 | observer 的 embed listener 可能晚于产品 listener |
| authoritative Pepper ready | 产品 `libmpv.js:527` 调用 `enhancedDiagnostics(libmpv, 'ready')` | 是，本轮唯一 Pepper ready 定义 | 是，wrapper 只记录该调用 | wrapper 注入失败时缺失 |
| manager-play-resolved | acceptance 观察 `manager.play()` Promise resolve | 否 | 是 | manager rejected/flow 失败时缺失 |
| playing | 产品 `libmpv.js:629` 调用 `enhancedDiagnostics(..., 'playing')` | 否，属于后续播放事实 | 是 | 与 diagnostics wrapper 同步记录 |
| loadfile | `libmpv.js:788-790` 的 embed outgoing command | 否 | 当前不可可靠观察 | `postMessage` hook 在实跑中为 `embed-command-hook-failed` |

### Embed 生命周期

`createMediaElement()` 先查询 `.mpv-videoPlayerContainer`。不存在时只创建一个 `div` 和一个 `embed`，在插入前注册 embed `message` listener；`destroyInternal()` 在 `libmpv.js:1162-1177` 删除整个 dialog。`self.stop(true)`/`destroy()` 会销毁并删除节点；同一播放器的换项路径可以使用 `stop(false)` 保留节点，下一次 `createMediaElement()` 会直接复用现有 dialog。

本轮 acceptance observer 只增加 DOM 生命周期观测，记录 unique embed count、connected count、connected/disconnected、recreated 和 multiple-observed；没有加入产品 instrumentation、事件总线、AMD probe 或新的 readiness state machine。

### 静态潜在 race

产品在 `libmpv.js:523` 插入 embed 后，才在 `libmpv.js:526` 注册 window `ready` listener。若 Pepper 在插入同步阶段就发送 `ready`，产品的 embed `message` listener 可以收到消息，但 window `ready` listener 可能尚未注册，导致 authoritative `enhancedDiagnostics(..., 'ready')` 不触发，`createMediaElement()` Promise 也没有 timeout/retry。这是静态可证明的潜在 listener-after-event race，本轮三次 run 都没有发生，因为三次均观察到 bootstrap message 和 authoritative ready。

`waitForCorePlaying()` 在 `playInternal()` 之前注册，故 loadfile 后的 `core-playing` listener registration race 由当前顺序排除。没有观察到 embed recreation、duplicate embed 或旧节点重新影响最新播放。

## OBSERVABILITY

现有信号加本轮最小 acceptance-only 增强，足以区分：

```text
play-called → embed-created/attached
embed-created/attached → authoritative Pepper ready
```

但仍不能把 `play-called → embed-created` 细分为精确的 `createMediaElement()` 调用时间，以及 `showVideoOsd()`、`displaySync()`、PlaybackManager API/码率/流选择各自耗时。`loadfile` outgoing command 也继续是 observability gap，不作为 gate。

本轮 harness 变化只涉及 `tests/` 与 `tools/`：

- observer 使用 `MutationObserver` 记录 embed creation observation、connected/disconnected、数量与重建标记。
- readiness recorder 输出 lifecycle timeline、阶段差值和 embed 生命周期摘要。
- acceptance loader 兼容当前 Promise-style AMD loader 和尚未完成初始化的 global `ConnectionManager`。
- runner 允许在 terminal report 已持久化后 root 自然退出，并继续按已验证 creation date 检查已登记 descendants。

## REAL RUNS

三次均使用同一 runtime、同一产品 commit、同一 harness，方法为 `inspect,select,play,stop`。每次 runtime provenance=passed，acceptance=success，runner=`completed`，`timedOut=false`，cleanup=`verified-clean`，residual owned processes=0。每次只选择两个 STRM 样本并在结束时 Stop；样本标识和服务器数据不写入本文档。

| Run | artifact | play-called | embed-created | embed-attached | bootstrap-ready | Pepper ready | manager resolved | playing | embed count | recreation/duplicate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A | `readiness-A-20260914-115439523-12714d83` | 922ms | 6918ms | 6918ms | 6921ms | 6920ms | 9577ms | 9575ms | 1 | no/no |
| B | `readiness-B-20260914-115526161-14d03120` | 900ms | 5465ms | 5466ms | 5469ms | 5468ms | 7585ms | 7582ms | 1 | no/no |
| C | `readiness-C-20260914-115553283-6e3feb48` | 867ms | 5402ms | 5402ms | 5406ms | 5405ms | 7673ms | 7671ms | 1 | no/no |

每次生命周期都是 `created-observed → connected → disconnected`。最后的 disconnected 是本轮 Stop/cleanup 的预期收尾，不是播放期间的 recreation。

## TIMING

以下 `embed` 指 acceptance 观察到的 DOM creation observation，不冒充产品 `createElement()` 调用。`bootstrap → Pepper ready` 的原始时间戳三次都是 -1ms，原因是产品 embed message listener 先于 acceptance listener 执行，产品在同一个 message dispatch 中先调用 authoritative wrapper；业务顺序应解释为约 0ms，不能解释为真实负耗时。

| Run | play→embed | embed→attach | embed→bootstrap | bootstrap→Pepper ready | embed→Pepper ready | Pepper ready→manager resolved | Pepper ready→playing |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 5996ms | 0ms | 3ms | ≈0ms（raw -1） | 2ms | 2657ms | 2655ms |
| B | 4565ms | 1ms | 4ms | ≈0ms（raw -1） | 3ms | 2117ms | 2114ms |
| C | 4535ms | 0ms | 4ms | ≈0ms（raw -1） | 3ms | 2268ms | 2266ms |

`resolver-result` 也在 Pepper ready 之后很快出现：A=6925ms、B=5472ms、C=5409ms。它没有出现在 ready 之前，因此本轮没有证据表明 PR4/DirectUrl/resolver 导致 Pepper ready 延迟。

## DIAGNOSIS

| 假设 | 本轮判断 | 依据 |
|---|---|---|
| A. Electron/Chromium PPAPI plugin 初始化随机变慢 | 未获支持 | embed→authoritative ready 仅 2–3ms，三次一致 |
| B. embed 创建时机/创建前链路不稳定 | 已观察到阶段差异 | play→embed 为 4535–5996ms；但精确 sub-stage 未观测 |
| C. plugin ready message 丢失或迟到 | 三次未发生；静态风险存在 | 三次都看到 ready message；产品 window listener 注册晚于 embed 插入 |
| D. embed 重建/替换/延迟 attach | 未获支持 | 每次 unique embed=1，播放期间无 disconnect/recreate，结束时才 disconnect |
| E. libmpv bridge 初始化 race | 未获运行证据 | authoritative ready、resolver-result 和 core-playing 顺序稳定；只保留静态 ready listener race |
| F. DLL/mpv 初始化耗时 | 不能由本轮单独证明 | ready→manager resolved 为 2117–2657ms，发生在 ready 之后；没有 DLL init 起点信号 |
| G. acceptance harness 影响 readiness | 未获支持 | observer 在 play 前约 0.5s 安装；三次主链成功；loadfile 缺口只影响观测，不改变 ready 时间 |
| H. 其他前置层 | 最可能层，但未确认 | `play→embed` 包含 API/码率/流选择、`showVideoOsd()`、`displaySync()`；当前没有调用级时间戳 |

### 结论

```text
ROOT CAUSE NOT YET CONFIRMED
```

主要抖动阶段是 `play-called → embed-created/attached`，不是 `embed-created → authoritative Pepper ready`。最可能层是 embed 创建前的 PlaybackManager/player 前置链，尤其是 API/码率/流选择、OSD 路由和 display-sync；这是范围判断，不是已确认单一根因。

已排除或暂不支持：本轮没有 Pepper ready 长尾、没有 ready 丢失、没有 duplicate/recreation、没有稳定的 listener-after-event 失败样本，也没有 PR4/DirectUrl/resolver 与 ready 延迟的因果证据。`displaySync()` 的两个 `electronrefreshrate` 子请求在独立只读探测中约 31–39ms，不能单独解释本轮 4.5–6.0s，但 acceptance flow 尚未记录其调用级耗时。

下一步最小实验：在 acceptance-only flow 中只增加已存在产品边界的 player/route/API 时间点，优先区分 `manager.play → player.play`、`player.play → showVideoOsd/displaySync` 和 `displaySync → embed attach`。如果不允许产品 instrumentation，则保持当前结论，不把前置层进一步猜成 DLL、Chromium 或服务器原因。

Product code modified: NO.
