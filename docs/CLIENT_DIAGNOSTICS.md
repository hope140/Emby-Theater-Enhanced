# Client Diagnostics v1

客户端诊断是只读可观测层。它不改变 Resolver precedence、DirectUrl、CD2 budget、Mount 判定、PlaybackManager、Session、WebSocket、DeviceId、播放上报、NextTrack、WatchTogether 或 libmpv source selection。

## 日志位置与轮转

日志始终启用，默认写入：

```text
%APPDATA%\EmbyTheaterEnhanced\logs\ete-client.jsonl
```

日志使用 UTF-8 JSONL，每行一个 event。当前文件达到约 2 MiB 时依次保留：

```text
ete-client.jsonl
ete-client.jsonl.1
ete-client.jsonl.2
ete-client.jsonl.3
```

目录会在第一次写入时创建。写入、目录创建和轮转失败均 fail-open，诊断层不会抛错到播放链；日志写入通过串行异步队列执行，不在播放调用栈中进行同步文件 I/O。

## Event schema

每条记录采用以下结构：

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-09-16T00:00:00.000Z",
  "level": "info",
  "category": "resolver",
  "event": "route-selected",
  "details": {}
}
```

当前主要类别如下：

- `app`：`start`、自然可观测的 `shutdown`，以及版本、平台、架构和安全摘要。
- `resolver`：每次 STRM resolve 的 `route-selected`。
- `cd2`：`resolve-start`、`resolve-hit`、`resolve-miss`、`resolve-error`、`resolve-cancelled`。
- `mount`：`resolve-start`、`resolve-hit`、`resolve-miss`。
- `playback`：`play-request`、`resolver-complete`、`loadfile-requested`、`core-playing`、`pause`、`resume`、`seek`、`next`、`stop`、`playback-error`。
- `mpv`：ready/playing 属性快照；不导出 `mpv.conf` 原文。

CD2 事件只记录 request id、rule id、mode、candidate 数量、reason、耗时、timeout/cancelled 状态和安全的 `sourceKind`。Mount 事件只记录 request id、rule id、candidate 数量、reason、`localExists` 与 `mappedPathHash`。

## Resolver route meanings

`resolver/route-selected` 的 `route` 是稳定枚举：

| route | 判断 | 含义 |
|---|---|---|
| `direct-url` | `sourceKind=direct-url` | DIRECT URL |
| `cd2-http` | `type=url` 且 `sourceKind=cd2-url` | CD2 SAME-ORIGIN HTTP |
| `mount` | `type=local` 且 `reason=mount_hit` | MOUNT |
| `native` | `type=native` | NATIVE FALLBACK |

路由记录包含 `requestId`、`playRequestId`、`isStrm`、`ruleId`、`type`、`reason`、`sourceKind`、`cd2Reason`、`directReason`、`localExists` 和 `fallback`。`result.source` 永远不写入日志。

## 隐私与脱敏

所有落盘记录都会经过同一个 sanitizer。以下内容禁止落盘：

- Emby access token、`X-Emby-Token`、`Authorization`、Bearer token、Cookie、api key、password 和 CD2 token。
- URL query、完整媒体 URL、完整 DirectUrl 和完整 origin/path。
- Windows 用户名、Windows drive/UNC 媒体路径和 POSIX 媒体路径。
- Local Storage、Cookie database 和 `mpv.conf` 原文。

需要关联路径时只保留 `SHA256(normalizedPath)[:16]` 的 `pathHash` 或 `mappedPathHash`。需要识别服务时只保留协议与 `SHA256(lowercase hostname)[:16]` 的 `hostHash`。DeviceId、DeviceName、SessionId 和 PlaySessionId 只保留对应的 16 位哈希。对象、Error、循环引用、超长字符串、`undefined` 和 `null` 都按安全规则处理。

## 客户端入口

在设置页打开“诊断与日志”后，可以看到：

1. 诊断日志已启用及简化后的日志目录说明。
2. “导出诊断日志”，通过 Electron save dialog 保存 TXT 报告。
3. “打开日志目录”。
4. “清空日志”，需要两次确认，并只清空当前日志和三层轮转文件。

导出文件名格式为：

```text
EmbyTheaterEnhanced-Diagnostics-YYYYMMDD-HHmmss.txt
```

报告顶部包含应用版本、Build Commit、平台、架构、Electron/Chromium/Node、导出时间和 DeviceId Hash。随后给出最近一次确定的 STRM route、Resolver reason、CD2 结果、Mount 结果、Native fallback、Playback 结果和 core-playing 状态，最后按 `.3 → .2 → .1 → current` 时间顺序合并客户端 JSONL。无法从日志确定的值写为 `UNKNOWN`，畸形 JSONL 行会安全忽略并计数。

## AI 分析建议

将导出的 TXT 原样交给 ChatGPT/Codex/Hermes 时，优先询问：

- 最近一次 STRM 最终 route 是 `DIRECT URL`、`CD2 HTTP`、`MOUNT` 还是 `NATIVE FALLBACK`？
- CD2 是命中、miss、error 还是 cancelled？Mount 是否实际到达并命中？
- Resolver 完成后是否发出了 `loadfile-requested`？之后是否进入 `core-playing`？
- 错误发生在 Resolver、loadfile 前后，还是播放器已经开始后？

这些问题应依据 event 和 reason 回答。日志只提供事实，不包含根因推测。

## Failure behavior and acceptance boundary

诊断 IPC 只接受当前 BrowserWindow 的可信 sender。导出失败、打开目录失败、清空失败只反馈给设置页，不会使客户端崩溃，也不会改变播放 fallback。

本轮覆盖 resolver、CD2、Mount 和 libmpv playback 的低风险事件。由于禁止侵入旧 upstream Web UI、`apiclient.js`、`connectionmanager.js`、PlaybackManager vendor snapshot 和 WebSocket 生命周期，Session capability、NowPlaying、WebSocket 状态与真实双客户端事件保持 `DEFERRED OBSERVABILITY`。真实 Windows 客户端播放各 route、导出 TXT 和交给 AI 的验收仍需要人工执行。
