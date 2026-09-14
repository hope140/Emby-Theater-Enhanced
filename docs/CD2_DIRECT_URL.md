# CloudDrive2 DirectUrl contract

本文件冻结 PR #4 的 DirectUrl 安全边界。实现继续遵守 `Resolver changes source only`：PlaybackManager、Item、MediaSource、PlaySessionId、Session、WebSocket、报告与现有 libmpv ownership 均保持不变。

## 能力结论

冻结 runtime 为 Electron 18.3.15、Node 16.13.2、mpv 0.41 与现有 Pepper bridge。隔离探针使用以下字符串 argv：

```text
loadfile <url> replace -1 user-agent=<value>
```

连续加载 UA-A、UA-B 与无 file-local option 的 same-origin C 后，三段媒体均实际解复用并推进；HTTP 端点只观察到 A 的 UA-A、B 的 UA-B，C 恢复为默认 UA。因此当前 bridge 已证明 `user-agent` 可以作为当前 playlist entry 的 file-local option 使用，没有 A → B 或 DirectUrl → same-origin 泄漏。

禁止通过 `set_property user-agent`、恢复或清空全局属性实现 DirectUrl。实现中不得存在等价的临时全局状态方案。

`additionalHeaders` 暂不支持。当前字符串 options 尚未证明能无歧义表达任意逗号、冒号、引号、反斜杠或多 header 值；只要响应包含任意 header，DirectUrl 就判为 `unsupported_headers` 并优先使用 same-origin。

## DirectUrl result

可用结果保持小结构：

```text
status=hit
type=url
sourceKind=direct-url
source=<validated HTTP(S) URL>
requestOptions.userAgent=<optional validated value>
acquiredAt=<monotonic wall-clock milliseconds>
expiresAt=<optional milliseconds>
```

完整 URL、query、User-Agent 与 headers 不进入日志或公开 evidence。日志只允许 source kind、字段存在性、header 数量、expiry 是否存在及脱敏 reason。

## Eligibility

DirectUrl 只有同时满足以下条件才可返回：

1. `directUrl` 是无 userinfo、无 fragment 的绝对 HTTP(S) URL，不接受本地路径和其他 scheme。
2. `additionalHeaders` 缺失或为空对象。
3. `userAgent` 缺失，或是 1 到 1024 字节的可打印 ASCII；拒绝控制字符、DEL、逗号与反斜杠，避免 options list 分隔或转义歧义。
4. `expiresIn` 缺失，或是可安全表示的正整数秒。字段存在但无效时 DirectUrl unsupported。
5. 已知 expiry 在使用前仍大于安全余量。安全余量为 TTL 的 10%，下限 5 秒、上限 30 秒。

任何资格失败均不得 crash，也不得跳过 same-origin。

## Acquisition、expiry 与 reacquire

`expiresIn` 按 repo 固定的 CloudDrive proto 语义解释为“距离过期的秒数”。`acquiredAt` 取 DirectUrl RPC 发起时刻，`expiresAt = acquiredAt + expiresIn * 1000`，从请求开始计算以覆盖 RPC 传输时间。

每个新 Play、NextTrack、Stop 后重新 Play，以及 source 变化都创建新 generation 并重新获取；不跨 Item、MediaSource 或 generation 缓存 URL。

不启用后台刷新。若第一次 DirectUrl 响应在返回前已过期或进入安全余量，只在同一 request、同一 absolute resolver budget 内最多重新获取一次。第二次仍不可用或 reacquire 失败时使用 same-origin。当前 Pepper bridge 不暴露可靠的 HTTP status/end-file error 分类，因此 PR #4 不声称 403 触发的自动恢复；seek、暂停后恢复和连接重建由当前 mpv entry 处理，新的 Play 请求才重新获取。

## Budget、Abort 与 stale response

DirectUrl、一次 bounded reacquire 与 same-origin fallback 共用现有 750ms absolute resolver budget。Find 结果在本次 request 内复用；不得给每条 fallback 路径重新分配完整 750ms。DirectUrl RPC 使用有限的子预算，并为 same-origin 保留可执行窗口。

PlaybackManager request id、libmpv generation、AbortController、main IPC request id、gRPC cancel 与 deadline 继续组成同一个 correctness boundary。每个 await 后与最终 `loadfile` 前都必须检查 generation。Abort/Stop/NextTrack 取消 active call 并丢弃 late response；Abort 不进入 fallback，普通 transport reject/timeout 则优先 same-origin。

## Fallback order

固定顺序为：

```text
DirectUrl
→ CD2 same-origin HTTP
→ Mount
→ Native
```

`get_direct_url=true` 的响应若同时带有可验证的 same-origin `downloadUrlPath`，DirectUrl 不可用时可以直接使用该字段；否则在剩余 absolute budget 内调用 `get_direct_url=false`。显式关闭 DirectUrl 时保持 PR #2 的 same-origin 路径。

## Configuration

CloudDrive2 resolver 本身仍由现有 `ETE_CD2_ENABLED` 控制。PR #4 在 CD2 已启用时默认尝试 DirectUrl，并允许本地环境变量 `ETE_CD2_DIRECT_URL=0` 强制保持 PR #2 same-origin 行为，用于回归与回退；不新增 settings UI，不把真实配置写入仓库。

## Acceptance gates

- unit/fake：DirectUrl + UA、缺失/畸形 URL、unsafe UA、非空 headers、transport reject/timeout、Abort、late response、Stop、NextTrack、known-expiry reacquire、reacquire failure 与 same-origin fallback。
- frozen runtime：UA-A → UA-B → same-origin C 全部播放推进，且 HTTP 观察无跨文件 UA 泄漏。
- real CD2：只读确认字段存在性与单字节 Range；不记录 URL、query、UA 或 token。
- real Emby：至少一个 `sourceKind=direct-url` 命中，并验证 embedded libmpv、controls、Session/WebSocket、reports 与 Stop 清空 NowPlaying。

## 参考实现边界

- `DDSRem-Dev/MoviePilot-Plugins` 的 `clouddrive_api.py` 使用一次 `get_download_url(get_direct_url=True)`，优先消费 `directUrl`、`userAgent`、`additionalHeaders`，否则复用同次响应的 `downloadUrlPath`。
- `baranwang/MoviePilot-Plugins` 的 `cd2_api.py` 直接调用 `GetDownloadUrlPath(get_direct_url=True)`，同样优先 DirectUrl 并以 `downloadUrlPath` 作为 same-origin fallback。
- `DDSRem-Dev/clouddrive2-client` 的 wrapper 与固定 proto 确认 `get_direct_url` 参数以及 `expiresIn` 为距离过期的秒数。

这些项目只用于交叉核对 acquisition/response contract。它们使用普通 HTTP client 的 header 字典，不能证明 libmpv header 隔离；本项目仍以 mpv 0.41 官方 per-file options 与 exact frozen Pepper 实测为播放器依据。

Model Tier: 2
Model: GPT-5.6 Sol High contract review
Escalated: yes；涉及 file-local header 隔离、expiry、generation 与 fallback correctness。
